import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rssFeeds } from "@/lib/db/schema";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  try {
    const feeds = await db
      .select()
      .from(rssFeeds)
      .where(eq(rssFeeds.companyId, companyId))
      .orderBy(asc(rssFeeds.createdAt));
    return NextResponse.json(feeds);
  } catch (err) {
    console.error("[GET /api/rss-feeds]", err);
    return NextResponse.json({ error: "Failed to load feeds" }, { status: 500 });
  }
}

const createSchema = z.object({
  companyId: z.string().uuid(),
  topicId: z.string().uuid().nullish(),
  label: z.string().min(1),
  feedUrl: z.string().url(),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const [feed] = await db
      .insert(rssFeeds)
      .values({
        companyId: parsed.data.companyId,
        topicId: parsed.data.topicId ?? null,
        label: parsed.data.label,
        feedUrl: parsed.data.feedUrl,
      })
      .onConflictDoNothing()
      .returning();
    if (!feed) return NextResponse.json({ error: "Feed already exists for this company + URL" }, { status: 409 });
    return NextResponse.json(feed, { status: 201 });
  } catch (err) {
    console.error("[POST /api/rss-feeds]", err);
    return NextResponse.json({ error: "Failed to save feed" }, { status: 500 });
  }
}
