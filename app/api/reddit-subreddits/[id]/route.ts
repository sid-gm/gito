import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { redditSubreddits } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const where = companyId
    ? and(eq(redditSubreddits.id, id), eq(redditSubreddits.companyId, companyId))
    : eq(redditSubreddits.id, id);

  await db.delete(redditSubreddits).where(where);
  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  keywordFilters: z.array(z.string().min(1).max(100)).optional(),
  sorts: z.array(z.enum(["new", "hot"])).min(1).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updates: Partial<typeof redditSubreddits.$inferInsert> = {};
  if (parsed.data.keywordFilters) updates.keywordFilters = parsed.data.keywordFilters;
  if (parsed.data.sorts) updates.sorts = [...new Set(parsed.data.sorts)];
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const where = companyId
    ? and(eq(redditSubreddits.id, id), eq(redditSubreddits.companyId, companyId))
    : eq(redditSubreddits.id, id);

  const [row] = await db.update(redditSubreddits).set(updates).where(where).returning();
  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json(row);
}
