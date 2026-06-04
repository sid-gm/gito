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

  const cutoffDate = new Date(`${cutoff}T00:00:00.000Z`);

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

      // Merge manual articles for this entity into the days array
      const manualRows = await db
        .select({ publishedAt: ingestedItems.publishedAt })
        .from(ingestedItems)
        .where(
          and(
            eq(ingestedItems.entityId, feed.entityId),
            eq(ingestedItems.platform, "manual"),
            eq(ingestedItems.showInNewsTimeline, true),
            gte(ingestedItems.publishedAt, cutoffDate)
          )
        );

      // Merge manual articles into sparse days
      let mergedDays = [...days];
      if (manualRows.length > 0) {
        const byDate = new Map<string, number>();
        for (const row of manualRows) {
          const date = row.publishedAt?.toISOString().slice(0, 10);
          if (date) byDate.set(date, (byDate.get(date) ?? 0) + 1);
        }
        for (const [date, count] of byDate) {
          const existing = mergedDays.find((d) => d.date === date);
          if (existing) {
            existing.itemCount = (existing.itemCount ?? 0) + count;
          } else {
            mergedDays.push({ date, aiSummary: null, sentimentScore: null, sentimentLabel: null, itemCount: count, stories: null });
          }
        }
        mergedDays.sort((a, b) => a.date.localeCompare(b.date));
      }

      // Fill full date range so News and Social timelines share identical x-axis positions
      const dayMap = new Map(mergedDays.map((d) => [d.date, d]));
      const today = new Date();
      const cursor = new Date(`${cutoff}T00:00:00.000Z`);
      const fullDays: typeof mergedDays = [];
      while (cursor <= today) {
        const dateStr = cursor.toISOString().slice(0, 10);
        fullDays.push(dayMap.get(dateStr) ?? {
          date: dateStr, aiSummary: null, sentimentScore: null,
          sentimentLabel: null, itemCount: 0, stories: null,
        });
        cursor.setDate(cursor.getDate() + 1);
      }

      return { ...feed, days: fullDays };
    })
  );

  return NextResponse.json({ feeds: result });
}
