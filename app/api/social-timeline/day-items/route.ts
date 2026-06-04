import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";

const SOCIAL_PLATFORMS = ["reddit", "twitter", "hackernews", "threads"] as const;

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entityId");
  const date = searchParams.get("date");

  if (!entityId || !date) {
    return NextResponse.json({ error: "entityId and date are required" }, { status: 400 });
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
        eq(ingestedItems.entityId, entityId),
        inArray(ingestedItems.platform, [...SOCIAL_PLATFORMS]),
        gte(ingestedItems.publishedAt, dayStart),
        lt(ingestedItems.publishedAt, dayEnd)
      )
    )
    .orderBy(desc(ingestedItems.publishedAt))
    .limit(20);

  return NextResponse.json({
    items: items.map((it) => ({
      ...it,
      publishedAt: it.publishedAt?.toISOString() ?? null,
    })),
  });
}
