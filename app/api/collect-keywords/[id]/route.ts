import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { collectKeywords } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  term: z.string().min(2).max(100).transform((v) => v.trim()).optional(),
  topicId: z.string().uuid().nullish(),
  platforms: z.array(z.enum(["twitter", "threads", "reddit"])).min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updates: Partial<typeof collectKeywords.$inferInsert> = {};
  if (parsed.data.term) updates.term = parsed.data.term;
  if (parsed.data.topicId !== undefined) updates.topicId = parsed.data.topicId;
  if (parsed.data.platforms) updates.platforms = [...new Set(parsed.data.platforms)];
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db.update(collectKeywords).set(updates).where(eq(collectKeywords.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const where = companyId
    ? and(eq(collectKeywords.id, id), eq(collectKeywords.companyId, companyId))
    : eq(collectKeywords.id, id);

  await db.delete(collectKeywords).where(where);
  return NextResponse.json({ ok: true });
}
