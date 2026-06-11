import { NextResponse } from "next/server";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { clusterItems, clusters, ingestedItems } from "@/lib/db/schema";

async function recountCluster(clusterId: string) {
  const [{ total }] = await db
    .select({ total: count(clusterItems.itemId) })
    .from(clusterItems)
    .where(eq(clusterItems.clusterId, clusterId));
  await db
    .update(clusters)
    .set({ itemCount: total })
    .where(eq(clusters.id, clusterId));
  return total;
}

// Remove an item from this cluster. With { deleteItem: true } the underlying
// ingested item is deleted entirely (cascades out of all clusters).
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const deleteItem =
    new URL(req.url).searchParams.get("deleteItem") === "true";

  const deleted = await db
    .delete(clusterItems)
    .where(and(eq(clusterItems.clusterId, id), eq(clusterItems.itemId, itemId)))
    .returning({ itemId: clusterItems.itemId });

  if (deleted.length === 0) {
    return NextResponse.json({ error: "Item not in cluster" }, { status: 404 });
  }

  if (deleteItem) {
    await db.delete(ingestedItems).where(eq(ingestedItems.id, itemId));
  }

  const itemCount = await recountCluster(id);
  return NextResponse.json({ ok: true, itemCount });
}

// Move an item to another cluster, preserving signals and analyst annotations.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const { targetClusterId } = z
    .object({ targetClusterId: z.string().uuid() })
    .parse(await req.json());

  if (targetClusterId === id) {
    return NextResponse.json({ error: "Item is already in this cluster" }, { status: 400 });
  }

  const [target] = await db
    .select({ id: clusters.id })
    .from(clusters)
    .where(eq(clusters.id, targetClusterId));
  if (!target) {
    return NextResponse.json({ error: "Target cluster not found" }, { status: 404 });
  }

  const [source] = await db
    .select()
    .from(clusterItems)
    .where(and(eq(clusterItems.clusterId, id), eq(clusterItems.itemId, itemId)));
  if (!source) {
    return NextResponse.json({ error: "Item not in cluster" }, { status: 404 });
  }

  // Insert-then-delete (vs update) so a duplicate membership in the target
  // collapses cleanly instead of violating the primary key.
  await db
    .insert(clusterItems)
    .values({ ...source, clusterId: targetClusterId })
    .onConflictDoNothing();
  await db
    .delete(clusterItems)
    .where(and(eq(clusterItems.clusterId, id), eq(clusterItems.itemId, itemId)));

  const sourceCount = await recountCluster(id);
  const targetCount = await recountCluster(targetClusterId);
  return NextResponse.json({ ok: true, sourceCount, targetCount });
}
