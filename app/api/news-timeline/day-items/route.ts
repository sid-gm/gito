import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const feedId = searchParams.get("feedId");
  const date = searchParams.get("date");
  const entityId = searchParams.get("entityId");

  if (!feedId || !date) {
    return NextResponse.json({ error: "feedId and date are required" }, { status: 400 });
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  const cols = {
    id: ingestedItems.id,
    title: ingestedItems.title,
    body: ingestedItems.body,
    url: ingestedItems.url,
    publishedAt: ingestedItems.publishedAt,
    author: ingestedItems.author,
  };

  const googleItems = await db
    .select(cols)
    .from(ingestedItems)
    .where(
      and(
        eq(ingestedItems.rssFeedId, feedId),
        gte(ingestedItems.publishedAt, dayStart),
        lt(ingestedItems.publishedAt, dayEnd)
      )
    )
    .orderBy(ingestedItems.publishedAt);

  let manualItems: typeof googleItems = [];
  if (entityId) {
    manualItems = await db
      .select(cols)
      .from(ingestedItems)
      .where(
        and(
          eq(ingestedItems.entityId, entityId),
          eq(ingestedItems.platform, "manual"),
          eq(ingestedItems.showInNewsTimeline, true),
          gte(ingestedItems.publishedAt, dayStart),
          lt(ingestedItems.publishedAt, dayEnd)
        )
      )
      .orderBy(ingestedItems.publishedAt);
  }

  const all = [...googleItems, ...manualItems].sort(
    (a, b) => (a.publishedAt?.getTime() ?? 0) - (b.publishedAt?.getTime() ?? 0)
  );

  return NextResponse.json({
    items: all.map((it) => ({
      ...it,
      publishedAt: it.publishedAt?.toISOString() ?? null,
    })),
  });
}
