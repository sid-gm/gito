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

type AISummaryResult = {
  aiSummary: string;
  newsSentimentScore: number;
  newsSentimentLabel: string;
  socialSentimentScore: number;
  socialSentimentLabel: string;
};

async function generateAISummary(
  entityLabel: string | null,
  items: Array<{ platform: string; title: string | null; author: string | null; publishedAt: string | null; analystNote: string | null }>,
  narrativeSummary: string | null,
): Promise<AISummaryResult | null> {
  try {
    const newsItems = items.filter((i) => NEWS_PLATFORMS.has(i.platform));
    const socialItems = items.filter((i) => SOCIAL_PLATFORMS.has(i.platform));

    const fmtDate = (iso: string | null) =>
      iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "unknown date";

    const formatNewsItem = (i: typeof items[number]) => {
      const base = `[${fmtDate(i.publishedAt)}] ${i.title ?? "(no title)"}`;
      return i.analystNote ? `${base} - ${i.analystNote}` : base;
    };

    const formatSocialItem = (i: typeof items[number]) => {
      const who = i.author ? `${i.author}: ` : "";
      const base = `[${fmtDate(i.publishedAt)}] ${who}${i.title ?? "(no title)"}`;
      return i.analystNote ? `${base} - ${i.analystNote}` : base;
    };

    const newsBlock = newsItems.length === 0 ? "(none)" : newsItems.map(formatNewsItem).join("\n");
    const socialBlock = socialItems.length === 0 ? "(none)" : socialItems.map(formatSocialItem).join("\n");

    const entity = entityLabel ?? "the tracked entity";

    const prompt = `You are provided stories about the entity ${entity}.

Analyze the following cluster of items and produce a brief summary against the entity. We want to understand how discussions online are affecting the entity. We also want to compare the social discussion against how the mainstream news is covering this.
${narrativeSummary ? `\nBackground: ${narrativeSummary}\n` : ""}
news items:
${newsBlock}

social items:
${socialBlock}

Return a JSON object with exactly these fields:
- "aiSummary": Summarize what the sentiment is of public discussions for the entity being tracked. Note how news coverage differs from online reaction. Reflect on whether the public discussions online can affect the entity positively or not. If you are unsure, state so.
- "newsSentimentScore": number from -1.0 (very negative) to 1.0 (very positive) reflecting news tone
- "newsSentimentLabel": one of "very negative", "negative", "mixed", "neutral", "positive", "very positive"
- "socialSentimentScore": number from -1.0 (very negative) to 1.0 (very positive) reflecting conversation tone
- "socialSentimentLabel": one of "very negative", "negative", "mixed", "neutral", "positive", "very positive"

Respond with only valid JSON, no markdown.`;

    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt,
      temperature: 0.3,
    });

    const parsed = JSON.parse(text.trim()) as AISummaryResult;
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const data = await buildReportData(id);
  if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { _meta, ...snapshotData } = data;

  const aiResult = await generateAISummary(
    snapshotData.cluster.entityLabel ?? snapshotData.cluster.companyName,
    snapshotData.items,
    snapshotData.cluster.narrativeSummary,
  );

  const enrichedCluster = aiResult
    ? {
        ...snapshotData.cluster,
        aiSummary: aiResult.aiSummary,
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
