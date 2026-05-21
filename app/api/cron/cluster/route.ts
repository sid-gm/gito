import { NextResponse } from "next/server";
import { and, count, eq, gt, inArray, isNull, isNotNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";
import { computeNarrativeStage, NEWS_PLATFORMS } from "@/lib/narrative-stage";

const SIMILARITY_THRESHOLD = 0.75;
const BATCH_SIZE = 100;

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function updateCentroid(centroid: number[], newVec: number[], n: number): number[] {
  return centroid.map((v, i) => (v * n + newVec[i]) / (n + 1));
}

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const unassigned = await db
    .select({
      id: ingestedItems.id,
      entityId: ingestedItems.entityId,
      publishedAt: ingestedItems.publishedAt,
      embedding: ingestedItems.embedding,
    })
    .from(ingestedItems)
    .leftJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(
      and(
        isNotNull(ingestedItems.embedding),
        isNull(clusterItems.itemId)
      )
    )
    .limit(BATCH_SIZE);

  if (unassigned.length === 0) {
    return NextResponse.json({ ok: true, assigned: 0, created: 0 });
  }

  const byEntity = new Map<string, typeof unassigned>();
  for (const item of unassigned) {
    if (!item.entityId) continue;
    if (!byEntity.has(item.entityId)) byEntity.set(item.entityId, []);
    byEntity.get(item.entityId)!.push(item);
  }

  let assigned = 0;
  let created = 0;
  const updatedClusterIds = new Set<string>();

  for (const [entityId, items] of byEntity) {
    const activeClusters = await db
      .select()
      .from(clusters)
      .where(and(eq(clusters.entityId, entityId), isNull(clusters.archivedAt)));

    for (const item of items) {
      const vec = item.embedding!;
      const matches: { clusterId: string; similarity: number }[] = [];

      for (const cluster of activeClusters) {
        if (!cluster.centroidEmbedding) continue;
        const sim = cosineSimilarity(vec, cluster.centroidEmbedding);
        if (sim >= SIMILARITY_THRESHOLD) matches.push({ clusterId: cluster.id, similarity: sim });
      }

      try {
        if (matches.length > 0) {
          for (const { clusterId, similarity } of matches) {
            const cluster = activeClusters.find((c) => c.id === clusterId)!;
            const newCentroid = updateCentroid(cluster.centroidEmbedding!, vec, cluster.itemCount);
            const newCount = cluster.itemCount + 1;

            await db
              .update(clusters)
              .set({ centroidEmbedding: newCentroid, itemCount: newCount, lastSeenAt: item.publishedAt ?? new Date() })
              .where(eq(clusters.id, clusterId));

            await db.insert(clusterItems).values({ clusterId, itemId: item.id, similarity });

            cluster.centroidEmbedding = newCentroid;
            cluster.itemCount = newCount;
            if (newCount >= 2) updatedClusterIds.add(clusterId);
          }
          assigned++;
        } else {
          const now = item.publishedAt ?? new Date();
          const [newCluster] = await db
            .insert(clusters)
            .values({ entityId, centroidEmbedding: vec, itemCount: 1, firstSeenAt: now, lastSeenAt: now })
            .returning();

          await db.insert(clusterItems).values({ clusterId: newCluster.id, itemId: item.id, similarity: 1.0 });

          activeClusters.push(newCluster);
          created++;
        }
      } catch (err) {
        console.error(`[cluster] item ${item.id}:`, err);
      }
    }
  }

  // Compute velocity + stage from T0 for all updated non-singleton clusters
  if (updatedClusterIds.size > 0) {
    await updateVelocityAndStage([...updatedClusterIds]);
  }

  return NextResponse.json({ ok: true, assigned, created });
}

async function updateVelocityAndStage(clusterIds: string[]) {
  const now = new Date();
  const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const clusterRows = await db
    .select({ id: clusters.id, firstSeenAt: clusters.firstSeenAt, peakMomentum: clusters.peakMomentum, narrativeStage: clusters.narrativeStage })
    .from(clusters)
    .where(inArray(clusters.id, clusterIds));

  for (const cluster of clusterRows) {
    try {
      const [v24] = await db
        .select({ cnt: count(clusterItems.itemId) })
        .from(clusterItems)
        .where(and(eq(clusterItems.clusterId, cluster.id), gt(clusterItems.addedAt, h24ago)));
      const velocity24h = v24?.cnt ?? 0;

      const [vPrev] = await db
        .select({ cnt: count(clusterItems.itemId) })
        .from(clusterItems)
        .where(and(eq(clusterItems.clusterId, cluster.id), gt(clusterItems.addedAt, h48ago), lte(clusterItems.addedAt, h24ago)));
      const prevVelocity24h = vPrev?.cnt ?? 0;

      const platformRows = await db
        .select({ platform: sql<string>`DISTINCT ${ingestedItems.platform}` })
        .from(clusterItems)
        .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
        .where(eq(clusterItems.clusterId, cluster.id));

      const platforms = [...new Set(platformRows.map((r) => r.platform).filter(Boolean))];
      const nonNewsPlatformCount = platforms.filter((p) => !NEWS_PLATFORMS.includes(p)).length;

      const ageInDays = (now.getTime() - new Date(cluster.firstSeenAt).getTime()) / (1000 * 60 * 60 * 24);
      const momentum = (velocity24h + prevVelocity24h) / 2;
      const newPeakMomentum = Math.max(cluster.peakMomentum ?? 0, velocity24h);

      const narrativeStage = computeNarrativeStage({
        velocity24h,
        prevVelocity24h,
        peakMomentum: cluster.peakMomentum,
        ageInDays,
        platformCount: platforms.length,
        nonNewsPlatformCount,
        currentStage: cluster.narrativeStage ?? undefined,
      });

      await db
        .update(clusters)
        .set({ velocity24h, prevVelocity24h, momentum, peakMomentum: newPeakMomentum, platformCount: platforms.length, narrativeStage })
        .where(eq(clusters.id, cluster.id));
    } catch (err) {
      console.error(`[cluster/velocity] cluster ${cluster.id}:`, err);
    }
  }
}
