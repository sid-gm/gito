import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems } from "@/lib/db/schema";
import { runClustering } from "@/lib/ai/run-cluster";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { id } = params;

  const items = await db
    .select({ itemId: clusterItems.itemId })
    .from(clusterItems)
    .where(eq(clusterItems.clusterId, id));

  if (items.length === 0) {
    return NextResponse.json({ error: "Cluster not found or already empty" }, { status: 404 });
  }

  await db.delete(clusterItems).where(eq(clusterItems.clusterId, id));
  await db.delete(clusters).where(eq(clusters.id, id));

  const result = await runClustering(1000);

  return NextResponse.json({
    ok: true,
    unassigned: items.length,
    reclusteredAssigned: result.assigned,
    reclusteredCreated: result.created,
  });
}
