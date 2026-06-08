import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedThreads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(trackedThreads).where(eq(trackedThreads.id, id));
  return NextResponse.json({ ok: true });
}

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await _req.json().catch(() => ({}));
  const updates: Partial<typeof trackedThreads.$inferInsert> = {};
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (typeof body.label === "string") updates.label = body.label;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }
  const [row] = await db
    .update(trackedThreads)
    .set(updates)
    .where(eq(trackedThreads.id, id))
    .returning();
  return NextResponse.json(row);
}
