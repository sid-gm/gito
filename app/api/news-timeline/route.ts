import { NextResponse } from "next/server";
import { and, asc, eq, gte, SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { rssFeeds, trackedEntities, newsTimelineDays, ingestedItems } from "@/lib/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const entityId = searchParams.get("entityId");
  const window = searchParams.get("window") ?? "7d";

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  const windowDays = window === "90d" ? 90 : window === "30d" ? 30 : 7;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const conditions: SQL[] = [eq(trackedEntities.companyId, companyId)];
  if (entityId) conditions.push(eq(trackedEntities.id, entityId));

  const feeds = await db
    .select({
      feedId: rssFeeds.id,
      feedLabel: rssFeeds.label,
      entityId: trackedEntities.id,
      entityLabel: trackedEntities.label,
      entityType: trackedEntities.entityType,
    })
    .from(rssFeeds)
    .innerJoin(trackedEntities, eq(rssFeeds.entityId, trackedEntities.id))
    .where(and(...conditions))
    .orderBy(asc(rssFeeds.label));

  const result = await Promise.all(
    feeds.map(async (feed) => {
      const days = await db
        .select({
          date: newsTimelineDays.periodDate,
          aiSummary: newsTimelineDays.aiSummary,
          sentimentScore: newsTimelineDays.sentimentScore,
          sentimentLabel: newsTimelineDays.sentimentLabel,
          itemCount: newsTimelineDays.itemCount,
          stories: newsTimelineDays.stories,
        })
        .from(newsTimelineDays)
        .where(
          and(
            eq(newsTimelineDays.rssFeedId, feed.feedId),
            gte(newsTimelineDays.periodDate, cutoff)
          )
        )
        .orderBy(asc(newsTimelineDays.periodDate));

      return { ...feed, days };
    })
  );

  // Append virtual manual feed for flagged manual articles
  const manualEntityConditions: SQL[] = [eq(trackedEntities.companyId, companyId)];
  if (entityId) manualEntityConditions.push(eq(ingestedItems.entityId, entityId));

  const manualRows = await db
    .select({ publishedAt: ingestedItems.publishedAt })
    .from(ingestedItems)
    .innerJoin(trackedEntities, eq(ingestedItems.entityId, trackedEntities.id))
    .where(
      and(
        eq(ingestedItems.platform, "manual"),
        eq(ingestedItems.showInNewsTimeline, true),
        eq(trackedEntities.companyId, companyId),
        gte(ingestedItems.publishedAt, new Date(`${cutoff}T00:00:00.000Z`)),
        ...(entityId ? [eq(ingestedItems.entityId, entityId)] : [])
      )
    );

  const extraFeeds: { feedId: string; feedLabel: string; entityId: string; entityLabel: string; entityType: string; days: { date: string; aiSummary: null; sentimentScore: null; sentimentLabel: null; itemCount: number; stories: null }[] }[] = [];

  if (manualRows.length > 0) {
    const byDate = new Map<string, number>();
    for (const row of manualRows) {
      const date = row.publishedAt?.toISOString().slice(0, 10);
      if (date) byDate.set(date, (byDate.get(date) ?? 0) + 1);
    }
    const manualDays = Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({
        date,
        aiSummary: null as null,
        sentimentScore: null as null,
        sentimentLabel: null as null,
        itemCount: count,
        stories: null as null,
      }));
    extraFeeds.push({
      feedId: `__manual__:${companyId}`,
      feedLabel: "Manual Articles",
      entityId: "__manual__",
      entityLabel: "Manual",
      entityType: "manual",
      days: manualDays,
    });
  }

  return NextResponse.json({ feeds: [...result, ...extraFeeds] });
}
