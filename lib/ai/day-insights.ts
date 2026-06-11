import { and, avg, count, eq, gte, inArray, sql } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import {
  clusters,
  clusterItems,
  entityDayInsights,
  ingestedItems,
  newsTimelineDays,
  rssFeeds,
  trackedEntities,
} from "@/lib/db/schema";

// Same social-platform set the social timeline aggregates over
const SOCIAL_PLATFORMS = ["reddit", "twitter", "hackernews", "threads", "instagram", "facebook"] as const;
const SETTLED_AFTER_DAYS = 3; // history older than this is final once generated

export type DayInsightResult = { daysWritten: number; summariesGenerated: number };

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtScore(v: number | null): string {
  return v == null ? "no data" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}`;
}

// Build per-day news/social sentiment scores for an entity and have the LLM
// explain what drove each day — the "why did sentiment move" layer.
export async function buildEntityDayInsights(
  entityId: string,
  days = 14,
  force = false
): Promise<DayInsightResult> {
  const entity = await db
    .select({ label: trackedEntities.label })
    .from(trackedEntities)
    .where(eq(trackedEntities.id, entityId))
    .then((rows) => rows[0]);
  if (!entity) return { daysWritten: 0, summariesGenerated: 0 };

  const rangeStart = new Date(Date.now() - days * 24 * 3600000);
  const rangeStartStr = dateKey(rangeStart);

  // News: itemCount-weighted day average across the entity's feeds
  const newsRows = await db
    .select({
      periodDate: newsTimelineDays.periodDate,
      sentimentScore: newsTimelineDays.sentimentScore,
      itemCount: newsTimelineDays.itemCount,
      stories: newsTimelineDays.stories,
    })
    .from(newsTimelineDays)
    .innerJoin(rssFeeds, eq(newsTimelineDays.rssFeedId, rssFeeds.id))
    .where(and(eq(rssFeeds.entityId, entityId), gte(newsTimelineDays.periodDate, rangeStartStr)));

  type NewsDay = { score: number | null; stories: Array<{ label: string; summary: string; sentiment: string }> };
  const newsByDay = new Map<string, { weighted: number; weight: number; stories: NewsDay["stories"] }>();
  for (const r of newsRows) {
    if (!newsByDay.has(r.periodDate)) newsByDay.set(r.periodDate, { weighted: 0, weight: 0, stories: [] });
    const entry = newsByDay.get(r.periodDate)!;
    if (r.sentimentScore != null) {
      const w = Math.max(r.itemCount, 1);
      entry.weighted += r.sentimentScore * w;
      entry.weight += w;
    }
    for (const s of r.stories ?? []) {
      entry.stories.push({ label: s.label, summary: s.summary, sentiment: s.sentiment });
    }
  }

  // Social: day average of linked-cluster sentiment (same shape as the social timeline)
  const dayExpr = sql<string>`DATE(${ingestedItems.publishedAt})`;
  const socialDaily = await db
    .select({
      day: dayExpr,
      itemCount: count(ingestedItems.id),
      avgSentiment: avg(clusters.sentimentScore),
    })
    .from(ingestedItems)
    .leftJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .leftJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(
      and(
        eq(ingestedItems.entityId, entityId),
        inArray(ingestedItems.platform, [...SOCIAL_PLATFORMS]),
        gte(ingestedItems.publishedAt, rangeStart)
      )
    )
    .groupBy(dayExpr);
  const socialByDay = new Map(socialDaily.map((r) => [r.day, r]));

  // Per-day cluster activity for driver attribution
  const clusterDaily = await db
    .select({
      day: dayExpr,
      clusterId: clusters.id,
      label: clusters.label,
      narrativeSummary: clusters.narrativeSummary,
      sentimentLabel: clusters.sentimentLabel,
      itemCount: count(ingestedItems.id),
    })
    .from(ingestedItems)
    .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .innerJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(
      and(
        eq(ingestedItems.entityId, entityId),
        inArray(ingestedItems.platform, [...SOCIAL_PLATFORMS]),
        gte(ingestedItems.publishedAt, rangeStart)
      )
    )
    .groupBy(dayExpr, clusters.id);
  const clustersByDay = new Map<string, typeof clusterDaily>();
  for (const r of clusterDaily) {
    if (!clustersByDay.has(r.day)) clustersByDay.set(r.day, []);
    clustersByDay.get(r.day)!.push(r);
  }

  // Existing rows for freshness checks
  const existing = await db
    .select({ periodDate: entityDayInsights.periodDate, generatedAt: entityDayInsights.generatedAt })
    .from(entityDayInsights)
    .where(and(eq(entityDayInsights.entityId, entityId), gte(entityDayInsights.periodDate, rangeStartStr)));
  const existingByDay = new Map(existing.map((r) => [r.periodDate, r.generatedAt]));

  const settledCutoff = dateKey(new Date(Date.now() - SETTLED_AFTER_DAYS * 24 * 3600000));
  const now = new Date();
  let daysWritten = 0;
  let summariesGenerated = 0;

  let prevNews: number | null = null;
  let prevSocial: number | null = null;

  const cursor = new Date(rangeStart);
  const today = new Date();
  while (cursor <= today) {
    const day = dateKey(cursor);
    cursor.setDate(cursor.getDate() + 1);

    const newsEntry = newsByDay.get(day);
    const newsScore = newsEntry && newsEntry.weight > 0 ? newsEntry.weighted / newsEntry.weight : null;
    const socialRow = socialByDay.get(day);
    const socialScore = socialRow?.avgSentiment != null ? Number(socialRow.avgSentiment) : null;
    const socialItems = socialRow ? Number(socialRow.itemCount) : 0;

    const carryNews = newsScore;
    const carrySocial = socialScore;
    const dayPrevNews = prevNews;
    const dayPrevSocial = prevSocial;
    if (newsScore != null) prevNews = newsScore;
    if (socialScore != null) prevSocial = socialScore;

    // Nothing happened that day — don't write a row
    if (newsScore == null && socialScore == null && socialItems === 0) continue;

    // History is settled once generated; today/yesterday keep refreshing
    if (!force && day < settledCutoff && existingByDay.get(day)) continue;

    const dayClusters = [...(clustersByDay.get(day) ?? [])]
      .sort((a, b) => Number(b.itemCount) - Number(a.itemCount))
      .slice(0, 3);
    const topClusterIds = dayClusters.map((c) => c.clusterId);

    const divergence = carryNews != null && carrySocial != null ? carryNews - carrySocial : null;

    let driverSummary: string | null = null;
    const hasContext = (newsEntry?.stories.length ?? 0) > 0 || dayClusters.length > 0;
    if (hasContext) {
      try {
        const newsSection =
          newsEntry && newsEntry.stories.length > 0
            ? `News stories that day:\n${newsEntry.stories.slice(0, 5).map((s) => `- "${s.label}": ${s.summary} (${s.sentiment})`).join("\n")}`
            : "News stories that day: none";
        const socialSection =
          dayClusters.length > 0
            ? `Active social discussions that day:\n${dayClusters.map((c) => `- "${c.label ?? "unlabeled"}" (${c.itemCount} items${c.sentimentLabel ? `, ${c.sentimentLabel}` : ""})${c.narrativeSummary ? `: ${c.narrativeSummary}` : ""}`).join("\n")}`
            : "Active social discussions that day: none";

        const { text } = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `Date: ${day}. Entity: ${entity.label}.
News sentiment: ${fmtScore(carryNews)} (previous day ${fmtScore(dayPrevNews)}). Social sentiment: ${fmtScore(carrySocial)} (previous day ${fmtScore(dayPrevSocial)}).

${newsSection}

${socialSection}

In 1-2 sentences, state what drove the day's sentiment and why news and social differ (if they do). Name the specific stories or discussions by label. Plain text only, no preamble.`,
          maxOutputTokens: 120,
        });
        driverSummary = text.trim() || null;
        if (driverSummary) summariesGenerated++;
      } catch (err) {
        console.error(`[day-insights] ${entityId} ${day}:`, err);
      }
    }

    await db
      .insert(entityDayInsights)
      .values({
        entityId,
        periodDate: day,
        newsScore: carryNews,
        socialScore: carrySocial,
        divergence,
        driverSummary,
        topClusterIds: topClusterIds.length > 0 ? topClusterIds : null,
        generatedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [entityDayInsights.entityId, entityDayInsights.periodDate],
        set: {
          newsScore: carryNews,
          socialScore: carrySocial,
          divergence,
          ...(driverSummary != null && { driverSummary }),
          topClusterIds: topClusterIds.length > 0 ? topClusterIds : null,
          generatedAt: now,
          updatedAt: now,
        },
      });
    daysWritten++;
  }

  return { daysWritten, summariesGenerated };
}

export async function buildDayInsightsForAllEntities(
  days = 14,
  force = false
): Promise<DayInsightResult> {
  const entities = await db.select({ id: trackedEntities.id }).from(trackedEntities);
  let daysWritten = 0;
  let summariesGenerated = 0;
  for (const e of entities) {
    const result = await buildEntityDayInsights(e.id, days, force);
    daysWritten += result.daysWritten;
    summariesGenerated += result.summariesGenerated;
  }
  return { daysWritten, summariesGenerated };
}
