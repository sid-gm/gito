import { NextResponse } from "next/server";
import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { clusters, clusterItems, clusterPeriodNarratives, ingestedItems } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const now = new Date();

  const narratives = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      narrativeSummary: clusters.narrativeSummary,
      classifiedAt: clusters.classifiedAt,
    })
    .from(clusters)
    .where(and(isNull(clusters.archivedAt), eq(clusters.classification, "narrative")))
    .limit(20);

  let updated = 0;

  for (const cluster of narratives) {
    const hasNew = cluster.classifiedAt
      ? await db
          .select({ itemId: clusterItems.itemId })
          .from(clusterItems)
          .where(and(eq(clusterItems.clusterId, cluster.id), gt(clusterItems.addedAt, cluster.classifiedAt)))
          .limit(1)
      : [{}];

    if (hasNew.length === 0) continue;

    try {
      const items = await db
        .select({ title: ingestedItems.title, body: ingestedItems.body, ingestedAt: ingestedItems.createdAt })
        .from(clusterItems)
        .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
        .where(and(eq(clusterItems.clusterId, cluster.id), ne(ingestedItems.platform, "google_alerts")));

      if (items.length === 0) continue;

      // Group by UTC date
      const byDay = new Map<string, string[]>();
      for (const item of items) {
        const day = item.ingestedAt.toISOString().slice(0, 10);
        const title = item.title ?? item.body?.slice(0, 120) ?? "";
        if (!title) continue;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push(title);
      }

      // Load existing period narratives
      const existingPeriods = await db
        .select()
        .from(clusterPeriodNarratives)
        .where(eq(clusterPeriodNarratives.clusterId, cluster.id));
      const existingByDate = new Map(existingPeriods.map((p) => [p.periodDate, p]));

      // Generate AI narrative for each day that needs one
      for (const [day, titles] of [...byDay.entries()].sort()) {
        const existing = existingByDate.get(day);
        if (existing?.analystNarrative) continue; // analyst wrote it — don't overwrite

        // Check if freshness: skip if aiNarrative was generated after all items in this day
        const dayLatest = items
          .filter((i) => i.ingestedAt.toISOString().slice(0, 10) === day)
          .reduce((max, i) => (i.ingestedAt > max ? i.ingestedAt : max), new Date(0));
        if (existing?.aiNarrative && existing.generatedAt && existing.generatedAt >= dayLatest) continue;

        const { text: periodText } = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `Narrative: "${cluster.label ?? "Unnamed"}"
Date: ${day}

Items from this date:
${titles.slice(0, 6).map((t, i) => `${i + 1}. ${t}`).join("\n")}

Write 1-2 sentences summarizing what happened in this story on this date. Be concise and factual.`,
          maxOutputTokens: 80,
        });

        if (periodText.trim()) {
          await db
            .insert(clusterPeriodNarratives)
            .values({ clusterId: cluster.id, periodDate: day, aiNarrative: periodText.trim(), generatedAt: now, updatedAt: now })
            .onConflictDoUpdate({
              target: [clusterPeriodNarratives.clusterId, clusterPeriodNarratives.periodDate],
              set: { aiNarrative: periodText.trim(), generatedAt: now, updatedAt: now },
            });
        }
      }

      // Re-fetch all period narratives to build timeline
      const allPeriods = await db
        .select()
        .from(clusterPeriodNarratives)
        .where(eq(clusterPeriodNarratives.clusterId, cluster.id))
        .orderBy(asc(clusterPeriodNarratives.periodDate));

      const timeline = allPeriods
        .map((p) => { const t = p.analystNarrative ?? p.aiNarrative; return t ? `${p.periodDate}: ${t}` : null; })
        .filter(Boolean)
        .join("\n");

      let newSummary = "";

      if (timeline) {
        const { text } = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `Narrative: "${cluster.label ?? "Unnamed"}"

Story timeline:
${timeline}

Write an updated 1-2 sentence overview of how this story has evolved. Be concise and factual.`,
          maxOutputTokens: 100,
        });
        newSummary = text.trim();
      } else {
        const titles = items.map((i) => i.title ?? i.body?.slice(0, 120) ?? "").filter(Boolean).slice(0, 8);
        const prevSummary = cluster.narrativeSummary ?? "none";
        const { text } = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `Narrative topic: "${cluster.label ?? "Unnamed"}"
Previous summary: ${prevSummary}

Latest item titles:
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Write an updated 1-2 sentence summary of what this narrative is about now, incorporating new developments. Be concise and factual.`,
          maxOutputTokens: 100,
        });
        newSummary = text.trim();
      }

      if (newSummary) {
        await db.update(clusters).set({ narrativeSummary: newSummary, classifiedAt: now }).where(eq(clusters.id, cluster.id));
        updated++;
      }
    } catch (err) {
      console.error(`[summarize-narratives] cluster ${cluster.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, updated });
}
