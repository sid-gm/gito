import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedEntities } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  queryString: z.string().min(1).optional(),
  entityType: z.enum(["keyword", "executive", "product"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updates = { ...parsed.data };

  const [updated] = await db
    .update(trackedEntities)
    .set(updates)
    .where(eq(trackedEntities.id, id))
    .returning();

  if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.delete(trackedEntities).where(eq(trackedEntities.id, id));
  return new NextResponse(null, { status: 204 });
}
