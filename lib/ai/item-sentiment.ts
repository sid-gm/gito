import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";

export type ItemSentimentResult = {
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  score: number; // -1.0 to 1.0
};

export type ScorableItemRow = {
  id: string;
  title: string | null;
  body: string | null;
  author: string | null;
  entityLabel: string;
};

// One LLM call scores a whole batch; nano pricing makes per-item cost ~0.001¢
const ITEMS_PER_CALL = 40;

const VALID_LABELS = new Set(["positive", "negative", "neutral", "mixed"]);

/**
 * Scores a batch of items (max ITEMS_PER_CALL) against one entity in a single
 * cheap LLM call. Returns one result per input item, by position. Items the
 * model skips come back as neutral/0 so callers can still stamp analyzed_at
 * and not retry forever.
 */
export async function analyzeItemSentiments(opts: {
  entityLabel: string;
  items: Array<{ title: string | null; body: string | null; author: string | null }>;
}): Promise<ItemSentimentResult[]> {
  const { entityLabel, items } = opts;

  const itemList = items
    .map((item, i) => {
      const title = item.title?.slice(0, 150) ?? "";
      const body = item.body?.slice(0, 280) ?? "";
      const voice = item.author ? `[@${item.author}] ` : "";
      const parts = [title, body].filter(Boolean).join(" | ");
      return `${i + 1}. ${voice}${parts}`;
    })
    .join("\n");

  const { text } = await generateText({
    model: openai("gpt-4.1-nano"),
    prompt: `You are scoring public sentiment towards a specific entity. Respond ONLY with valid JSON.

Entity being tracked: "${entityLabel}"

Items (posts, comments, headlines — judge each one INDEPENDENTLY):
${itemList}

For EACH numbered item, assess the sentiment expressed towards "${entityLabel}" specifically (not the topic in general).
- "positive": favorable, praising, or beneficial to ${entityLabel}
- "negative": critical, damaging, or hostile to ${entityLabel}
- "neutral": factual or unrelated framing, no clear lean towards ${entityLabel}
- "mixed": the single item itself contains clear positive AND negative sentiment
- x: score from -1.0 (very negative) to 1.0 (very positive); 0.0 only for genuinely neutral

Respond with a JSON array only, no markdown, one entry per item in order:
[{"i":1,"s":"negative","x":-0.6},{"i":2,"s":"neutral","x":0.0}]`,
    maxOutputTokens: 25 * items.length + 100,
  });

  const fallback: ItemSentimentResult = { sentiment: "neutral", score: 0 };
  const results: ItemSentimentResult[] = items.map(() => ({ ...fallback }));

  try {
    const raw = text.trim().replace(/^```json\s*/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw) as Array<{ i: number; s: string; x: number }>;
    for (const entry of parsed) {
      const idx = (entry?.i ?? 0) - 1;
      if (idx < 0 || idx >= items.length) continue;
      results[idx] = {
        sentiment: VALID_LABELS.has(entry.s) ? (entry.s as ItemSentimentResult["sentiment"]) : "neutral",
        score: typeof entry.x === "number" ? Math.max(-1, Math.min(1, entry.x)) : 0,
      };
    }
  } catch {
    // Keep neutral fallbacks; analyzed_at still gets stamped so we don't loop
  }

  return results;
}

/**
 * Scores arbitrary unscored item rows (already joined to their entity label),
 * chunked per entity, and writes sentiment back to ingested_items. Shared by
 * the classify cron (forward scoring) and the backfill route.
 */
export async function scoreItemRows(rows: ScorableItemRow[]): Promise<number> {
  // Group by entity so each LLM call targets one entity
  const byEntity = new Map<string, ScorableItemRow[]>();
  for (const row of rows) {
    if (!byEntity.has(row.entityLabel)) byEntity.set(row.entityLabel, []);
    byEntity.get(row.entityLabel)!.push(row);
  }

  const now = new Date();
  let scored = 0;

  for (const [entityLabel, entityRows] of byEntity) {
    for (let i = 0; i < entityRows.length; i += ITEMS_PER_CALL) {
      const chunk = entityRows.slice(i, i + ITEMS_PER_CALL);
      const results = await analyzeItemSentiments({
        entityLabel,
        items: chunk.map((r) => ({ title: r.title, body: r.body, author: r.author })),
      });

      for (let j = 0; j < chunk.length; j++) {
        await db
          .update(ingestedItems)
          .set({
            sentimentScore: results[j].score,
            sentimentLabel: results[j].sentiment,
            sentimentAnalyzedAt: now,
          })
          .where(eq(ingestedItems.id, chunk[j].id));
        scored++;
      }
    }
  }

  return scored;
}
