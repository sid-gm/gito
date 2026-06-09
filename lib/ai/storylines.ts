import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { clusters, clusterNewsLinks, storylines, trackedEntities } from "@/lib/db/schema";
import { buildClusterContext, formatClusterBlock } from "@/lib/ai/report-context";

const STORYLINES_SHOWN = 20;
const LENS_CLUSTER_LIMIT = 4;
const LENS_NEWS_LIMIT = 12;

export type StorylineAssignResult = { assigned: number; created: number };

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Group narrative clusters (the event layer) into storylines (the arc layer).
// Same two-phase philosophy as clustering, one level up: match against open
// storylines, otherwise create — biased toward "when in doubt, create new".
export async function assignClustersToStorylines(limit = 15): Promise<StorylineAssignResult> {
  const candidates = await db
    .select({
      id: clusters.id,
      entityId: clusters.entityId,
      label: clusters.label,
      narrativeSummary: clusters.narrativeSummary,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      itemCount: clusters.itemCount,
    })
    .from(clusters)
    .where(
      and(
        isNull(clusters.archivedAt),
        isNull(clusters.storylineId),
        or(eq(clusters.classification, "narrative"), eq(clusters.analystClassification, "narrative"))
      )
    )
    .orderBy(desc(clusters.lastSeenAt))
    .limit(limit);

  if (candidates.length === 0) return { assigned: 0, created: 0 };

  const byEntity = new Map<string, typeof candidates>();
  for (const c of candidates) {
    if (!c.entityId) continue;
    if (!byEntity.has(c.entityId)) byEntity.set(c.entityId, []);
    byEntity.get(c.entityId)!.push(c);
  }

  let assigned = 0;
  let created = 0;

  for (const [entityId, entityClusters] of byEntity) {
    try {
      const entityRow = await db
        .select({ label: trackedEntities.label })
        .from(trackedEntities)
        .where(eq(trackedEntities.id, entityId))
        .then((rows) => rows[0]);
      const entityLabel = entityRow?.label ?? "this entity";

      const open = await db
        .select({
          id: storylines.id,
          title: storylines.title,
          summary: storylines.summary,
          firstSeenAt: storylines.firstSeenAt,
          lastSeenAt: storylines.lastSeenAt,
        })
        .from(storylines)
        .where(and(eq(storylines.entityId, entityId), eq(storylines.status, "open")))
        .orderBy(desc(storylines.lastSeenAt))
        .limit(STORYLINES_SHOWN);

      const storylineList =
        open.length > 0
          ? open
              .map((s, i) => {
                const parts = [`[${i + 1}] "${s.title}"`, `${fmtDate(s.firstSeenAt)} to ${fmtDate(s.lastSeenAt)}`];
                if (s.summary) parts.push(s.summary.slice(0, 160));
                return parts.join(" — ");
              })
              .join("\n")
          : "(none yet)";

      const clusterList = entityClusters
        .map((c, i) => {
          const parts = [`[${i + 1}] "${c.label ?? "(unlabeled)"}"`, `${fmtDate(c.firstSeenAt)} to ${fmtDate(c.lastSeenAt)}`, `${c.itemCount} items`];
          if (c.narrativeSummary) parts.push(c.narrativeSummary.slice(0, 160));
          return parts.join(" — ");
        })
        .join("\n");

      const prompt = `You are organizing story clusters about "${entityLabel}" into ongoing storylines (multi-week narrative arcs).

Existing storylines:
${storylineList}

Event clusters to place:
${clusterList}

Rules:
- A storyline groups related events into one arc: cause and effect, or the same controversy evolving over time.
- Distinct unrelated topics get separate storylines.
- Two clusters to place may share one NEW storyline — give them the same new key.
- When in doubt, create a new storyline.

Respond ONLY with valid JSON:
{"assignments":[{"cluster":1,"storyline":2},{"cluster":2,"storyline":"new-1"},{"cluster":3,"storyline":"new-1"}],
 "newStorylines":{"new-1":{"title":"4-8 word storyline title","summary":"1-2 sentence summary of the arc"}}}`;

      const { text } = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
        maxOutputTokens: 600,
      });

      const raw = text.trim().replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(raw) as {
        assignments: { cluster: number; storyline: number | string }[];
        newStorylines?: Record<string, { title?: string; summary?: string }>;
      };
      if (!Array.isArray(parsed.assignments)) continue;

      const touched = new Set<string>();
      const newKeyToId = new Map<string, string>();

      for (const a of parsed.assignments) {
        const cluster = entityClusters[a.cluster - 1];
        if (!cluster) continue;

        let storylineId: string | null = null;

        if (typeof a.storyline === "number") {
          storylineId = open[a.storyline - 1]?.id ?? null;
        } else if (typeof a.storyline === "string") {
          const key = a.storyline;
          if (newKeyToId.has(key)) {
            storylineId = newKeyToId.get(key)!;
          } else {
            const meta = parsed.newStorylines?.[key];
            const title = meta?.title?.trim() || cluster.label || "Untitled storyline";
            const [inserted] = await db
              .insert(storylines)
              .values({
                entityId,
                title: title.slice(0, 120),
                summary: meta?.summary ?? null,
                originClusterId: cluster.id,
                firstSeenAt: cluster.firstSeenAt,
                lastSeenAt: cluster.lastSeenAt,
              })
              .returning({ id: storylines.id });
            storylineId = inserted.id;
            newKeyToId.set(key, storylineId);
            created++;
          }
        }

        if (!storylineId) continue;
        await db.update(clusters).set({ storylineId }).where(eq(clusters.id, cluster.id));
        touched.add(storylineId);
        assigned++;
      }

      await recomputeStorylineAggregates([...touched]);
    } catch (err) {
      console.error(`[storylines] assign entity ${entityId}:`, err);
    }
  }

  return { assigned, created };
}

export async function recomputeStorylineAggregates(storylineIds: string[]): Promise<void> {
  for (const id of storylineIds) {
    const members = await db
      .select({ id: clusters.id, firstSeenAt: clusters.firstSeenAt, lastSeenAt: clusters.lastSeenAt })
      .from(clusters)
      .where(eq(clusters.storylineId, id));
    if (members.length === 0) continue;

    const first = members.reduce((a, b) => (a.firstSeenAt <= b.firstSeenAt ? a : b));
    const last = members.reduce((a, b) => (a.lastSeenAt >= b.lastSeenAt ? a : b));

    await db
      .update(storylines)
      .set({
        firstSeenAt: first.firstSeenAt,
        lastSeenAt: last.lastSeenAt,
        originClusterId: first.id,
        updatedAt: new Date(),
      })
      .where(eq(storylines.id, id));
  }
}

// Regenerate a storyline's cached title/summary/platform-lens from its member
// clusters (social conversation) and their linked news (the news lens source).
export async function refreshStorylineLens(storylineId: string): Promise<boolean> {
  try {
    const storyline = await db
      .select()
      .from(storylines)
      .where(eq(storylines.id, storylineId))
      .then((rows) => rows[0]);
    if (!storyline) return false;

    const entityRow = await db
      .select({ label: trackedEntities.label })
      .from(trackedEntities)
      .where(eq(trackedEntities.id, storyline.entityId))
      .then((rows) => rows[0]);
    const entityLabel = entityRow?.label ?? "this entity";

    const members = await db
      .select({ id: clusters.id, label: clusters.label, firstSeenAt: clusters.firstSeenAt })
      .from(clusters)
      .where(eq(clusters.storylineId, storylineId))
      .orderBy(desc(clusters.lastSeenAt));
    if (members.length === 0) return false;

    const recent = members.slice(0, LENS_CLUSTER_LIMIT).reverse(); // oldest of the recent first
    const blocks: string[] = [];
    for (const m of recent) {
      const ctx = await buildClusterContext(m.id);
      if (!ctx) continue;
      blocks.push(`EVENT CLUSTER: ${ctx.label ?? "(unlabeled)"} (first seen ${fmtDate(m.firstSeenAt)})\n${formatClusterBlock(ctx)}`);
    }

    const newsLinks = await db
      .select({
        headline: clusterNewsLinks.headline,
        relationship: clusterNewsLinks.relationship,
        explanation: clusterNewsLinks.explanation,
        publishedAt: clusterNewsLinks.publishedAt,
      })
      .from(clusterNewsLinks)
      .where(inArray(clusterNewsLinks.clusterId, members.map((m) => m.id)))
      .orderBy(desc(clusterNewsLinks.publishedAt))
      .limit(LENS_NEWS_LIMIT);

    const newsList =
      newsLinks.length > 0
        ? newsLinks
            .map((n) => `- "${n.headline}"${n.publishedAt ? ` (${fmtDate(n.publishedAt)})` : ""} [${n.relationship}]${n.explanation ? ` — ${n.explanation}` : ""}`)
            .join("\n")
        : "(none linked)";

    const prompt = `You are summarizing an ongoing storyline about "${entityLabel}" for a reputation monitoring dashboard.

Storyline so far: "${storyline.title}" (${fmtDate(storyline.firstSeenAt)} to ${fmtDate(storyline.lastSeenAt)})
${storyline.summary ? `Previous summary: ${storyline.summary}` : ""}

${blocks.join("\n\n")}

Linked news coverage:
${newsList}

Return a JSON object:
- "title": a 4-8 word title for the storyline arc
- "summary": 2-3 sentences telling the arc oldest to newest (what started it, how it evolved, where it stands)
- "lens": an object keyed by source ("news", "reddit", "twitter", "threads", "instagram", "hackernews") — include ONLY sources that appear above. Each value: {"digest": one sentence on what that source is saying, "quote": a short verbatim quote from that source or null}
- "newsSentimentScore": -1.0 to 1.0 based on the linked news coverage, or null if no news
- "socialSentimentScore": -1.0 to 1.0 based on the social conversation, or null

Respond with only valid JSON, no markdown.`;

    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt,
      maxOutputTokens: 700,
    });

    const raw = text.trim().replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(raw) as {
      title?: string;
      summary?: string;
      lens?: Record<string, { digest?: string; quote?: string | null }>;
      newsSentimentScore?: number | null;
      socialSentimentScore?: number | null;
    };

    const lens: Record<string, { digest: string; quote: string | null }> = {};
    for (const [key, value] of Object.entries(parsed.lens ?? {})) {
      if (value?.digest) lens[key] = { digest: value.digest, quote: value.quote ?? null };
    }

    await db
      .update(storylines)
      .set({
        ...(parsed.title?.trim() && { title: parsed.title.trim().slice(0, 120) }),
        ...(parsed.summary?.trim() && { summary: parsed.summary.trim() }),
        ...(Object.keys(lens).length > 0 && { platformLens: lens }),
        newsSentimentScore: typeof parsed.newsSentimentScore === "number" ? parsed.newsSentimentScore : null,
        socialSentimentScore: typeof parsed.socialSentimentScore === "number" ? parsed.socialSentimentScore : null,
        lensGeneratedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(storylines.id, storylineId));

    return true;
  } catch (err) {
    console.error(`[storylines] lens ${storylineId}:`, err);
    return false;
  }
}

// Refresh lenses for storylines whose member activity moved past the cached lens.
export async function refreshStaleLenses(cap = 5): Promise<number> {
  const stale = await db
    .select({ id: storylines.id, lensGeneratedAt: storylines.lensGeneratedAt, lastSeenAt: storylines.lastSeenAt })
    .from(storylines)
    .where(eq(storylines.status, "open"))
    .orderBy(desc(storylines.lastSeenAt));

  let refreshed = 0;
  for (const s of stale) {
    if (refreshed >= cap) break;
    if (s.lensGeneratedAt && s.lastSeenAt <= s.lensGeneratedAt) continue;
    if (await refreshStorylineLens(s.id)) refreshed++;
  }
  return refreshed;
}
