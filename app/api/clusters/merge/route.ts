import { NextResponse } from "next/server";
import { and, eq, inArray, min, max, sum, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, clusterMerges } from "@/lib/db/schema";

export async function POST(req: Request) {
  const body = await req.json() as {
    clusterIds: string[];
    label: string | null;
    classification: "unclassified" | "narrative" | "noise";
  };

  const { clusterIds, label, classification } = body;
  if (!clusterIds || clusterIds.length < 2) {
    return NextResponse.json({ error: "Need at least 2 clusters to merge" }, { status: 400 });
  }

  const allowed = ["unclassified", "narrative", "noise"];
  if (!allowed.includes(classification)) {
    return NextResponse.json({ error: "Invalid classification" }, { status: 400 });
  }

  // Fetch all clusters
  const toMerge = await db
    .select()
    .from(clusters)
    .where(and(inArray(clusters.id, clusterIds)));

  if (toMerge.length < 2) {
    return NextResponse.json({ error: "One or more clusters not found" }, { status: 404 });
  }

  // Pick surviving cluster: largest itemCount, tie-break earliest firstSeenAt
  const surviving = toMerge.reduce((best, c) => {
    if (c.itemCount > best.itemCount) return c;
    if (c.itemCount === best.itemCount && c.firstSeenAt < best.firstSeenAt) return c;
    return best;
  });

  const absorbed = toMerge.filter((c) => c.id !== surviving.id);
  const now = new Date();

  // For each absorbed cluster: create merge record, move items, archive
  for (const absorbedCluster of absorbed) {
    const [merge] = await db
      .insert(clusterMerges)
      .values({
        survivingClusterId: surviving.id,
        absorbedLabel: absorbedCluster.label,
        absorbedFirstSeenAt: absorbedCluster.firstSeenAt,
        absorbedLastSeenAt: absorbedCluster.lastSeenAt,
        absorbedItemCount: absorbedCluster.itemCount,
      })
      .returning();

    // Drop items from absorbed cluster that already exist in surviving (PK conflict guard)
    await db.execute(
      sql`DELETE FROM cluster_items
          WHERE cluster_id = ${absorbedCluster.id}
            AND item_id IN (
              SELECT item_id FROM cluster_items WHERE cluster_id = ${surviving.id}
            )`
    );

    // Move remaining items from absorbed → surviving, tagging with mergeId
    await db
      .update(clusterItems)
      .set({ clusterId: surviving.id, mergeId: merge.id })
      .where(eq(clusterItems.clusterId, absorbedCluster.id));

    // Archive absorbed cluster
    await db
      .update(clusters)
      .set({ archivedAt: now })
      .where(eq(clusters.id, absorbedCluster.id));
  }

  // Compute merged stats across all clusters
  const [stats] = await db
    .select({
      totalItems: sum(clusters.itemCount),
      earliest: min(clusters.firstSeenAt),
      latest: max(clusters.lastSeenAt),
    })
    .from(clusters)
    .where(inArray(clusters.id, clusterIds));

  // Update surviving cluster
  await db
    .update(clusters)
    .set({
      label: label ?? surviving.label,
      classification,
      analystClassification: null,
      analystNote: null,
      classifiedAt: null, // triggers reclassify on next cron
      itemCount: Number(stats.totalItems ?? surviving.itemCount),
      firstSeenAt: stats.earliest ?? surviving.firstSeenAt,
      lastSeenAt: stats.latest ?? surviving.lastSeenAt,
    })
    .where(eq(clusters.id, surviving.id));

  const [updated] = await db.select().from(clusters).where(eq(clusters.id, surviving.id));
  return NextResponse.json({ ok: true, cluster: updated });
}
