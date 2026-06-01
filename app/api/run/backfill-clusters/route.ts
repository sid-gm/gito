import { NextResponse } from "next/server";
import { and, count, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems } from "@/lib/db/schema";
import { computeNarrativeStage, NEWS_PLATFORMS } from "@/lib/narrative-stage";

const SIMILARITY_THRESHOLD = 0.75;

export async function POST() {
  // Use pgvector's cosine distance operator (<=>).
  // 1 - cosine_distance = cosine_similarity.
  // Find every (item, cluster) pair above threshold that isn't already linked.
  const newPairs = await db.execute<{ item_id: string; cluster_id: string; similarity: number }>(
    sql`
      SELECT
        i.id          AS item_id,
        c.id          AS cluster_id,
        (1 - (i.embedding <=> c.centroid_embedding))::float AS similarity
      FROM ingested_items i
      CROSS JOIN clusters c
      WHERE i.entity_id = c.entity_id
        AND i.embedding IS NOT NULL
        AND c.centroid_embedding IS NOT NULL
        AND c.archived_at IS NULL
        AND i.platform != 'google_alerts'
        AND (1 - (i.embedding <=> c.centroid_embedding)) >= ${SIMILARITY_THRESHOLD}
        AND NOT EXISTS (
          SELECT 1 FROM cluster_items ci
          WHERE ci.item_id = i.id AND ci.cluster_id = c.id
        )
    `
  );

  const rows = newPairs.rows;

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, newLinks: 0, affectedClusters: 0 });
  }

  // Insert new cluster_items in chunks
  const CHUNK = 500;
  let newLinks = 0;
  const affectedClusterIds = new Set<string>();

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values = chunk.map((r) => ({
      clusterId: r.cluster_id,
      itemId: r.item_id,
      similarity: r.similarity,
    }));
    const inserted = await db.insert(clusterItems).values(values).onConflictDoNothing().returning();
    newLinks += inserted.length;
    for (const r of chunk) affectedClusterIds.add(r.cluster_id);
  }

  // Recompute itemCount for affected clusters
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

  // Refresh narrative stages
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
