import { NextResponse } from "next/server";
import { and, avg, count, eq, gte, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackedEntities, ingestedItems, clusterItems, clusters } from "@/lib/db/schema";

const PLATFORM_LABELS: Record<string, string> = {
  reddit: "Reddit",
  twitter: "Twitter / X",
  hackernews: "Hacker News",
  threads: "Threads",
  instagram: "Instagram",
  google_alerts: "News",
  manual: "Manual",
};

const PLATFORM_ORDER = ["reddit", "twitter", "hackernews", "threads", "instagram", "google_alerts", "manual"];

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

  const [dailyRows, storyRows] = await Promise.all([
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

  // Index story rows by platform → date → stories[]
  const platformStoryMap = new Map<string, Map<string, typeof storyRows>>();
  for (const sr of storyRows) {
    if (!sr.day) continue;
    if (!platformStoryMap.has(sr.platform)) platformStoryMap.set(sr.platform, new Map());
    const dayMap = platformStoryMap.get(sr.platform)!;
    if (!dayMap.has(sr.day)) dayMap.set(sr.day, []);
    dayMap.get(sr.day)!.push(sr);
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
    const storyDayMap: Map<string, typeof storyRows> = platformStoryMap.get(platform) ?? new Map();

    const days: {
      date: string;
      aiSummary: string | null;
      sentimentScore: number | null;
      sentimentLabel: string | null;
      itemCount: number;
      stories: { label: string; summary: string; sentiment: string; score: number; count: number }[];
    }[] = [];

    const cursor = new Date(cutoff);
    while (cursor <= today) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const row = dayMap.get(dateStr);
      const avgScore = row?.avgSentiment != null ? Number(row.avgSentiment) : null;

      const rawStories = storyDayMap.get(dateStr) ?? [];
      const stories = rawStories
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

      days.push({
        date: dateStr,
        aiSummary: stories[0]?.summary || null,
        sentimentScore: avgScore,
        sentimentLabel: scoreToLabel(avgScore),
        itemCount: row ? row.itemCount : 0,
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
