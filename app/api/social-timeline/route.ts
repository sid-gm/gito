import { NextResponse } from "next/server";
import { and, asc, avg, count, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackedEntities, ingestedItems, clusterItems, clusters } from "@/lib/db/schema";

const SOCIAL_PLATFORMS = ["reddit", "twitter", "hackernews", "threads"] as const;

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
  const entityId = searchParams.get("entityId");
  const window = searchParams.get("window") ?? "30d";

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  const windowDays = window === "90d" ? 90 : window === "30d" ? 30 : 7;
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const entityConditions = [eq(trackedEntities.companyId, companyId)];
  if (entityId) entityConditions.push(eq(trackedEntities.id, entityId));

  const entities = await db
    .select({ id: trackedEntities.id, label: trackedEntities.label, entityType: trackedEntities.entityType })
    .from(trackedEntities)
    .where(and(...entityConditions))
    .orderBy(asc(trackedEntities.label));

  const result = await Promise.all(
    entities.map(async (entity) => {
      const [dailyRows, storyRows] = await Promise.all([
        // Daily item counts + average sentiment from linked clusters
        db
          .select({
            day: sql<string>`DATE(${ingestedItems.publishedAt})`,
            itemCount: count(ingestedItems.id),
            avgSentiment: avg(clusters.sentimentScore),
          })
          .from(ingestedItems)
          .leftJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
          .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
          .where(
            and(
              eq(ingestedItems.entityId, entity.id),
              inArray(ingestedItems.platform, [...SOCIAL_PLATFORMS]),
              gte(ingestedItems.publishedAt, cutoff)
            )
          )
          .groupBy(sql`DATE(${ingestedItems.publishedAt})`),

        // Cluster stories per day
        db
          .select({
            day: sql<string>`DATE(${ingestedItems.publishedAt})`,
            label: clusters.label,
            summary: clusters.narrativeSummary,
            sentiment: clusters.sentimentLabel,
            score: clusters.sentimentScore,
            count: count(ingestedItems.id),
          })
          .from(ingestedItems)
          .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
          .innerJoin(clusters, eq(clusters.id, clusterItems.clusterId))
          .where(
            and(
              eq(ingestedItems.entityId, entity.id),
              inArray(ingestedItems.platform, [...SOCIAL_PLATFORMS]),
              gte(ingestedItems.publishedAt, cutoff)
            )
          )
          .groupBy(sql`DATE(${ingestedItems.publishedAt})`, clusters.id),
      ]);

      // Index by date string
      const dayMap = new Map(dailyRows.map((r) => [r.day, r]));
      const storyMap = new Map<string, typeof storyRows>();
      for (const sr of storyRows) {
        if (!storyMap.has(sr.day)) storyMap.set(sr.day, []);
        storyMap.get(sr.day)!.push(sr);
      }

      // Build full date range, day by day
      const days: {
        date: string;
        aiSummary: string | null;
        sentimentScore: number | null;
        sentimentLabel: string | null;
        itemCount: number;
        stories: { label: string; summary: string; sentiment: string; score: number; count: number }[];
      }[] = [];

      const today = new Date();
      const cursor = new Date(cutoff);
      while (cursor <= today) {
        const dateStr = cursor.toISOString().slice(0, 10);
        const row = dayMap.get(dateStr);
        const avgScore = row?.avgSentiment != null ? Number(row.avgSentiment) : null;
        const stories = (storyMap.get(dateStr) ?? [])
          .filter((s) => s.label)
          .map((s) => ({
            label: s.label!,
            summary: s.summary ?? "",
            sentiment: s.sentiment ?? "neutral",
            score: s.score ?? 0,
            count: Number(s.count),
          }));

        // Use the top cluster's narrative as the chip summary
        const topStory = [...stories].sort((a, b) => b.count - a.count)[0] ?? null;
        const aiSummary = topStory?.summary || null;

        days.push({
          date: dateStr,
          aiSummary,
          sentimentScore: avgScore,
          sentimentLabel: scoreToLabel(avgScore),
          itemCount: row ? Number(row.itemCount) : 0,
          stories,
        });

        cursor.setDate(cursor.getDate() + 1);
      }

      const totalItems = days.reduce((s, d) => s + d.itemCount, 0);
      if (totalItems === 0) return null;

      return {
        feedId: entity.id,
        feedLabel: entity.label,
        entityId: entity.id,
        entityLabel: entity.label,
        entityType: entity.entityType,
        days,
      };
    })
  );

  const feeds = result.filter(Boolean);
  return NextResponse.json({ feeds });
}
