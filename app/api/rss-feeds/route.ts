import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { rssFeeds, trackedEntities } from "@/lib/db/schema";
import { z } from "zod";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entityId");
  const companyId = searchParams.get("companyId");

  if (!entityId && !companyId) {
    return NextResponse.json({ error: "entityId or companyId required" }, { status: 400 });
  }

  try {
    if (entityId) {
      const feeds = await db
        .select()
        .from(rssFeeds)
        .where(eq(rssFeeds.entityId, entityId))
        .orderBy(asc(rssFeeds.createdAt));
      return NextResponse.json(feeds);
    }

    // companyId: join through trackedEntities
    const feeds = await db
      .select({ id: rssFeeds.id, entityId: rssFeeds.entityId, label: rssFeeds.label, feedUrl: rssFeeds.feedUrl, createdAt: rssFeeds.createdAt })
      .from(rssFeeds)
      .innerJoin(trackedEntities, eq(rssFeeds.entityId, trackedEntities.id))
      .where(eq(trackedEntities.companyId, companyId!))
      .orderBy(asc(rssFeeds.createdAt));
    return NextResponse.json(feeds);
  } catch (err) {
    console.error("[GET /api/rss-feeds]", err);
    return NextResponse.json({ error: "Failed to load feeds" }, { status: 500 });
  }
}

const createSchema = z.object({
  entityId: z.string().uuid(),
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
      .values(parsed.data)
      .onConflictDoNothing()
      .returning();
    if (!feed) return NextResponse.json({ error: "Feed already exists for this entity + URL" }, { status: 409 });
    return NextResponse.json(feed, { status: 201 });
  } catch (err) {
    console.error("[POST /api/rss-feeds]", err);
    return NextResponse.json({ error: "Failed to save feed" }, { status: 500 });
  }
}
