import { NextResponse } from "next/server";
import { and, avg, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackedEntities, ingestedItems, clusterItems, clusters, newsTimelineDays, rssFeeds } from "@/lib/db/schema";

const PLATFORM_LABELS: Record<string, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  hackernews: "Hacker News",
  threads: "Threads",
  instagram: "Instagram",
  facebook: "Facebook",
  google_alerts: "News",
  manual: "Manual",
};

const PLATFORM_ORDER = ["reddit", "twitter", "hackernews", "threads", "instagram", "facebook", "google_alerts", "manual"];

function scoreToLabel(score: number | null): string | null {
  if (score == null) return null;
  if (score >= 0.2) return "positive";
  if (score <= -0.2) return "negative";
  if (Math.abs(score) < 0.05) return "neutral";
  return "mixed";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const window = searchParams.get("window") ?? "30d";

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  const windowDays = window === "90d" ? 90 : window === "30d" ? 30 : 7;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [dailyRows, itemDailyRows, storyRows, newsDayRows] = await Promise.all([
    db
      .select({
        platform: ingestedItems.platform,
        day: sql<string>`DATE(${ingestedItems.publishedAt})`,
        itemCount: count(ingestedItems.id),
        avgSentiment: avg(clusters.sentimentScore),
      })
      .from(ingestedItems)
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .leftJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
      .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
      .where(
        and(
          eq(trackedEntities.companyId, companyId),
          gte(ingestedItems.publishedAt, cutoff),
          isNotNull(ingestedItems.publishedAt)
        )
      )
      .groupBy(ingestedItems.platform, sql`DATE(${ingestedItems.publishedAt})`),

    // Per-item sentiment aggregates — preferred over the cluster average when
    // a day has scored items (no cluster join, so counts can't be inflated)
    db
      .select({
        platform: ingestedItems.platform,
        day: sql<string>`DATE(${ingestedItems.publishedAt})`,
        itemCount: count(ingestedItems.id),
        scoredCount: count(ingestedItems.sentimentScore),
        avgItemSentiment: avg(ingestedItems.sentimentScore),
        posCount: sql<number>`COUNT(*) FILTER (WHERE ${ingestedItems.sentimentScore} >= 0.2)`,
        negCount: sql<number>`COUNT(*) FILTER (WHERE ${ingestedItems.sentimentScore} <= -0.2)`,
      })
      .from(ingestedItems)
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .where(
        and(
          eq(trackedEntities.companyId, companyId),
          gte(ingestedItems.publishedAt, cutoff),
          isNotNull(ingestedItems.publishedAt)
        )
      )
      .groupBy(ingestedItems.platform, sql`DATE(${ingestedItems.publishedAt})`),

    db
      .select({
        platform: ingestedItems.platform,
        day: sql<string>`DATE(${ingestedItems.publishedAt})`,
        clusterId: clusters.id,
        label: clusters.label,
        summary: clusters.narrativeSummary,
        sentiment: clusters.sentimentLabel,
        score: clusters.sentimentScore,
        clusterCount: count(ingestedItems.id),
      })
      .from(ingestedItems)
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
      .innerJoin(clusters, eq(clusters.id, clusterItems.clusterId))
      .where(
        and(
          eq(trackedEntities.companyId, companyId),
          gte(ingestedItems.publishedAt, cutoff),
          isNotNull(ingestedItems.publishedAt)
        )
      )
      .groupBy(
        ingestedItems.platform,
        sql`DATE(${ingestedItems.publishedAt})`,
        clusters.id
      ),

    // News sentiment lives in news_timeline_days (headline-based), not clusters
    db
      .select({
        day: newsTimelineDays.periodDate,
        sentimentScore: newsTimelineDays.sentimentScore,
        itemCount: newsTimelineDays.itemCount,
        stories: newsTimelineDays.stories,
      })
      .from(newsTimelineDays)
      .innerJoin(rssFeeds, eq(rssFeeds.id, newsTimelineDays.rssFeedId))
      .innerJoin(trackedEntities, eq(trackedEntities.id, rssFeeds.entityId))
      .where(
        and(
          eq(trackedEntities.companyId, companyId),
          gte(newsTimelineDays.periodDate, cutoffStr)
        )
      ),
  ]);

  // Index daily rows by platform → date
  const platformDayMap = new Map<string, Map<string, { itemCount: number; avgSentiment: string | null }>>();
  for (const row of dailyRows) {
    if (!row.day) continue;
    if (!platformDayMap.has(row.platform)) platformDayMap.set(row.platform, new Map());
    platformDayMap.get(row.platform)!.set(row.day, {
      itemCount: Number(row.itemCount),
      avgSentiment: row.avgSentiment,
    });
  }

  // Index item-level sentiment aggregates by platform → date
  const itemDayMap = new Map<
    string,
    Map<string, { itemCount: number; scoredCount: number; avgItemSentiment: string | null; posCount: number; negCount: number }>
  >();
  for (const row of itemDailyRows) {
    if (!row.day) continue;
    if (!itemDayMap.has(row.platform)) itemDayMap.set(row.platform, new Map());
    itemDayMap.get(row.platform)!.set(row.day, {
      itemCount: Number(row.itemCount),
      scoredCount: Number(row.scoredCount),
      avgItemSentiment: row.avgItemSentiment,
      posCount: Number(row.posCount),
      negCount: Number(row.negCount),
    });
  }

  // Index story rows by platform → date → stories[]
  const platformStoryMap = new Map<string, Map<string, typeof storyRows>>();
  for (const sr of storyRows) {
    if (!sr.day) continue;
    if (!platformStoryMap.has(sr.platform)) platformStoryMap.set(sr.platform, new Map());
    const dayMap = platformStoryMap.get(sr.platform)!;
    if (!dayMap.has(sr.day)) dayMap.set(sr.day, []);
    dayMap.get(sr.day)!.push(sr);
  }

  // Aggregate news_timeline_days per date across the company's feeds,
  // weighted by item count
  const newsDayMap = new Map<
    string,
    { weightedSum: number; weight: number; stories: NonNullable<(typeof newsDayRows)[number]["stories"]> }
  >();
  for (const nd of newsDayRows) {
    if (!newsDayMap.has(nd.day)) newsDayMap.set(nd.day, { weightedSum: 0, weight: 0, stories: [] });
    const agg = newsDayMap.get(nd.day)!;
    if (nd.sentimentScore != null && nd.itemCount > 0) {
      agg.weightedSum += nd.sentimentScore * nd.itemCount;
      agg.weight += nd.itemCount;
    }
    if (nd.stories) agg.stories.push(...nd.stories);
  }

  const today = new Date();

  // Build one NtlFeed per platform, sorted by canonical order
  const platforms = [...platformDayMap.keys()].sort((a, b) => {
    const ai = PLATFORM_ORDER.indexOf(a);
    const bi = PLATFORM_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const feeds = [];
  for (const platform of platforms) {
    const dayMap = platformDayMap.get(platform)!;
    const itemAggDayMap =
      itemDayMap.get(platform) ??
      new Map<string, { itemCount: number; scoredCount: number; avgItemSentiment: string | null; posCount: number; negCount: number }>();
    const storyDayMap: Map<string, typeof storyRows> = platformStoryMap.get(platform) ?? new Map();

    const days: {
      date: string;
      aiSummary: string | null;
      sentimentScore: number | null;
      sentimentLabel: string | null;
      itemCount: number;
      scoredCount: number;
      posCount: number;
      negCount: number;
      stories: { label: string; summary: string; sentiment: string; score: number; count: number }[];
    }[] = [];

    const cursor = new Date(cutoff);
    while (cursor <= today) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const row = dayMap.get(dateStr);
      const itemAgg = itemAggDayMap.get(dateStr);
      // Prefer the average of that day's own item scores; cluster-lifetime
      // average is only the fallback for unscored history
      let avgScore =
        itemAgg && itemAgg.scoredCount > 0 && itemAgg.avgItemSentiment != null
          ? Number(itemAgg.avgItemSentiment)
          : row?.avgSentiment != null
            ? Number(row.avgSentiment)
            : null;

      const rawStories = storyDayMap.get(dateStr) ?? [];
      let stories = rawStories
        .filter((s) => s.label)
        .sort((a, b) => Number(b.clusterCount) - Number(a.clusterCount))
        .slice(0, 3)
        .map((s) => ({
          label: s.label!,
          summary: s.summary ?? "",
          sentiment: s.sentiment ?? "neutral",
          score: s.score ?? 0,
          count: Number(s.clusterCount),
        }));

      // News fallback when the day's items are unscored: headline-based
      // news_timeline_days sentiment beats the cluster average
      if (platform === "google_alerts") {
        const newsAgg = newsDayMap.get(dateStr);
        const hasItemScores = itemAgg != null && itemAgg.scoredCount > 0;
        if (!hasItemScores && newsAgg && newsAgg.weight > 0) {
          avgScore = newsAgg.weightedSum / newsAgg.weight;
        }
        if (stories.length === 0 && newsAgg && newsAgg.stories.length > 0) {
          stories = [...newsAgg.stories]
            .sort((a, b) => b.count - a.count)
            .slice(0, 3);
        }
      }

      days.push({
        date: dateStr,
        aiSummary: stories[0]?.summary || null,
        sentimentScore: avgScore,
        sentimentLabel: scoreToLabel(avgScore),
        itemCount: itemAgg ? itemAgg.itemCount : row ? row.itemCount : 0,
        scoredCount: itemAgg?.scoredCount ?? 0,
        posCount: itemAgg?.posCount ?? 0,
        negCount: itemAgg?.negCount ?? 0,
        stories,
      });

      cursor.setDate(cursor.getDate() + 1);
    }

    const totalItems = days.reduce((s, d) => s + d.itemCount, 0);
    if (totalItems === 0) continue;

    const label = PLATFORM_LABELS[platform] ?? platform;
    feeds.push({
      feedId: platform,
      feedLabel: label,
      entityId: companyId,
      entityLabel: label,
      entityType: "keyword",
      days,
    });
  }

  return NextResponse.json({ feeds });
}
