import { and, eq, isNull, ne } from "drizzle-orm";
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

  // Items without a cluster assignment — no embedding required
  const unassigned = await db
    .select({
      id: ingestedItems.id,
      entityId: ingestedItems.entityId,
      title: ingestedItems.title,
      publishedAt: ingestedItems.publishedAt,
    })
    .from(ingestedItems)
    .leftJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(and(isNull(clusterItems.itemId), ne(ingestedItems.platform, "google_alerts")))
    .limit(limit);

  const withTitle = unassigned.filter((i) => i.entityId && i.title?.trim());

  if (withTitle.length === 0) {
    return { assigned: 0, created: 0 };
  }

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

    // Phase 1: match against existing labeled clusters
    const { matched, unmatched } = await matchToExistingClusters(items, activeClusters);

    // Apply Phase 1 assignments
    for (const [itemId, clusterId] of matched) {
      const item = items.find((i) => i.id === itemId)!;
      const clusterRow = activeClusters.find((c) => c.id === clusterId);
      if (!clusterRow) continue;

      try {
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
      } catch (err) {
        console.error(`[run-cluster] assign item ${itemId}:`, err);
      }
    }

    if (unmatched.length === 0) continue;

    // Phase 2: group unmatched items into new clusters
    const entityRow = await db
      .select({ label: trackedEntities.label })
      .from(trackedEntities)
      .where(eq(trackedEntities.id, entityId))
      .then((rows) => rows[0]);

    const entityLabel = entityRow?.label ?? "this entity";

    const groups = await groupNewItems(entityLabel, unmatched);

    for (const group of groups) {
      if (group.itemIds.length === 0) continue;

      const firstItem = unmatched.find((i) => i.id === group.itemIds[0])!;
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
