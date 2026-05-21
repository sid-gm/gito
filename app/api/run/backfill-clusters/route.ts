import { NextResponse } from "next/server";
import { and, count, eq, gt, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems } from "@/lib/db/schema";
import { computeNarrativeStage, NEWS_PLATFORMS } from "@/lib/narrative-stage";

const SIMILARITY_THRESHOLD = 0.75;

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

export async function POST() {
  const allItems = await db
    .select({
      id: ingestedItems.id,
      entityId: ingestedItems.entityId,
      publishedAt: ingestedItems.publishedAt,
      embedding: ingestedItems.embedding,
    })
    .from(ingestedItems)
    .where(isNotNull(ingestedItems.embedding));

  const byEntity = new Map<string, typeof allItems>();
  for (const item of allItems) {
    if (!item.entityId) continue;
    if (!byEntity.has(item.entityId)) byEntity.set(item.entityId, []);
    byEntity.get(item.entityId)!.push(item);
  }

  let newLinks = 0;
  const affectedClusterIds = new Set<string>();

  for (const [entityId, items] of byEntity) {
    const activeClusters = await db
      .select()
      .from(clusters)
      .where(and(eq(clusters.entityId, entityId), isNull(clusters.archivedAt)));

    if (activeClusters.length === 0) continue;

    const itemIds = items.map((i) => i.id);

    const existingRows = await db
      .select({ clusterId: clusterItems.clusterId, itemId: clusterItems.itemId })
      .from(clusterItems)
      .where(inArray(clusterItems.itemId, itemIds));

    const existingPairs = new Set(existingRows.map((r) => `${r.clusterId}:${r.itemId}`));

    const toInsert: { clusterId: string; itemId: string; similarity: number }[] = [];

    for (const item of items) {
      const vec = item.embedding!;
      for (const cluster of activeClusters) {
        if (!cluster.centroidEmbedding) continue;
        const pairKey = `${cluster.id}:${item.id}`;
        if (existingPairs.has(pairKey)) continue;
        const sim = cosineSimilarity(vec, cluster.centroidEmbedding);
        if (sim >= SIMILARITY_THRESHOLD) {
          toInsert.push({ clusterId: cluster.id, itemId: item.id, similarity: sim });
          affectedClusterIds.add(cluster.id);
        }
      }
    }

    if (toInsert.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < toInsert.length; i += CHUNK) {
        const chunk = toInsert.slice(i, i + CHUNK);
        const inserted = await db.insert(clusterItems).values(chunk).onConflictDoNothing().returning();
        newLinks += inserted.length;
      }
    }
  }

  for (const clusterId of affectedClusterIds) {
    try {
      const [{ cnt }] = await db
        .select({ cnt: count(clusterItems.itemId) })
        .from(clusterItems)
        .where(eq(clusterItems.clusterId, clusterId));
      await db.update(clusters).set({ itemCount: cnt }).where(eq(clusters.id, clusterId));
    } catch (err) {
      console.error(`[backfill-clusters] recount ${clusterId}:`, err);
    }
  }

  if (affectedClusterIds.size > 0) {
    await refreshStages([...affectedClusterIds]);
  }

  console.log(`[backfill-clusters] ${newLinks} new links across ${affectedClusterIds.size} clusters`);
  return NextResponse.json({ ok: true, newLinks, affectedClusters: affectedClusterIds.size });
}

async function refreshStages(clusterIds: string[]) {
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
      console.error(`[backfill-clusters/stage] cluster ${cluster.id}:`, err);
    }
  }
}
