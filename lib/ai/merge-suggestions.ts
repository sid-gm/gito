import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { clusters, clusterMergeSuggestions, trackedEntities } from "@/lib/db/schema";

const CLUSTER_REVIEW_LIMIT = 60;
const MIN_CONFIDENCE = 0.6;

function fmtDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

// Review an entity's active clusters for duplicates and record merge proposals.
// Suggestions are pending until an analyst accepts or dismisses them — no auto-merge.
export async function suggestMergesForEntity(entityId: string): Promise<number> {
  const entityRow = await db
    .select({ label: trackedEntities.label })
    .from(trackedEntities)
    .where(eq(trackedEntities.id, entityId))
    .then((rows) => rows[0]);
  if (!entityRow) return 0;

  const active = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      itemCount: clusters.itemCount,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      suggestedKeywords: clusters.suggestedKeywords,
      narrativeSummary: clusters.narrativeSummary,
    })
    .from(clusters)
    .where(and(eq(clusters.entityId, entityId), isNull(clusters.archivedAt)))
    .orderBy(desc(clusters.lastSeenAt))
    .limit(CLUSTER_REVIEW_LIMIT);

  const labeled = active.filter((c) => c.label);
  if (labeled.length < 2) return 0;

  const pendingRows = await db
    .select({ clusterIds: clusterMergeSuggestions.clusterIds })
    .from(clusterMergeSuggestions)
    .where(and(eq(clusterMergeSuggestions.entityId, entityId), eq(clusterMergeSuggestions.status, "pending")));
  const pendingSets = pendingRows.map((r) => new Set(r.clusterIds));

  const clusterList = labeled
    .map((c, i) => {
      const parts = [`[${i + 1}] "${c.label}"`];
      const keywords = (c.suggestedKeywords ?? []).slice(0, 5);
      if (keywords.length > 0) parts.push(`keywords: ${keywords.join(", ")}`);
      parts.push(`${fmtDate(c.firstSeenAt)} to ${fmtDate(c.lastSeenAt)}`);
      parts.push(`${c.itemCount} items`);
      if (c.narrativeSummary) parts.push(c.narrativeSummary.split(". ")[0].slice(0, 140));
      return parts.join(" — ");
    })
    .join("\n");

  const prompt = `You are reviewing story clusters about "${entityRow.label}" for duplicates.

Clusters:
${clusterList}

Identify groups of clusters that cover the SAME specific story or event and should be merged.
Rules:
- Sharing a person or broad topic is NOT sufficient — different controversies, statements, or events stay separate.
- A continuing story split across dates IS a merge candidate.
- Only suggest merges you are confident about; when in doubt, leave clusters separate.

Respond ONLY with valid JSON:
{"merges":[{"clusters":[1,4],"label":"best combined label","confidence":0.85,"reason":"one sentence"}]}`;

  let suggested = 0;
  try {
    const { text } = await generateText({
      model: openai("gpt-4o-mini"),
      prompt,
      maxOutputTokens: 600,
    });

    const raw = text.trim().replace(/```json\n?|\n?```/g, "").trim();
    const parsed = JSON.parse(raw) as {
      merges: { clusters: number[]; label?: string; confidence?: number; reason?: string }[];
    };
    if (!Array.isArray(parsed.merges)) return 0;

    for (const merge of parsed.merges) {
      const ids = (merge.clusters ?? [])
        .map((idx) => labeled[idx - 1]?.id)
        .filter((id): id is string => Boolean(id));
      const unique = [...new Set(ids)];
      if (unique.length < 2) continue;
      if ((merge.confidence ?? 0) < MIN_CONFIDENCE) continue;
      if (pendingSets.some((set) => unique.some((id) => set.has(id)))) continue;

      await db.insert(clusterMergeSuggestions).values({
        entityId,
        clusterIds: unique,
        suggestedLabel: merge.label ?? null,
        confidence: merge.confidence ?? null,
        reason: merge.reason ?? null,
      });
      pendingSets.push(new Set(unique));
      suggested++;
    }
  } catch (err) {
    console.error(`[merge-suggestions] entity ${entityId}:`, err);
  }

  return suggested;
}

// Mark pending suggestions stale when any referenced cluster was merged, archived or deleted.
export async function markStaleSuggestions(): Promise<number> {
  const pending = await db
    .select({ id: clusterMergeSuggestions.id, clusterIds: clusterMergeSuggestions.clusterIds })
    .from(clusterMergeSuggestions)
    .where(eq(clusterMergeSuggestions.status, "pending"));
  if (pending.length === 0) return 0;

  const allIds = [...new Set(pending.flatMap((p) => p.clusterIds))];
  const live = await db
    .select({ id: clusters.id })
    .from(clusters)
    .where(and(inArray(clusters.id, allIds), isNull(clusters.archivedAt)));
  const liveSet = new Set(live.map((r) => r.id));

  let staled = 0;
  for (const row of pending) {
    if (row.clusterIds.every((id) => liveSet.has(id))) continue;
    await db
      .update(clusterMergeSuggestions)
      .set({ status: "stale", resolvedAt: new Date() })
      .where(eq(clusterMergeSuggestions.id, row.id));
    staled++;
  }
  return staled;
}

export async function suggestMergesForAllEntities(): Promise<{ suggested: number; staled: number }> {
  const staled = await markStaleSuggestions();

  const entityRows = await db
    .selectDistinct({ entityId: clusters.entityId })
    .from(clusters)
    .where(isNull(clusters.archivedAt));

  let suggested = 0;
  for (const row of entityRows) {
    if (!row.entityId) continue;
    suggested += await suggestMergesForEntity(row.entityId);
  }
  return { suggested, staled };
}
