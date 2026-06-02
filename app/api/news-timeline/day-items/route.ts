import { NextResponse } from "next/server";
import { and, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const feedId = searchParams.get("feedId");
  const date = searchParams.get("date");

  if (!feedId || !date) {
    return NextResponse.json({ error: "feedId and date are required" }, { status: 400 });
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);

  const items = await db
    .select({
      id: ingestedItems.id,
      title: ingestedItems.title,
      body: ingestedItems.body,
      url: ingestedItems.url,
      publishedAt: ingestedItems.publishedAt,
      author: ingestedItems.author,
    })
    .from(ingestedItems)
    .where(
      and(
        eq(ingestedItems.rssFeedId, feedId),
        gte(ingestedItems.publishedAt, dayStart),
        lt(ingestedItems.publishedAt, dayEnd)
      )
    )
    .orderBy(ingestedItems.publishedAt);

  return NextResponse.json({
    items: items.map((it) => ({
      ...it,
      publishedAt: it.publishedAt?.toISOString() ?? null,
    })),
  });
}
