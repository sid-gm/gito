import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems, trackedEntities } from "@/lib/db/schema";
import { matchToExistingClusters, groupNewItems } from "@/lib/ai/cluster";
import { updateVelocityAndStage } from "@/lib/ai/cluster-velocity";
import { groupRedditThreadsIntoClusters } from "@/lib/ai/reddit-thread-cluster";

export type ClusterRunResult = {
  assigned: number;
  created: number;
};

export async function runClustering(limit: number): Promise<ClusterRunResult> {
  // Pre-pass: group Reddit posts + their comments into clusters by thread URL
  await groupRedditThreadsIntoClusters();

  // Fetch ALL items (including already-clustered ones) so they can be reconsidered.
  // Unassigned items come first so they're prioritised within the limit.
  const allItems = await db
    .select({
      id: ingestedItems.id,
      entityId: ingestedItems.entityId,
      title: ingestedItems.title,
      publishedAt: ingestedItems.publishedAt,
      currentClusterId: clusterItems.clusterId,
    })
    .from(ingestedItems)
    .leftJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(ne(ingestedItems.platform, "google_alerts"))
    .orderBy(
      sql`CASE WHEN ${clusterItems.itemId} IS NULL THEN 0 ELSE 1 END`,
      desc(ingestedItems.publishedAt)
    )
    .limit(limit);

  // Build current-cluster map and deduplicate (an item may appear twice if in multiple clusters)
  const currentClusterMap = new Map<string, string>();
  const seen = new Set<string>();
  const withTitle: typeof allItems = [];
  for (const item of allItems) {
    if (item.currentClusterId && !currentClusterMap.has(item.id)) {
      currentClusterMap.set(item.id, item.currentClusterId);
    }
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    if (item.entityId && item.title?.trim()) withTitle.push(item);
  }

  if (withTitle.length === 0) return { assigned: 0, created: 0 };

  // Group by entity
  const byEntity = new Map<string, typeof withTitle>();
  for (const item of withTitle) {
    const eid = item.entityId!;
    if (!byEntity.has(eid)) byEntity.set(eid, []);
    byEntity.get(eid)!.push(item);
  }

  let assigned = 0;
  let created = 0;
  const updatedClusterIds = new Set<string>();

  for (const [entityId, items] of byEntity) {
    const activeClusters = await db
      .select({
        id: clusters.id,
        label: clusters.label,
        itemCount: clusters.itemCount,
        lastSeenAt: clusters.lastSeenAt,
      })
      .from(clusters)
      .where(and(eq(clusters.entityId, entityId), isNull(clusters.archivedAt)));

    // Phase 1: match all items (assigned or not) against existing labeled clusters
    const { matched, unmatched } = await matchToExistingClusters(items, activeClusters);

    // Apply Phase 1 assignments
    for (const [itemId, clusterId] of matched) {
      const item = items.find((i) => i.id === itemId)!;
      const clusterRow = activeClusters.find((c) => c.id === clusterId);
      if (!clusterRow) continue;

      const prevClusterId = currentClusterMap.get(itemId);

      // Already in the correct cluster
      if (prevClusterId === clusterId) {
        assigned++;
        continue;
      }

      try {
        // Move from old cluster if assigned elsewhere
        if (prevClusterId) {
          await db
            .delete(clusterItems)
            .where(and(eq(clusterItems.itemId, itemId), eq(clusterItems.clusterId, prevClusterId)));
          await db
            .update(clusters)
            .set({ itemCount: sql`GREATEST(${clusters.itemCount} - 1, 0)` })
            .where(eq(clusters.id, prevClusterId));
          updatedClusterIds.add(prevClusterId);
        }

        const newCount = clusterRow.itemCount + 1;
        await db
          .update(clusters)
          .set({ itemCount: newCount, lastSeenAt: item.publishedAt ?? new Date() })
          .where(eq(clusters.id, clusterId));

        await db
          .insert(clusterItems)
          .values({ clusterId, itemId, similarity: 1.0 })
          .onConflictDoNothing();

        clusterRow.itemCount = newCount;
        updatedClusterIds.add(clusterId);
        assigned++;
        currentClusterMap.set(itemId, clusterId);
      } catch (err) {
        console.error(`[run-cluster] assign item ${itemId}:`, err);
      }
    }

    // Phase 2: only group items with no existing cluster assignment.
    // Already-assigned items that didn't match Phase 1 stay in their current cluster.
    const trulyUnmatched = unmatched.filter((i) => !currentClusterMap.has(i.id));

    if (trulyUnmatched.length === 0) continue;

    const entityRow = await db
      .select({ label: trackedEntities.label })
      .from(trackedEntities)
      .where(eq(trackedEntities.id, entityId))
      .then((rows) => rows[0]);

    const entityLabel = entityRow?.label ?? "this entity";

    const groups = await groupNewItems(entityLabel, trulyUnmatched);

    for (const group of groups) {
      if (group.itemIds.length === 0) continue;

      const firstItem = trulyUnmatched.find((i) => i.id === group.itemIds[0])!;
      const now = firstItem.publishedAt ?? new Date();

      try {
        const [newCluster] = await db
          .insert(clusters)
          .values({
            entityId,
            label: group.label,
            itemCount: group.itemIds.length,
            firstSeenAt: now,
            lastSeenAt: now,
            suggestedKeywords: group.keywords.length > 0 ? group.keywords : null,
          })
          .returning();

        await db.insert(clusterItems).values(
          group.itemIds.map((itemId) => ({
            clusterId: newCluster.id,
            itemId,
            similarity: 1.0,
          }))
        );

        activeClusters.push({
          id: newCluster.id,
          label: group.label,
          itemCount: group.itemIds.length,
          lastSeenAt: now,
        });

        if (group.itemIds.length >= 2) {
          updatedClusterIds.add(newCluster.id);
        }

        created++;
        assigned += group.itemIds.length;
      } catch (err) {
        console.error(`[run-cluster] create cluster:`, err);
      }
    }
  }

  await updateVelocityAndStage([...updatedClusterIds]);

  return { assigned, created };
}
