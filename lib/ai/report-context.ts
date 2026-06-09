import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  clusters,
  clusterItems,
  clusterPeriodNarratives,
  ingestedItems,
} from "@/lib/db/schema";

export const NEWS_PLATFORMS = new Set(["google_alerts", "manual"]);
export const SOCIAL_PLATFORMS = new Set(["hackernews", "reddit", "twitter"]);

export type ClusterContext = {
  label: string | null;
  narrativeSummary: string | null;
  analystNote: string | null;
  items: Array<{ platform: string; title: string | null; author: string | null; publishedAt: string | null; analystNote: string | null }>;
  narratives: Array<{ periodDate: string; aiNarrative: string | null; analystNarrative: string | null }>;
};

export async function buildClusterContext(clusterId: string): Promise<ClusterContext | null> {
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

export function formatClusterBlock(ctx: ClusterContext): string {
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
