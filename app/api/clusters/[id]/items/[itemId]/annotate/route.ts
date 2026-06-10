import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { clusters, clusterItems } from "@/lib/db/schema";

const schema = z.object({
  note: z.string().nullable().optional(),
  flag: z.enum(["review", "highlight"]).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  const { id, itemId } = await params;
  const body = schema.parse(await req.json());

  const patch: Record<string, unknown> = {};
  if ("note" in body) patch.analystNote = body.note ?? null;
  if ("flag" in body) patch.analystFlag = body.flag ?? null;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const now = new Date();

  await db
    .update(clusterItems)
    .set(patch)
    .where(and(eq(clusterItems.clusterId, id), eq(clusterItems.itemId, itemId)));

  await db
    .update(clusters)
    .set({ analystReviewedAt: now })
    .where(eq(clusters.id, id));

  return NextResponse.json({ ok: true, analystReviewedAt: now.toISOString() });
}
