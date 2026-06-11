import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export type SentimentResult = {
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  score: number; // -1.0 to 1.0
};

export type SentimentItem = {
  title: string | null;
  body: string | null;
  analystNote: string | null;
  author?: string | null;
  isOp?: boolean;
};

const OP_POST_SUBTYPES = new Set([
  "x_post",
  "reddit_post",
  "reddit_thread",
  "ig_post",
  "story",
]);

/**
 * Marks items authored by the thread OP, derived from the row whose subtype
 * is a root-post subtype. Used by call sites that load cluster items from
 * the DB before running sentiment.
 */
export function withOpFlags<T extends { author: string | null; subtype: string | null }>(
  rows: T[]
): Array<T & { isOp: boolean }> {
  const opAuthor =
    rows.find((r) => r.subtype != null && OP_POST_SUBTYPES.has(r.subtype))?.author ?? null;
  return rows.map((r) => ({
    ...r,
    isOp: opAuthor != null && r.author === opAuthor,
  }));
}

export async function analyzeEntitySentiment(opts: {
  entityLabel: string;
  clusterLabel: string | null;
  items: SentimentItem[];
  periodNarratives?: Array<{ periodDate: string; narrative: string }>;
  clusterAnalystNote?: string | null;
}): Promise<SentimentResult> {
  const { entityLabel, clusterLabel, items, periodNarratives = [], clusterAnalystNote } = opts;

  const itemList = items
    .slice(0, 40)
    .map((item, i) => {
      const title = item.title ?? "";
      const bodyExcerpt = item.body?.slice(0, 200) ?? "";
      const note = item.analystNote ? ` [analyst: ${item.analystNote}]` : "";
      const voice = item.isOp
        ? `[OP${item.author ? ` @${item.author}` : ""}] `
        : item.author
          ? `[@${item.author}] `
          : "";
      const parts = [title, bodyExcerpt].filter(Boolean).join(" | ");
      return `${i + 1}. ${voice}${parts}${note}`;
    })
    .filter((line) => line.trim().length > 4)
    .join("\n");

  const timelineSection =
    periodNarratives.length > 0
      ? `\nNarrative timeline:\n${periodNarratives.map((p) => `[${p.periodDate}] ${p.narrative}`).join("\n")}\n`
      : "";

  const analystNoteSection = clusterAnalystNote
    ? `\nAnalyst note on this story: "${clusterAnalystNote}"\n`
    : "";

  const { text } = await generateText({
    model: openai("gpt-4o-mini"),
    prompt: `You are analyzing public sentiment towards a specific entity based on news coverage, article content, and analyst notes. Respond ONLY with valid JSON.

Entity being tracked: "${entityLabel}"
Story cluster: "${clusterLabel ?? "Unnamed cluster"}"
${analystNoteSection}${timelineSection}
Article coverage (title | body excerpt | analyst note):
${itemList}

Assess the OVERALL sentiment of this coverage towards "${entityLabel}" specifically (not the topic in general).

Weighting rules (for social threads where lines are tagged [OP @user] or [@user]):
- Judge sentiment by UNIQUE voices, not raw message count. All messages from the same author count as ONE voice no matter how many times that author appears.
- The original poster ([OP]) is a single voice. When the OP repeatedly replies to defend or argue their own position, those replies add NO extra weight.
- Only use "mixed" when significant positive AND negative sentiment comes from many DIFFERENT authors. If most distinct commenters lean one way and the pushback comes mainly from the OP or one repeat author, use the majority direction instead of "mixed".

- "positive": coverage is favorable, praising, or beneficial to ${entityLabel}
- "negative": coverage is critical, damaging, or harmful to ${entityLabel}
- "neutral": factual reporting without strong positive or negative framing towards ${entityLabel}
- "mixed": contains significant positive AND negative coverage towards ${entityLabel}
- score: -1.0 (very negative) to 1.0 (very positive), 0.0 for neutral or mixed

Respond with JSON only, no markdown:
{"sentiment":"positive"|"negative"|"neutral"|"mixed","score":<float -1.0 to 1.0>}`,
    maxOutputTokens: 150,
  });

  try {
    const raw = text.trim().replace(/^```json\s*/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw) as SentimentResult;
    const validLabels = ["positive", "negative", "neutral", "mixed"];
    return {
      sentiment: validLabels.includes(parsed.sentiment) ? parsed.sentiment : "neutral",
      score: typeof parsed.score === "number" ? Math.max(-1, Math.min(1, parsed.score)) : 0,
    };
  } catch {
    return { sentiment: "neutral", score: 0 };
  }
}
