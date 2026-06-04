import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import { rssFeeds, trackedEntities, ingestedItems, newsTimelineDays } from "@/lib/db/schema";

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
  if (hasPositive && hasNegative) sentimentLabel = "mixed";
  else if (sentimentScore > 0.15) sentimentLabel = "positive";
  else if (sentimentScore < -0.15) sentimentLabel = "negative";
  else sentimentLabel = "neutral";
  const lead = [...stories].sort((a, b) => b.count - a.count)[0];
  return { aiSummary: lead.summary, sentimentScore, sentimentLabel };
}

export const maxDuration = 300;

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  // force=true bypasses the "already generated" cache check
  const force = searchParams.get("force") === "true";

  const feeds = await db
    .select({
      feedId: rssFeeds.id,
      feedLabel: rssFeeds.label,
      entityId: trackedEntities.id,
      entityLabel: trackedEntities.label,
    })
    .from(rssFeeds)
    .innerJoin(trackedEntities, eq(rssFeeds.entityId, trackedEntities.id))
    .where(eq(trackedEntities.companyId, companyId));

  if (feeds.length === 0) return NextResponse.json({ ok: false, error: "no_feeds" });

  // Fetch all relevant items in two flat queries
  const feedIds = feeds.map((f) => f.feedId);
  const entityIds = [...new Set(feeds.map((f) => f.entityId))];

  const [allGoogleItems, allManualItems] = await Promise.all([
    db
      .select({ title: ingestedItems.title, createdAt: ingestedItems.createdAt, rssFeedId: ingestedItems.rssFeedId, entityId: ingestedItems.entityId })
      .from(ingestedItems)
      .where(eq(ingestedItems.platform, "google_alerts")),
    db
      .select({ title: ingestedItems.title, publishedAt: ingestedItems.publishedAt, createdAt: ingestedItems.createdAt, entityId: ingestedItems.entityId })
      .from(ingestedItems)
      .where(
        and(
          eq(ingestedItems.platform, "manual"),
          eq(ingestedItems.showInNewsTimeline, true),
        )
      ),
  ]);

  // Filter to this company's scope
  const companyGoogleItems = allGoogleItems.filter(
    (item) => (item.rssFeedId && feedIds.includes(item.rssFeedId)) || (!item.rssFeedId && item.entityId && entityIds.includes(item.entityId))
  );
  const companyManualItems = allManualItems.filter(
    (item) => item.entityId && entityIds.includes(item.entityId)
  );

  let processed = 0;
  let skipped = 0;
  let total = 0;
  const now = new Date();

  for (const feed of feeds) {
    const googleItems = companyGoogleItems.filter(
      (item) => item.rssFeedId === feed.feedId || (item.rssFeedId === null && item.entityId === feed.entityId)
    );
    const manualItems = companyManualItems.filter((item) => item.entityId === feed.entityId);

    // Group all items by day
    const byDay = new Map<string, { titles: string[]; latestAt: Date }>();

    for (const item of googleItems) {
      const day = item.createdAt.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { titles: [], latestAt: item.createdAt });
      const entry = byDay.get(day)!;
      if (item.title?.trim()) entry.titles.push(item.title.trim());
      if (item.createdAt > entry.latestAt) entry.latestAt = item.createdAt;
    }

    for (const item of manualItems) {
      const date = item.publishedAt ?? item.createdAt;
      const day = date.toISOString().slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, { titles: [], latestAt: date });
      const entry = byDay.get(day)!;
      if (item.title?.trim()) entry.titles.push(item.title.trim());
      if (date > entry.latestAt) entry.latestAt = date;
    }

    for (const [day, { titles, latestAt }] of byDay) {
      total++;
      if (titles.length === 0) { skipped++; continue; }

      if (!force) {
        const [existing] = await db
          .select({ generatedAt: newsTimelineDays.generatedAt, stories: newsTimelineDays.stories })
          .from(newsTimelineDays)
          .where(and(eq(newsTimelineDays.rssFeedId, feed.feedId), eq(newsTimelineDays.periodDate, day)))
          .limit(1);

        if (existing?.stories != null && existing.generatedAt && existing.generatedAt >= latestAt) {
          skipped++;
          continue;
        }
      }

      try {
        const titleList = titles.slice(0, 12).map((t, i) => `${i + 1}. ${t}`).join("\n");

        const { text } = await generateText({
          model: openai("gpt-4o-mini"),
          prompt: `These are news headlines about "${feed.feedLabel}" (tracked for ${feed.entityLabel}) from ${day}:\n\n${titleList}\n\nGroup them into distinct stories. For each story provide a label, 1-2 sentence summary, sentiment (positive|negative|neutral|mixed), score (-1.0 to 1.0), and count of how many titles belong to it.\nReturn JSON only:\n{"stories":[{"label":"...","summary":"...","sentiment":"positive","score":0.0,"count":1}]}`,
          maxOutputTokens: 400,
        });

        const raw = text.trim().replace(/^```json\s*/m, "").replace(/```$/m, "").trim();
        const parsed = JSON.parse(raw) as { stories: Story[] };
        const stories: Story[] = (parsed.stories ?? []).map((s) => ({
          label: String(s.label ?? ""),
          summary: String(s.summary ?? ""),
          sentiment: (VALID_SENTIMENTS as readonly string[]).includes(s.sentiment) ? (s.sentiment as Story["sentiment"]) : "neutral",
          score: typeof s.score === "number" ? Math.max(-1, Math.min(1, s.score)) : 0,
          count: typeof s.count === "number" ? s.count : 1,
        }));

        const { aiSummary, sentimentScore, sentimentLabel } = deriveAggregate(stories);

        await db
          .insert(newsTimelineDays)
          .values({ rssFeedId: feed.feedId, periodDate: day, stories, aiSummary, sentimentScore, sentimentLabel, itemCount: titles.length, generatedAt: now, updatedAt: now })
          .onConflictDoUpdate({
            target: [newsTimelineDays.rssFeedId, newsTimelineDays.periodDate],
            set: { stories, aiSummary, sentimentScore, sentimentLabel, itemCount: titles.length, generatedAt: now, updatedAt: now },
          });

        processed++;
      } catch (err) {
        console.error(`[summarize-news-timeline] feed ${feed.feedId} day ${day}:`, err);
        skipped++;
      }
    }
  }

  return NextResponse.json({ ok: true, processed, skipped, total });
}
