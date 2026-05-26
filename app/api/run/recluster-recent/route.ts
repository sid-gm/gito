import { NextResponse } from "next/server";
import { and, count, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems } from "@/lib/db/schema";
import { runClustering } from "@/lib/ai/run-cluster";

const DAYS = 5;

export async function POST() {
  const cutoff = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000);

  // 1. Find cluster_items rows for items published in the last 5 days
  const recentAssignments = await db
    .select({ clusterId: clusterItems.clusterId, itemId: clusterItems.itemId })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(gte(ingestedItems.publishedAt, cutoff));

  const itemIds = recentAssignments.map((r) => r.itemId);
  const affectedClusterIds = [...new Set(recentAssignments.map((r) => r.clusterId))];

  console.log(`[recluster-recent] unassigning ${itemIds.length} items from ${affectedClusterIds.length} clusters`);

  // 2. Delete those cluster_items rows
  if (itemIds.length > 0) {
    const CHUNK = 500;
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      await db
        .delete(clusterItems)
        .where(inArray(clusterItems.itemId, itemIds.slice(i, i + CHUNK)));
    }
  }

  // 3. Recount affected clusters and delete those that are now empty
  const deletedClusterIds: string[] = [];
  const survivingClusterIds: string[] = [];

  for (const clusterId of affectedClusterIds) {
    const [{ cnt }] = await db
      .select({ cnt: count(clusterItems.itemId) })
      .from(clusterItems)
      .where(eq(clusterItems.clusterId, clusterId));

    if (cnt === 0) {
      await db.delete(clusters).where(eq(clusters.id, clusterId));
      deletedClusterIds.push(clusterId);
    } else {
      await db.update(clusters).set({ itemCount: cnt }).where(eq(clusters.id, clusterId));
      survivingClusterIds.push(clusterId);
    }
  }

  console.log(`[recluster-recent] deleted ${deletedClusterIds.length} empty clusters, ${survivingClusterIds.length} surviving`);

  // 4. Re-run LLM clustering on all now-unassigned items (large limit to catch everything)
  const result = await runClustering(1000);

  console.log(`[recluster-recent] re-clustered: assigned ${result.assigned}, created ${result.created}`);

  return NextResponse.json({
    ok: true,
    unassigned: itemIds.length,
    clustersDeleted: deletedClusterIds.length,
    clustersSurvived: survivingClusterIds.length,
    reclusteredAssigned: result.assigned,
    reclusteredCreated: result.created,
  });
}
