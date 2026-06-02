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
  keywordFilters: z.array(z.string().min(1).max(100)),
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
    return NextResponse.json({ error: "Invalid keyword filters" }, { status: 400 });
  }

  const where = companyId
    ? and(eq(redditSubreddits.id, id), eq(redditSubreddits.companyId, companyId))
    : eq(redditSubreddits.id, id);

  const [row] = await db
    .update(redditSubreddits)
    .set({ keywordFilters: parsed.data.keywordFilters })
    .where(where)
    .returning();

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    subredditName: row.subredditName,
    keywordFilters: row.keywordFilters ?? [],
    createdAt: row.createdAt,
  });
}
