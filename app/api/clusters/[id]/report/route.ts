import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import {
  clusters,
  clusterItems,
  clusterPeriodNarratives,
  clusterReports,
  ingestedItems,
  trackedEntities,
  companies,
} from "@/lib/db/schema";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";

const NEWS_PLATFORMS = new Set(["google_alerts", "manual"]);
const SOCIAL_PLATFORMS = new Set(["hackernews", "reddit", "twitter"]);

type ClusterContext = {
  label: string | null;
  narrativeSummary: string | null;
  analystNote: string | null;
  items: Array<{ platform: string; title: string | null; author: string | null; publishedAt: string | null; analystNote: string | null }>;
  narratives: Array<{ periodDate: string; aiNarrative: string | null; analystNarrative: string | null }>;
};

type AISummaryResult = {
  aiSummary: string;
  entityActions: string;
  publicReaction: string;
  reputationRisk: string;
  actionableItems: string[];
  newsSentimentScore: number;
  newsSentimentLabel: string;
  socialSentimentScore: number;
  socialSentimentLabel: string;
};

async function buildClusterContext(clusterId: string): Promise<ClusterContext | null> {
  const rows = await db
    .select({
      label: clusters.label,
      narrativeSummary: clusters.narrativeSummary,
      analystNote: clusters.analystNote,
    })
    .from(clusters)
    .where(eq(clusters.id, clusterId))
    .limit(1);

  if (!rows.length) return null;
  const row = rows[0];

  const items = await db
    .select({
      platform: ingestedItems.platform,
      title: ingestedItems.title,
      author: ingestedItems.author,
      publishedAt: ingestedItems.publishedAt,
      analystNote: clusterItems.analystNote,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, clusterId))
    .orderBy(desc(clusterItems.similarity))
    .limit(20);

  const narratives = await db
    .select({
      periodDate: clusterPeriodNarratives.periodDate,
      aiNarrative: clusterPeriodNarratives.aiNarrative,
      analystNarrative: clusterPeriodNarratives.analystNarrative,
    })
    .from(clusterPeriodNarratives)
    .where(eq(clusterPeriodNarratives.clusterId, clusterId))
    .orderBy(clusterPeriodNarratives.periodDate);

  return {
    label: row.label,
    narrativeSummary: row.narrativeSummary,
    analystNote: row.analystNote,
    items: items.map((i) => ({ ...i, publishedAt: i.publishedAt?.toISOString() ?? null })),
    narratives,
  };
}

function formatClusterBlock(ctx: ClusterContext): string {
  const fmtDate = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "unknown date";

  const newsItems = ctx.items.filter((i) => NEWS_PLATFORMS.has(i.platform));
  const socialItems = ctx.items.filter((i) => SOCIAL_PLATFORMS.has(i.platform));

  const fmtNews = (i: typeof ctx.items[number]) => {
    const base = `[${fmtDate(i.publishedAt)}] ${i.title ?? "(no title)"}`;
    return i.analystNote ? `${base} — ${i.analystNote}` : base;
  };
  const fmtSocial = (i: typeof ctx.items[number]) => {
    const who = i.author ? `${i.author}: ` : "";
    const base = `[${fmtDate(i.publishedAt)}] ${who}${i.title ?? "(no title)"}`;
    return i.analystNote ? `${base} — ${i.analystNote}` : base;
  };

  const narrativeLines = ctx.narratives.flatMap((n) => {
    const lines: string[] = [];
    if (n.analystNarrative) lines.push(`[${n.periodDate}] Analyst notes: ${n.analystNarrative}`);
    if (n.aiNarrative) lines.push(`[${n.periodDate}] AI summary: ${n.aiNarrative}`);
    return lines;
  });

  const parts: string[] = [];
  if (ctx.narrativeSummary) parts.push(`Background: ${ctx.narrativeSummary}`);
  if (ctx.analystNote) parts.push(`Analyst note: ${ctx.analystNote}`);
  parts.push(`news items:\n${newsItems.length === 0 ? "(none)" : newsItems.map(fmtNews).join("\n")}`);
  parts.push(`social items:\n${socialItems.length === 0 ? "(none)" : socialItems.map(fmtSocial).join("\n")}`);
  if (narrativeLines.length > 0) parts.push(`analyst and AI notes by day:\n${narrativeLines.join("\n")}`);
  return parts.join("\n\n");
}

async function generateAISummary(
  entityLabel: string | null,
  primaryContext: ClusterContext,
  linkedContexts: ClusterContext[],
): Promise<AISummaryResult | null> {
  try {
    const entity = entityLabel ?? "the tracked entity";

    const primaryBlock = formatClusterBlock(primaryContext);
    const linkedBlocks = linkedContexts.map((ctx, i) => {
      const label = ctx.label ?? `Linked cluster ${i + 1}`;
      return `RELATED CLUSTER: ${label}\n${formatClusterBlock(ctx)}`;
    });

    const prompt = `You are a strategic communications analyst. You are analyzing media coverage and public discussion about: ${entity}.

PRIMARY CLUSTER: ${primaryContext.label ?? "Primary cluster"}
${primaryBlock}

${linkedBlocks.length > 0 ? linkedBlocks.join("\n\n") + "\n\n" : ""}Analyze all clusters above and return a JSON object with exactly these fields:
- "aiSummary": overall analysis tying all clusters together — what is happening, why it matters
- "entityActions": what ${entity} was actively doing, saying, or positioning (based primarily on news coverage)
- "publicReaction": how the public and online communities reacted (based primarily on social items)
- "reputationRisk": a plain text string — state the risk level (low / medium / high) followed by a concise explanation, all in one string (e.g. "High — the backlash indicates...")
- "actionableItems": array of strings, each a specific actionable recommendation for managing this narrative
- "newsSentimentScore": number from -1.0 (very negative) to 1.0 (very positive) reflecting overall news tone across all clusters
- "newsSentimentLabel": one of "very negative", "negative", "mixed", "neutral", "positive", "very positive"
- "socialSentimentScore": number from -1.0 (very negative) to 1.0 (very positive) reflecting overall social conversation tone
- "socialSentimentLabel": one of "very negative", "negative", "mixed", "neutral", "positive", "very positive"

Respond with only valid JSON, no markdown.`;

    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt,
      temperature: 0.3,
    });

    const parsed = JSON.parse(text.trim()) as AISummaryResult;
    if (!Array.isArray(parsed.actionableItems)) parsed.actionableItems = [];
    if (parsed.reputationRisk && typeof parsed.reputationRisk !== "string") {
      const r = parsed.reputationRisk as unknown as { riskLevel?: string; explanation?: string };
      parsed.reputationRisk = [r.riskLevel, r.explanation].filter(Boolean).join(" — ");
    }
    return parsed;
  } catch {
    return null;
  }
}

async function buildReportData(id: string) {
  const clusterRow = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      itemCount: clusters.itemCount,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      narrativeStage: clusters.narrativeStage,
      narrativeSummary: clusters.narrativeSummary,
      sentimentScore: clusters.sentimentScore,
      sentimentLabel: clusters.sentimentLabel,
      velocity24h: clusters.velocity24h,
      prevVelocity24h: clusters.prevVelocity24h,
      platformCount: clusters.platformCount,
      analystClassification: clusters.analystClassification,
      analystNote: clusters.analystNote,
      entityLabel: trackedEntities.label,
      companyName: companies.name,
      companyId: companies.id,
    })
    .from(clusters)
    .leftJoin(trackedEntities, eq(clusters.entityId, trackedEntities.id))
    .leftJoin(companies, eq(trackedEntities.companyId, companies.id))
    .where(eq(clusters.id, id))
    .limit(1);

  if (!clusterRow.length) return null;

  const narratives = await db
    .select({
      periodDate: clusterPeriodNarratives.periodDate,
      aiNarrative: clusterPeriodNarratives.aiNarrative,
      analystNarrative: clusterPeriodNarratives.analystNarrative,
    })
    .from(clusterPeriodNarratives)
    .where(eq(clusterPeriodNarratives.clusterId, id))
    .orderBy(clusterPeriodNarratives.periodDate);

  const items = await db
    .select({
      platform: ingestedItems.platform,
      title: ingestedItems.title,
      author: ingestedItems.author,
      publishedAt: ingestedItems.publishedAt,
      url: ingestedItems.url,
      analystNote: clusterItems.analystNote,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, id))
    .orderBy(desc(clusterItems.similarity))
    .limit(20);

  const sourceBreakdown = await db
    .select({
      platform: ingestedItems.platform,
      itemCount: count(),
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, id))
    .groupBy(ingestedItems.platform)
    .orderBy(desc(count()));

  const since48h = new Date(Date.now() - 48 * 3600000);
  const velocityHistory = await db
    .select({
      bucket: sql<string>`TO_CHAR(DATE_TRUNC('hour', ${clusterItems.addedAt}), 'YYYY-MM-DD HH24:00')`,
      itemCount: count(),
    })
    .from(clusterItems)
    .where(and(eq(clusterItems.clusterId, id), gte(clusterItems.addedAt, since48h)))
    .groupBy(sql`DATE_TRUNC('hour', ${clusterItems.addedAt})`)
    .orderBy(sql`DATE_TRUNC('hour', ${clusterItems.addedAt})`);

  const raw = clusterRow[0];
  return {
    cluster: {
      id: raw.id,
      label: raw.label,
      itemCount: raw.itemCount,
      firstSeenAt: raw.firstSeenAt.toISOString(),
      lastSeenAt: raw.lastSeenAt.toISOString(),
      narrativeStage: raw.narrativeStage,
      narrativeSummary: raw.narrativeSummary,
      sentimentScore: raw.sentimentScore,
      sentimentLabel: raw.sentimentLabel,
      velocity24h: raw.velocity24h,
      prevVelocity24h: raw.prevVelocity24h,
      platformCount: raw.platformCount,
      analystClassification: raw.analystClassification,
      analystNote: raw.analystNote,
      entityLabel: raw.entityLabel,
      companyName: raw.companyName,
    },
    narratives,
    items: items.map((i) => ({
      ...i,
      publishedAt: i.publishedAt?.toISOString() ?? null,
    })),
    sourceBreakdown,
    velocityHistory,
    _meta: { companyId: raw.companyId, clusterLabel: raw.label, companyName: raw.companyName },
  };
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await buildReportData(id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { _meta: _, ...reportData } = data;
  return NextResponse.json(reportData);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let linkedClusterIds: string[] = [];
  try {
    const body = await req.json();
    if (Array.isArray(body?.linkedClusterIds)) linkedClusterIds = body.linkedClusterIds;
  } catch {
    // body missing or not JSON — proceed with no linked clusters
  }

  const data = await buildReportData(id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { _meta, ...snapshotData } = data;

  const primaryContext: ClusterContext = {
    label: snapshotData.cluster.label,
    narrativeSummary: snapshotData.cluster.narrativeSummary,
    analystNote: snapshotData.cluster.analystNote,
    items: snapshotData.items,
    narratives: snapshotData.narratives,
  };

  const linkedContexts = (
    await Promise.all(linkedClusterIds.map((lid) => buildClusterContext(lid)))
  ).filter((ctx): ctx is ClusterContext => ctx !== null);

  const aiResult = await generateAISummary(
    snapshotData.cluster.entityLabel ?? snapshotData.cluster.companyName,
    primaryContext,
    linkedContexts,
  );

  const enrichedCluster = aiResult
    ? {
        ...snapshotData.cluster,
        aiSummary: aiResult.aiSummary,
        entityActions: aiResult.entityActions,
        publicReaction: aiResult.publicReaction,
        reputationRisk: aiResult.reputationRisk,
        actionableItems: aiResult.actionableItems,
        newsSentimentScore: aiResult.newsSentimentScore,
        newsSentimentLabel: aiResult.newsSentimentLabel,
        socialSentimentScore: aiResult.socialSentimentScore,
        socialSentimentLabel: aiResult.socialSentimentLabel,
      }
    : snapshotData.cluster;

  const [inserted] = await db
    .insert(clusterReports)
    .values({
      clusterId: id,
      companyId: _meta.companyId ?? null,
      snapshotData: { ...snapshotData, cluster: enrichedCluster },
      clusterLabel: _meta.clusterLabel,
      companyName: _meta.companyName,
    })
    .returning({ id: clusterReports.id });

  return NextResponse.json({ reportId: inserted.id }, { status: 201 });
}
