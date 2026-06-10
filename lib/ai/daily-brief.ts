import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import {
  clusters,
  clusterItems,
  companies,
  dailyBriefs,
  ingestedItems,
  storylines,
  trackedEntities,
} from "@/lib/db/schema";
import { buildClusterContext, formatClusterBlock } from "@/lib/ai/report-context";
import { pacificDateKey, pacificMidnightFromStr } from "@/lib/pacific-time";

const MAX_GROUPS = 3; // attention items in the brief
const CLUSTERS_PER_GROUP = 2; // member clusters whose full context is included

export type DailyBriefSnapshot = {
  headline: string;
  attentionItems: Array<{
    title: string;
    whatHappened: string;
    publicReaction: string;
    risk: string; // "low|medium|high — explanation"
    recommendation: string;
    storylineId: string | null;
    clusterIds: string[];
  }>;
  overallSentiment: { line: string; newsScore: number | null; socialScore: number | null };
  sources: { storylineCount: number; clusterCount: number; itemCount: number };
};

export type DailyBriefResult = { ok: boolean; skipped?: string; periodDate?: string };

// Build the day's executive brief for a company: the top storylines (cluster
// fallback when unassigned), what happened vs how the public reacted, risk and
// a recommendation — the Signal Brief shape lifted to day level.
export async function buildDailyBrief(
  companyId: string,
  dateKey?: string,
  force = false
): Promise<DailyBriefResult> {
  const periodDate = dateKey ?? pacificDateKey(new Date());
  const dayStart = pacificMidnightFromStr(periodDate);
  const dayEnd = pacificMidnightFromStr(
    pacificDateKey(new Date(dayStart.getTime() + 25 * 60 * 60 * 1000))
  );

  const company = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.id, companyId))
    .then((rows) => rows[0]);
  if (!company) return { ok: false, skipped: "company_not_found" };

  const entityRows = await db
    .select({ id: trackedEntities.id, label: trackedEntities.label })
    .from(trackedEntities)
    .where(eq(trackedEntities.companyId, companyId));
  if (entityRows.length === 0) return { ok: false, skipped: "no_entities" };
  const entityIds = entityRows.map((e) => e.id);
  const entityLabels = entityRows.map((e) => e.label).join(", ");

  // Clusters with activity inside the Pacific day window
  const dayItems = await db
    .select({
      clusterId: clusterItems.clusterId,
      createdAt: ingestedItems.createdAt,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .innerJoin(clusters, eq(clusters.id, clusterItems.clusterId))
    .where(
      and(
        isNull(clusters.archivedAt),
        inArray(clusters.entityId, entityIds),
        gte(ingestedItems.createdAt, dayStart),
        lt(ingestedItems.createdAt, dayEnd)
      )
    );
  if (dayItems.length === 0) return { ok: false, skipped: "no_activity" };

  const dayCountByCluster = new Map<string, number>();
  let latestItemAt = dayStart;
  for (const item of dayItems) {
    dayCountByCluster.set(item.clusterId, (dayCountByCluster.get(item.clusterId) ?? 0) + 1);
    if (item.createdAt > latestItemAt) latestItemAt = item.createdAt;
  }

  // Freshness: skip when the stored brief already covers the latest activity
  if (!force) {
    const existing = await db
      .select({ generatedAt: dailyBriefs.generatedAt })
      .from(dailyBriefs)
      .where(and(eq(dailyBriefs.companyId, companyId), eq(dailyBriefs.periodDate, periodDate)))
      .then((rows) => rows[0]);
    if (existing && existing.generatedAt >= latestItemAt) return { ok: false, skipped: "fresh", periodDate };
  }

  const activeClusterIds = [...dayCountByCluster.keys()];
  const activeClusters = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      storylineId: clusters.storylineId,
      sentimentScore: clusters.sentimentScore,
    })
    .from(clusters)
    .where(inArray(clusters.id, activeClusterIds));

  // Group by storyline; clusters without one stand alone (pre-storyline fallback)
  type Group = { storylineId: string | null; clusterIds: string[]; dayCount: number };
  const groupMap = new Map<string, Group>();
  for (const c of activeClusters) {
    const key = c.storylineId ?? `cluster:${c.id}`;
    if (!groupMap.has(key)) groupMap.set(key, { storylineId: c.storylineId, clusterIds: [], dayCount: 0 });
    const g = groupMap.get(key)!;
    g.clusterIds.push(c.id);
    g.dayCount += dayCountByCluster.get(c.id) ?? 0;
  }
  const groups = [...groupMap.values()].sort((a, b) => b.dayCount - a.dayCount).slice(0, MAX_GROUPS);

  const storylineRows = groups.some((g) => g.storylineId)
    ? await db
        .select({
          id: storylines.id,
          title: storylines.title,
          summary: storylines.summary,
          newsSentimentScore: storylines.newsSentimentScore,
          socialSentimentScore: storylines.socialSentimentScore,
        })
        .from(storylines)
        .where(inArray(storylines.id, groups.map((g) => g.storylineId).filter((id): id is string => !!id)))
    : [];
  const storylineById = new Map(storylineRows.map((s) => [s.id, s]));

  // Build context blocks per group
  const blocks: string[] = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const storyline = g.storylineId ? storylineById.get(g.storylineId) : null;

    const sortedMembers = [...g.clusterIds].sort(
      (a, b) => (dayCountByCluster.get(b) ?? 0) - (dayCountByCluster.get(a) ?? 0)
    );
    const memberBlocks: string[] = [];
    for (const clusterId of sortedMembers.slice(0, CLUSTERS_PER_GROUP)) {
      const ctx = await buildClusterContext(clusterId);
      if (ctx) memberBlocks.push(formatClusterBlock(ctx));
    }

    const header = storyline
      ? `[${i + 1}] STORYLINE: "${storyline.title}"${storyline.newsSentimentScore != null || storyline.socialSentimentScore != null ? ` (news ${storyline.newsSentimentScore?.toFixed(1) ?? "—"} / social ${storyline.socialSentimentScore?.toFixed(1) ?? "—"})` : ""} — ${g.dayCount} new items today${storyline.summary ? `\nArc so far: ${storyline.summary}` : ""}`
      : `[${i + 1}] STORY: "${activeClusters.find((c) => c.id === g.clusterIds[0])?.label ?? "Unnamed"}" — ${g.dayCount} new items today`;

    blocks.push(`${header}\n${memberBlocks.join("\n\n")}`);
  }

  const prompt = `You are the chief of staff preparing the daily media brief for ${entityLabels}. Date: ${periodDate}.

Today's active stories, most active first:

${blocks.join("\n\n---\n\n")}

Return a JSON object with exactly these fields:
- "headline": one sentence — the single most important thing today
- "attentionItems": array of AT MOST ${groups.length}, ordered by urgency, each with:
  "source": the story number above it refers to (1-${groups.length}),
  "title": short title,
  "whatHappened": what occurred, drawn primarily from news items,
  "publicReaction": how people online are reacting, drawn primarily from social items,
  "risk": one string "low|medium|high — concise explanation",
  "recommendation": one specific, actionable step
- "overallSentiment": {"line": one sentence on today's overall tone and any news-vs-social gap,
  "newsScore": number -1.0 to 1.0 or null, "socialScore": number -1.0 to 1.0 or null}

Respond with only valid JSON, no markdown.`;

  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt,
      temperature: 0.3,
      maxOutputTokens: 900,
    });

    const raw = text.trim().replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(raw) as {
      headline?: string;
      attentionItems?: Array<{
        source?: number;
        title?: string;
        whatHappened?: string;
        publicReaction?: string;
        risk?: unknown;
        recommendation?: string;
      }>;
      overallSentiment?: { line?: string; newsScore?: number | null; socialScore?: number | null };
    };

    const attentionItems = (Array.isArray(parsed.attentionItems) ? parsed.attentionItems : [])
      .slice(0, MAX_GROUPS)
      .map((item) => {
        const group = groups[(item.source ?? 0) - 1] ?? null;
        // Same hardening as the Signal Brief: coerce object-shaped risk to a string
        let risk = item.risk;
        if (risk && typeof risk !== "string") {
          const r = risk as { riskLevel?: string; explanation?: string };
          risk = [r.riskLevel, r.explanation].filter(Boolean).join(" — ");
        }
        return {
          title: item.title ?? "Untitled",
          whatHappened: item.whatHappened ?? "",
          publicReaction: item.publicReaction ?? "",
          risk: typeof risk === "string" ? risk : "",
          recommendation: item.recommendation ?? "",
          storylineId: group?.storylineId ?? null,
          clusterIds: group?.clusterIds ?? [],
        };
      });

    const snapshot: DailyBriefSnapshot = {
      headline: parsed.headline ?? "No headline generated",
      attentionItems,
      overallSentiment: {
        line: parsed.overallSentiment?.line ?? "",
        newsScore: typeof parsed.overallSentiment?.newsScore === "number" ? parsed.overallSentiment.newsScore : null,
        socialScore: typeof parsed.overallSentiment?.socialScore === "number" ? parsed.overallSentiment.socialScore : null,
      },
      sources: {
        storylineCount: groups.filter((g) => g.storylineId).length,
        clusterCount: activeClusterIds.length,
        itemCount: dayItems.length,
      },
    };

    const now = new Date();
    await db
      .insert(dailyBriefs)
      .values({ companyId, periodDate, snapshotData: snapshot, generatedAt: now })
      .onConflictDoUpdate({
        target: [dailyBriefs.companyId, dailyBriefs.periodDate],
        set: { snapshotData: snapshot, generatedAt: now },
      });

    return { ok: true, periodDate };
  } catch (err) {
    console.error(`[daily-brief] company ${companyId} ${periodDate}:`, err);
    return { ok: false, skipped: "generation_failed", periodDate };
  }
}

export async function buildDailyBriefsForAllCompanies(): Promise<{ generated: number }> {
  const companyRows = await db.select({ id: companies.id }).from(companies);
  let generated = 0;
  for (const c of companyRows) {
    const result = await buildDailyBrief(c.id);
    if (result.ok) generated++;
  }
  return { generated };
}
