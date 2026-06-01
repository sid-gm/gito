import { NextResponse } from "next/server";
import { count, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems } from "@/lib/db/schema";

/**
 * POST /api/migrate/remove-google-alerts-from-clusters
 *
 * One-time migration: removes all google_alerts items from cluster_items,
 * deletes clusters that become empty, and recounts survivors.
 *
 * Safe to run multiple times (idempotent).
 */
export async function POST() {
  // 1. Find all cluster_items rows whose item is from google_alerts
  const googleAlertLinks = await db
    .select({ itemId: clusterItems.itemId, clusterId: clusterItems.clusterId })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(sql`${ingestedItems.platform} = 'google_alerts'`);

  const itemIdsToRemove = googleAlertLinks.map((r) => r.itemId);
  const affectedClusterIds = [...new Set(googleAlertLinks.map((r) => r.clusterId))];

  console.log(
    `[migrate/remove-google-alerts-from-clusters] found ${itemIdsToRemove.length} cluster_items to remove across ${affectedClusterIds.length} clusters`
  );

  if (itemIdsToRemove.length === 0) {
    return NextResponse.json({ ok: true, removedLinks: 0, deletedClusters: 0, survivingClusters: 0 });
  }

  // 2. Delete those cluster_items rows in chunks
  const CHUNK = 500;
  let removedLinks = 0;
  for (let i = 0; i < itemIdsToRemove.length; i += CHUNK) {
    const deleted = await db
      .delete(clusterItems)
      .where(inArray(clusterItems.itemId, itemIdsToRemove.slice(i, i + CHUNK)))
      .returning();
    removedLinks += deleted.length;
  }

  // 3. Recount affected clusters; delete empty ones
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

  console.log(
    `[migrate/remove-google-alerts-from-clusters] removed ${removedLinks} links, deleted ${deletedClusterIds.length} empty clusters, ${survivingClusterIds.length} surviving`
  );

  return NextResponse.json({
    ok: true,
    removedLinks,
    deletedClusters: deletedClusterIds.length,
    survivingClusters: survivingClusterIds.length,
  });
}
