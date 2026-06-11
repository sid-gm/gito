import { NextResponse } from "next/server";
import { and, avg, count, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackedEntities, ingestedItems, clusterItems, clusters } from "@/lib/db/schema";

const VALID_PLATFORMS = [
  "hackernews", "reddit", "twitter", "google_alerts", "manual", "threads", "instagram", "facebook",
] as const;
type ValidPlatform = typeof VALID_PLATFORMS[number];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const platform = searchParams.get("platform");
  const date = searchParams.get("date");

  if (!companyId || !platform || !date) {
    return NextResponse.json({ error: "companyId, platform, and date are required" }, { status: 400 });
  }

  if (!VALID_PLATFORMS.includes(platform as ValidPlatform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const typedPlatform = platform as ValidPlatform;

  const dayFilter = and(
    eq(trackedEntities.companyId, companyId),
    eq(ingestedItems.platform, typedPlatform),
    gte(ingestedItems.publishedAt, dayStart),
    lt(ingestedItems.publishedAt, dayEnd)
  );

  const [clusterRows, itemRows, [breakdownRow]] = await Promise.all([
    // Ranked by how hard the cluster pulls the day's score: |day avg| × scored
    // items, so a small but sharply negative cluster outranks a big neutral one
    db
      .select({
        id: clusters.id,
        label: clusters.label,
        sentimentScore: clusters.sentimentScore,
        sentimentLabel: clusters.sentimentLabel,
        itemCount: count(ingestedItems.id),
        dayAvgScore: avg(ingestedItems.sentimentScore),
        dayScoredCount: count(ingestedItems.sentimentScore),
      })
      .from(clusters)
      .innerJoin(clusterItems, eq(clusterItems.clusterId, clusters.id))
      .innerJoin(ingestedItems, eq(ingestedItems.id, clusterItems.itemId))
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .where(dayFilter)
      .groupBy(clusters.id)
      .orderBy(
        desc(sql`ABS(COALESCE(AVG(${ingestedItems.sentimentScore}), 0)) * COUNT(${ingestedItems.sentimentScore})`),
        desc(count(ingestedItems.id))
      )
      .limit(5),

    // Strongest sentiment first (unscored items fall back to recency)
    db
      .select({
        id: ingestedItems.id,
        title: ingestedItems.title,
        body: ingestedItems.body,
        url: ingestedItems.url,
        publishedAt: ingestedItems.publishedAt,
        author: ingestedItems.author,
        subtype: ingestedItems.subtype,
        sentimentScore: ingestedItems.sentimentScore,
        sentimentLabel: ingestedItems.sentimentLabel,
      })
      .from(ingestedItems)
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .where(dayFilter)
      .orderBy(
        sql`ABS(${ingestedItems.sentimentScore}) DESC NULLS LAST`,
        desc(ingestedItems.publishedAt)
      )
      .limit(20),

    db
      .select({
        total: count(ingestedItems.id),
        scored: count(ingestedItems.sentimentScore),
        pos: sql<number>`COUNT(*) FILTER (WHERE ${ingestedItems.sentimentScore} >= 0.2)`,
        neg: sql<number>`COUNT(*) FILTER (WHERE ${ingestedItems.sentimentScore} <= -0.2)`,
      })
      .from(ingestedItems)
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .where(dayFilter),
  ]);

  // Engagement as replies: thread members share the root post's URL (the
  // ingestion convention for Reddit/X/IG/FB comments — parent_id is sparse),
  // so thread size = items on the same URL
  const itemUrls = [...new Set(itemRows.map((i) => i.url).filter((u): u is string => !!u))];
  const urlThreadMap = new Map<string, number>();
  if (itemUrls.length > 0) {
    const threadRows = await db
      .select({ url: ingestedItems.url, cnt: count(ingestedItems.id) })
      .from(ingestedItems)
      .where(inArray(ingestedItems.url, itemUrls))
      .groupBy(ingestedItems.url);
    for (const r of threadRows) {
      if (r.url) urlThreadMap.set(r.url, Number(r.cnt));
    }
  }

  return NextResponse.json({
    clusters: clusterRows.map((c) => ({
      id: c.id,
      label: c.label,
      sentimentScore: c.sentimentScore,
      sentimentLabel: c.sentimentLabel,
      itemCount: Number(c.itemCount),
      dayAvgScore: c.dayAvgScore != null ? Number(c.dayAvgScore) : null,
      dayScoredCount: Number(c.dayScoredCount),
    })),
    items: itemRows.map((it) => ({
      ...it,
      publishedAt: it.publishedAt?.toISOString() ?? null,
      replyCount: it.url ? Math.max((urlThreadMap.get(it.url) ?? 1) - 1, 0) : 0,
    })),
    breakdown: {
      total: Number(breakdownRow?.total ?? 0),
      scored: Number(breakdownRow?.scored ?? 0),
      pos: Number(breakdownRow?.pos ?? 0),
      neg: Number(breakdownRow?.neg ?? 0),
    },
  });
}
