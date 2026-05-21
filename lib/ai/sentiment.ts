import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

export type SentimentResult = {
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  score: number; // -1.0 to 1.0
};

export async function analyzeEntitySentiment(opts: {
  entityLabel: string;
  clusterLabel: string | null;
  items: Array<{ title: string | null; body: string | null; analystNote: string | null }>;
  periodNarratives?: Array<{ periodDate: string; narrative: string }>;
  clusterAnalystNote?: string | null;
}): Promise<SentimentResult> {
  const { entityLabel, clusterLabel, items, periodNarratives = [], clusterAnalystNote } = opts;

  const itemList = items
    .slice(0, 20)
    .map((item, i) => {
      const title = item.title ?? "";
      const bodyExcerpt = item.body?.slice(0, 200) ?? "";
      const note = item.analystNote ? ` [analyst: ${item.analystNote}]` : "";
      const parts = [title, bodyExcerpt].filter(Boolean).join(" | ");
      return `${i + 1}. ${parts}${note}`;
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
