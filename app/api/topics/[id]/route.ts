import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { topics } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  label: z.string().min(1).max(80).transform((v) => v.trim()),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const [row] = await db
    .update(topics)
    .set({ label: parsed.data.label })
    .where(eq(topics.id, id))
    .returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

// Items keep their rows (topic_id → NULL via FK); keywords detach the same way
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await db.delete(topics).where(eq(topics.id, id));
  return NextResponse.json({ ok: true });
}
