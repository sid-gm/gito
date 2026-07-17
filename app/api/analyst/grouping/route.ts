import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, topics } from "@/lib/db/schema";
import { effectiveTs, reachScore } from "@/lib/db/sql-fragments";
import { and, asc, avg, count, desc, eq, gte, ne, sql } from "drizzle-orm";

// likes off the cached engagement snapshot (0 when unknown)
const likesExpr = sql<number>`COALESCE((${items.latestEngagement}->>'likes')::int, 0)`;

// Grouping view: every original post grouped with all its collected replies.
//   - no threadId  → list of root posts + thread-level metrics
//   - ?threadId=id → that root post flattened with its replies + metrics
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const threadId = searchParams.get("threadId");

  // ─── Detail: one root post + all its replies ────────────────────────────
  if (threadId) {
    const [post] = await db
      .select({
        id: items.id,
        platform: items.platform,
        kind: items.kind,
        url: items.url,
        author: items.author,
        title: items.title,
        body: items.body,
        publishedAt: items.publishedAt,
        createdAt: items.createdAt,
        topicId: items.topicId,
        topicLabel: topics.label,
        sentimentScore: items.sentimentScore,
        likes: likesExpr,
        reach: reachScore,
      })
      .from(items)
      .leftJoin(topics, eq(topics.id, items.topicId))
      .where(and(eq(items.companyId, companyId), eq(items.id, threadId)))
      .limit(1);

    if (!post) {
      return NextResponse.json({ error: "thread not found" }, { status: 404 });
    }

    // Every item whose root is this post (chronological, oldest reply first)
    const replies = await db
      .select({
        id: items.id,
        platform: items.platform,
        url: items.url,
        author: items.author,
        title: items.title,
        body: items.body,
        publishedAt: items.publishedAt,
        createdAt: items.createdAt,
        depth: items.depth,
        sentimentScore: items.sentimentScore,
        likes: likesExpr,
        reach: reachScore,
      })
      .from(items)
      .where(
        and(
          eq(items.companyId, companyId),
          eq(items.rootPostId, threadId),
          ne(items.id, threadId),
        ),
      )
      .orderBy(asc(sql`${effectiveTs}`));

    // Whole-thread aggregate metrics
    const scored = [post, ...replies]
      .map((i) => i.sentimentScore)
      .filter((s): s is number => s != null);
    const avgSentiment = scored.length
      ? scored.reduce((a, b) => a + b, 0) / scored.length
      : null;
    const totalLikes =
      post.likes + replies.reduce((sum, r) => sum + (r.likes ?? 0), 0);

    return NextResponse.json({
      post,
      replies,
      replyCount: replies.length,
      avgSentiment,
      totalLikes,
    });
  }

  // ─── List: root posts with thread-level metrics ─────────────────────────
  const days = Math.min(Number(searchParams.get("days")) || 7, 90);
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
  const limit = Math.min(Number(searchParams.get("limit")) || 40, 200);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // Fold every item onto its root post; a bare post is a thread of size 1.
  const thread = db
    .select({
      rootId: sql<string>`COALESCE(${items.rootPostId}, ${items.id})`.as("root_id"),
      size: count().as("thread_size"),
      avgSent: avg(items.sentimentScore).as("avg_sent"),
    })
    .from(items)
    .where(eq(items.companyId, companyId))
    .groupBy(sql`COALESCE(${items.rootPostId}, ${items.id})`)
    .as("thread");

  const postFilters = and(
    eq(items.companyId, companyId),
    eq(items.kind, "post"),
    gte(sql`${effectiveTs}`, cutoff),
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: items.id,
        platform: items.platform,
        url: items.url,
        author: items.author,
        title: items.title,
        body: items.body,
        publishedAt: items.publishedAt,
        createdAt: items.createdAt,
        topicId: items.topicId,
        topicLabel: topics.label,
        rootSentiment: items.sentimentScore,
        likes: likesExpr,
        reach: reachScore,
        replyCount: sql<number>`GREATEST(COALESCE(${thread.size}, 1)::int - 1, 0)`,
        avgSentiment: thread.avgSent,
      })
      .from(items)
      .leftJoin(thread, eq(thread.rootId, items.id))
      .leftJoin(topics, eq(topics.id, items.topicId))
      .where(postFilters)
      // richest conversations first, then most recent
      .orderBy(desc(sql`COALESCE(${thread.size}, 1)`), desc(sql`${effectiveTs}`))
      .offset(offset)
      .limit(limit),
    db.select({ total: count() }).from(items).where(postFilters),
  ]);

  return NextResponse.json({
    threads: rows,
    total,
    offset,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  });
}
