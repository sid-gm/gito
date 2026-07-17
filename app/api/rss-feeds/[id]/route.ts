import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rssFeeds } from "@/lib/db/schema";
import { z } from "zod";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await db.delete(rssFeeds).where(eq(rssFeeds.id, id));
  return new NextResponse(null, { status: 204 });
}

const patchSchema = z.object({
  label: z.string().min(1).optional(),
  topicId: z.string().uuid().nullish(),
  isActive: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const updates: Partial<typeof rssFeeds.$inferInsert> = {};
  if (parsed.data.label) updates.label = parsed.data.label;
  if (parsed.data.topicId !== undefined) updates.topicId = parsed.data.topicId;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const [row] = await db.update(rssFeeds).set(updates).where(eq(rssFeeds.id, id)).returning();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(row);
}
