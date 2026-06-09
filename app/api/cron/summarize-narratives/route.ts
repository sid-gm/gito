import { NextResponse } from "next/server";
import { and, asc, eq, gt, isNull, ne } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { clusters, clusterItems, clusterPeriodNarratives, ingestedItems, trackedEntities } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";
import { refreshStaleLenses } from "@/lib/ai/storylines";

export const maxDuration = 300;

const ORIGINAL_SUBTYPES = ["x_post", "reddit_thread", "ig_post"];

type DayItem = { title: string | null; body: string | null; subtype: string | null; analystNote: string | null };

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
      entityLabel: trackedEntities.label,
    })
    .from(clusters)
    .leftJoin(trackedEntities, eq(clusters.entityId, trackedEntities.id))
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
        .select({
          title: ingestedItems.title,
          body: ingestedItems.body,
          ingestedAt: ingestedItems.createdAt,
          subtype: ingestedItems.subtype,
          analystNote: clusterItems.analystNote,
        })
        .from(clusterItems)
        .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
        .where(and(eq(clusterItems.clusterId, cluster.id), ne(ingestedItems.platform, "google_alerts")));

      if (items.length === 0) continue;

      // Group by UTC date
      const byDay = new Map<string, DayItem[]>();
      for (const item of items) {
        const day = item.ingestedAt.toISOString().slice(0, 10);
        if (!item.title && !item.body) continue;
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day)!.push({ title: item.title, body: item.body, subtype: item.subtype, analystNote: item.analystNote });
      }

      // Load existing period narratives
      const existingPeriods = await db
        .select()
        .from(clusterPeriodNarratives)
        .where(eq(clusterPeriodNarratives.clusterId, cluster.id));
      const existingByDate = new Map(existingPeriods.map((p) => [p.periodDate, p]));

      const entityLabel = cluster.entityLabel ?? "the tracked entity";

      // Generate AI narrative for each day that needs one
      for (const [day, dayItems] of [...byDay.entries()].sort()) {
        const existing = existingByDate.get(day);
        if (existing?.analystNarrative) continue; // analyst wrote it — don't overwrite

        // Check freshness: skip if aiNarrative was generated after all items in this day
        const dayLatest = items
          .filter((i) => i.ingestedAt.toISOString().slice(0, 10) === day)
          .reduce((max, i) => (i.ingestedAt > max ? i.ingestedAt : max), new Date(0));
        if (existing?.aiNarrative && existing.generatedAt && existing.generatedAt >= dayLatest) continue;

        const originals = dayItems.filter((i) => i.subtype && ORIGINAL_SUBTYPES.includes(i.subtype));
        const replies = dayItems.filter((i) => !i.subtype || !ORIGINAL_SUBTYPES.includes(i.subtype));

        const originalSection = originals.length
          ? `\nWhat's happening (original post):\n${originals.map((o) => o.body ?? o.title ?? "").filter(Boolean).join("\n\n")}`
          : "";

        const repliesSection = replies.length
          ? `\nReplies from the public:\n${replies
              .slice(0, 8)
              .map((r, i) => `${i + 1}. ${(r.body ?? r.title ?? "").slice(0, 250)}`)
              .filter(Boolean)
              .join("\n")}`
          : "";

        const analystNotesSection = existing?.analystNarrative
          ? `\nAnalyst notes: ${existing.analystNarrative}`
          : "";

        const { text: periodText } = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `Narrative: "${cluster.label ?? "Unnamed"}"
Date: ${day}
Tracked entity: ${entityLabel}
${originalSection}${repliesSection}${analystNotesSection}

Write 1-2 sentences summarizing what people think about this story and why they are reacting the way they are. Note whether the reactions are positive, negative, off-topic, or disruptive, and how this relates to ${entityLabel}.`,
          maxOutputTokens: 100,
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
Tracked entity: ${entityLabel}

Story timeline:
${timeline}

Write an updated 1-2 sentence overview of how public reaction to this story has evolved. Be concise and factual.`,
          maxOutputTokens: 100,
        });
        newSummary = text.trim();
      } else {
        const itemSnippets = items
          .map((i) => (i.body ?? i.title ?? "").slice(0, 200))
          .filter(Boolean)
          .slice(0, 6)
          .map((t, i) => `${i + 1}. ${t}`)
          .join("\n");

        const { text } = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `Narrative: "${cluster.label ?? "Unnamed"}"
Tracked entity: ${entityLabel}
Previous summary: ${cluster.narrativeSummary ?? "none"}

Recent items:
${itemSnippets}

Write an updated 1-2 sentence summary of public reaction to this story, noting whether people are positive, negative, off-topic, or disruptive and why it relates to ${entityLabel}.`,
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

  // Refresh storyline lenses whose member activity moved past the cached digest
  let lensesRefreshed = 0;
  try {
    lensesRefreshed = await refreshStaleLenses(5);
  } catch (err) {
    console.error("[summarize-narratives] lens refresh:", err);
  }

  return NextResponse.json({ ok: true, updated, lensesRefreshed });
}
