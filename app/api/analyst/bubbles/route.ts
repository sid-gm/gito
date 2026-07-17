import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, topics } from "@/lib/db/schema";
import { pacificDay, reachScore } from "@/lib/db/sql-fragments";
import { and, avg, count, desc, eq, gte, lte, sql } from "drizzle-orm";

// Bubbles view: packed bubbles (size = volume, color = sentiment) by topic or
// platform for one Pacific day or a trailing week, plus top stories per bubble.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const by = searchParams.get("by") === "platform" ? "platform" : "topic";
  const gran = searchParams.get("gran") === "week" ? "week" : "day";

  // period = the (end) Pacific date, default today in Pacific
  const todayPacific = new Date().toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
  const period = searchParams.get("period") ?? todayPacific;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    return NextResponse.json({ error: "period must be YYYY-MM-DD" }, { status: 400 });
  }
  const startDate =
    gran === "week"
      ? new Date(new Date(`${period}T00:00:00Z`).getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : period;

  const filters = and(
    eq(items.companyId, companyId),
    gte(pacificDay, startDate),
    lte(pacificDay, period)
  );

  const bucketExpr =
    by === "platform"
      ? sql<string>`${items.platform}::text`
      : sql<string>`COALESCE(${topics.label}, '(no topic)')`;

  const bucketsQuery = db
    .select({
      bucket: bucketExpr,
      count: count(),
      avgSentiment: avg(items.sentimentScore),
    })
    .from(items)
    .where(filters)
    .groupBy(sql`1`)
    .orderBy(desc(count()));

  const storiesQuery = db
    .select({
      bucket: bucketExpr,
      id: items.id,
      platform: items.platform,
      title: items.title,
      body: items.body,
      url: items.url,
      author: items.author,
      sentimentScore: items.sentimentScore,
      reach: reachScore,
    })
    .from(items)
    .where(filters)
    .orderBy(desc(reachScore))
    .limit(300);

  const [buckets, storyPool] = await Promise.all([
    by === "topic"
      ? bucketsQuery.leftJoin(topics, eq(topics.id, items.topicId))
      : bucketsQuery,
    by === "topic"
      ? storiesQuery.leftJoin(topics, eq(topics.id, items.topicId))
      : storiesQuery,
  ]);

  const TOP_N = 5;
  const topStories = new Map<string, typeof storyPool>();
  for (const story of storyPool) {
    const list = topStories.get(story.bucket) ?? [];
    if (list.length < TOP_N) {
      list.push(story);
      topStories.set(story.bucket, list);
    }
  }

  return NextResponse.json({
    by,
    gran,
    period,
    startDate,
    bubbles: buckets.map((b) => ({
      ...b,
      topStories: (topStories.get(b.bucket) ?? []).map((s) => ({
        id: s.id,
        platform: s.platform,
        title: s.title,
        body: s.body,
        url: s.url,
        author: s.author,
        sentimentScore: s.sentimentScore,
        reach: s.reach,
      })),
    })),
  });
}
