import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { rssFeeds, trackedEntities, ingestedItems, newsTimelineDays } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";

const PAIR_LIMIT = 30;

type Story = {
  label: string;
  summary: string;
  sentiment: "positive" | "negative" | "neutral" | "mixed";
  score: number;
  count: number;
};

const VALID_SENTIMENTS = ["positive", "negative", "neutral", "mixed"] as const;

function deriveAggregate(stories: Story[]) {
  if (stories.length === 0) return { aiSummary: null, sentimentScore: null, sentimentLabel: null };

  const totalCount = stories.reduce((sum, s) => sum + s.count, 0) || 1;
  const weightedScore = stories.reduce((sum, s) => sum + s.score * s.count, 0) / totalCount;
  const sentimentScore = Math.max(-1, Math.min(1, weightedScore));

  const hasPositive = stories.some((s) => s.score > 0.15);
  const hasNegative = stories.some((s) => s.score < -0.15);
  let sentimentLabel: string;
  if (hasPositive && hasNegative) {
    sentimentLabel = "mixed";
  } else if (sentimentScore > 0.15) {
    sentimentLabel = "positive";
  } else if (sentimentScore < -0.15) {
    sentimentLabel = "negative";
  } else {
    sentimentLabel = "neutral";
  }

  const lead = [...stories].sort((a, b) => b.count - a.count)[0];
  return { aiSummary: lead.summary, sentimentScore, sentimentLabel };
}

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const feeds = await db
    .select({ feedId: rssFeeds.id, feedLabel: rssFeeds.label, entityLabel: trackedEntities.label })
    .from(rssFeeds)
    .innerJoin(trackedEntities, eq(rssFeeds.entityId, trackedEntities.id));

  type Pair = {
    feedId: string;
    feedLabel: string;
    entityLabel: string;
    day: string;
    titles: string[];
    latestItemAt: Date;
  };
  const pairs: Pair[] = [];

  for (const feed of feeds) {
    if (pairs.length >= PAIR_LIMIT) break;

    const items = await db
      .select({ title: ingestedItems.title, createdAt: ingestedItems.createdAt })
      .from(ingestedItems)
      .where(and(eq(ingestedItems.platform, "google_alerts"), eq(ingestedItems.rssFeedId, feed.feedId)));

    const byDay = new Map<string, { titles: string[]; latestAt: Date }>();
    for (const item of items) {
      const day = item.createdAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { titles: [], latestAt: item.createdAt });
      const entry = byDay.get(day)!;
      if (item.title?.trim()) entry.titles.push(item.title.trim());
      if (item.createdAt > entry.latestAt) entry.latestAt = item.createdAt;
    }

    for (const [day, { titles, latestAt }] of byDay) {
      pairs.push({ feedId: feed.feedId, feedLabel: feed.feedLabel, entityLabel: feed.entityLabel, day, titles, latestItemAt: latestAt });
      if (pairs.length >= PAIR_LIMIT) break;
    }
  }

  const now = new Date();
  let processed = 0;

  for (const pair of pairs) {
    if (pair.titles.length === 0) continue;

    const [existing] = await db
      .select({ generatedAt: newsTimelineDays.generatedAt, stories: newsTimelineDays.stories })
      .from(newsTimelineDays)
      .where(and(eq(newsTimelineDays.rssFeedId, pair.feedId), eq(newsTimelineDays.periodDate, pair.day)))
      .limit(1);

    if (existing?.stories != null && existing.generatedAt && existing.generatedAt >= pair.latestItemAt) continue;

    try {
      const titleList = pair.titles.slice(0, 12).map((t, i) => `${i + 1}. ${t}`).join("\n");

      const { text } = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: `These are Google Alerts headlines about "${pair.feedLabel}" (tracked for ${pair.entityLabel}) from ${pair.day}:\n\n${titleList}\n\nGroup them into distinct stories. For each story provide a label, 1-2 sentence summary, sentiment (positive|negative|neutral|mixed), score (-1.0 to 1.0), and count of how many titles belong to it.\nReturn JSON only:\n{"stories":[{"label":"...","summary":"...","sentiment":"positive","score":0.0,"count":1}]}`,
        maxOutputTokens: 400,
      });

      const raw = text.trim().replace(/^```json\s*/m, "").replace(/```$/m, "").trim();
      const parsed = JSON.parse(raw) as { stories: Story[] };
      const stories: Story[] = (parsed.stories ?? []).map((s) => ({
        label: String(s.label ?? ""),
        summary: String(s.summary ?? ""),
        sentiment: (VALID_SENTIMENTS as readonly string[]).includes(s.sentiment) ? s.sentiment as Story["sentiment"] : "neutral",
        score: typeof s.score === "number" ? Math.max(-1, Math.min(1, s.score)) : 0,
        count: typeof s.count === "number" ? s.count : 1,
      }));

      const { aiSummary, sentimentScore, sentimentLabel } = deriveAggregate(stories);

      await db
        .insert(newsTimelineDays)
        .values({ rssFeedId: pair.feedId, periodDate: pair.day, stories, aiSummary, sentimentScore, sentimentLabel, itemCount: pair.titles.length, generatedAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: [newsTimelineDays.rssFeedId, newsTimelineDays.periodDate],
          set: { stories, aiSummary, sentimentScore, sentimentLabel, itemCount: pair.titles.length, generatedAt: now, updatedAt: now },
        });

      processed++;
    } catch (err) {
      console.error(`[summarize-news-timeline] feed ${pair.feedId} day ${pair.day}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
