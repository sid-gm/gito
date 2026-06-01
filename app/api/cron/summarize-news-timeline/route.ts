import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { rssFeeds, trackedEntities, ingestedItems, newsTimelineDays } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";

const PAIR_LIMIT = 30;

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const feeds = await db
    .select({
      feedId: rssFeeds.id,
      feedLabel: rssFeeds.label,
      entityLabel: trackedEntities.label,
    })
    .from(rssFeeds)
    .innerJoin(trackedEntities, eq(rssFeeds.entityId, trackedEntities.id));

  // Collect (feed, day) pairs up to PAIR_LIMIT
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
      .where(
        and(
          eq(ingestedItems.platform, "google_alerts"),
          eq(ingestedItems.rssFeedId, feed.feedId)
        )
      );

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
      .select({ generatedAt: newsTimelineDays.generatedAt })
      .from(newsTimelineDays)
      .where(and(eq(newsTimelineDays.rssFeedId, pair.feedId), eq(newsTimelineDays.periodDate, pair.day)))
      .limit(1);

    if (existing?.generatedAt && existing.generatedAt >= pair.latestItemAt) continue;

    try {
      const titleList = pair.titles.slice(0, 8).map((t, i) => `${i + 1}. ${t}`).join("\n");

      const { text: summaryText } = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: `These are Google Alerts headlines about "${pair.feedLabel}" (tracked for ${pair.entityLabel}) from ${pair.day}:\n\n${titleList}\n\nWrite 1-2 sentences summarizing the key news on this date. Be concise and factual.`,
        maxOutputTokens: 80,
      });

      const { text: sentimentText } = await generateText({
        model: openai("gpt-4o-mini"),
        prompt: `Rate the overall sentiment of these headlines about "${pair.feedLabel}" from ${pair.day}:\n\n${titleList}\n\nRespond with JSON only: {"sentiment":"positive"|"negative"|"neutral"|"mixed","score":<float -1.0 to 1.0>}`,
        maxOutputTokens: 60,
      });

      let sentimentScore: number | null = null;
      let sentimentLabel: string | null = null;
      try {
        const raw = sentimentText.trim().replace(/^```json\s*/, "").replace(/```$/, "").trim();
        const parsed = JSON.parse(raw) as { sentiment: string; score: number };
        const valid = ["positive", "negative", "neutral", "mixed"];
        sentimentLabel = valid.includes(parsed.sentiment) ? parsed.sentiment : null;
        sentimentScore = typeof parsed.score === "number" ? Math.max(-1, Math.min(1, parsed.score)) : null;
      } catch { /* leave null */ }

      const row = {
        aiSummary: summaryText.trim() || null,
        sentimentScore,
        sentimentLabel,
        itemCount: pair.titles.length,
        generatedAt: now,
        updatedAt: now,
      };

      await db
        .insert(newsTimelineDays)
        .values({ rssFeedId: pair.feedId, periodDate: pair.day, ...row })
        .onConflictDoUpdate({
          target: [newsTimelineDays.rssFeedId, newsTimelineDays.periodDate],
          set: row,
        });

      processed++;
    } catch (err) {
      console.error(`[summarize-news-timeline] feed ${pair.feedId} day ${pair.day}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
