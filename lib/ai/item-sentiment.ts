import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { and, desc, eq, gte, isNull, or, sql, count } from "drizzle-orm";
import { db } from "@/lib/db";
import { items, topics, companies } from "@/lib/db/schema";

export type ItemSentimentResult = {
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  score: number; // -1.0 to 1.0
};

// One LLM call scores a whole batch; nano pricing makes per-item cost ~0.001¢
const ITEMS_PER_CALL = 40;

const VALID_LABELS = new Set(["positive", "negative", "neutral", "mixed"]);

/**
 * Scores a batch of items (max ITEMS_PER_CALL) against one target in a single
 * cheap LLM call. The target is the item's topic label (or the company name
 * for items without a topic). Returns one result per input item, by position.
 * Items the model skips come back as neutral/0 so callers can still stamp
 * analyzed_at and not retry forever.
 */
export async function analyzeItemSentiments(opts: {
  targetLabel: string;
  items: Array<{ title: string | null; body: string | null; author: string | null }>;
}): Promise<ItemSentimentResult[]> {
  const { targetLabel, items: batch } = opts;

  const itemList = batch
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

Entity being tracked: "${targetLabel}"

Items (posts, comments, headlines — judge each one INDEPENDENTLY):
${itemList}

For EACH numbered item, assess the sentiment expressed towards "${targetLabel}" specifically (not the topic in general).
- "positive": favorable, praising, or beneficial to ${targetLabel}
- "negative": critical, damaging, or hostile to ${targetLabel}
- "neutral": factual or unrelated framing, no clear lean towards ${targetLabel}
- "mixed": the single item itself contains clear positive AND negative sentiment
- x: score from -1.0 (very negative) to 1.0 (very positive); 0.0 only for genuinely neutral

Respond with a JSON array only, no markdown, one entry per item in order:
[{"i":1,"s":"negative","x":-0.6},{"i":2,"s":"neutral","x":0.0}]`,
    maxOutputTokens: 25 * batch.length + 100,
  });

  const fallback: ItemSentimentResult = { sentiment: "neutral", score: 0 };
  const results: ItemSentimentResult[] = batch.map(() => ({ ...fallback }));

  try {
    const raw = text.trim().replace(/^```json\s*/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw) as Array<{ i: number; s: string; x: number }>;
    for (const entry of parsed) {
      const idx = (entry?.i ?? 0) - 1;
      if (idx < 0 || idx >= batch.length) continue;
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
 * Scores unscored items in the trailing window and writes sentiment back.
 * Shared by the daily cron (forward scoring) and the backfill route.
 * Idempotent — call until `remaining` hits 0.
 */
export async function scoreUnscoredItems(opts: {
  companyId?: string;
  days?: number;
  limit?: number;
}): Promise<{ scored: number; remaining: number }> {
  const days = Math.min(opts.days ?? 7, 90);
  const limit = Math.min(opts.limit ?? 400, 1000);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const windowFilter = and(
    opts.companyId ? eq(items.companyId, opts.companyId) : undefined,
    isNull(items.sentimentAnalyzedAt),
    or(
      gte(items.publishedAt, cutoff),
      and(isNull(items.publishedAt), gte(items.createdAt, cutoff))
    )
  );

  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      body: items.body,
      author: items.author,
      targetLabel: sql<string>`COALESCE(${topics.label}, ${companies.name})`,
    })
    .from(items)
    .innerJoin(companies, eq(companies.id, items.companyId))
    .leftJoin(topics, eq(topics.id, items.topicId))
    .where(windowFilter)
    .orderBy(desc(sql`COALESCE(${items.publishedAt}, ${items.createdAt})`))
    .limit(limit);

  // Group by target so each LLM call scores against one entity
  const byTarget = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!byTarget.has(row.targetLabel)) byTarget.set(row.targetLabel, []);
    byTarget.get(row.targetLabel)!.push(row);
  }

  const now = new Date();
  let scored = 0;

  for (const [targetLabel, targetRows] of byTarget) {
    for (let i = 0; i < targetRows.length; i += ITEMS_PER_CALL) {
      const chunk = targetRows.slice(i, i + ITEMS_PER_CALL);
      const results = await analyzeItemSentiments({
        targetLabel,
        items: chunk.map((r) => ({ title: r.title, body: r.body, author: r.author })),
      });

      for (let j = 0; j < chunk.length; j++) {
        await db
          .update(items)
          .set({
            sentimentScore: results[j].score,
            sentimentLabel: results[j].sentiment,
            sentimentAnalyzedAt: now,
          })
          .where(eq(items.id, chunk[j].id));
        scored++;
      }
    }
  }

  const [remainingRow] = await db
    .select({ cnt: count(items.id) })
    .from(items)
    .where(windowFilter);

  return { scored, remaining: remainingRow?.cnt ?? 0 };
}
