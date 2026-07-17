import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, topics } from "@/lib/db/schema";
import { effectiveTs, reachScore } from "@/lib/db/sql-fragments";
import { and, count, desc, eq, gte, ilike, or, sql } from "drizzle-orm";

const PLATFORMS = ["twitter", "threads", "reddit", "instagram", "facebook", "linkedin", "news", "manual"] as const;
type Platform = (typeof PLATFORMS)[number];

// Raw data view: every ingested post/comment, newest first
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const days = Math.min(Number(searchParams.get("days")) || 7, 90);
  const platform = searchParams.get("platform");
  const topicId = searchParams.get("topicId");
  const kind = searchParams.get("kind");
  const q = searchParams.get("q")?.trim();
  const offset = Math.max(Number(searchParams.get("offset")) || 0, 0);
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filters = and(
    eq(items.companyId, companyId),
    gte(sql`${effectiveTs}`, cutoff),
    platform && (PLATFORMS as readonly string[]).includes(platform)
      ? eq(items.platform, platform as Platform)
      : undefined,
    topicId ? eq(items.topicId, topicId) : undefined,
    kind === "post" || kind === "comment" ? eq(items.kind, kind) : undefined,
    q
      ? or(
          ilike(items.title, `%${q}%`),
          ilike(items.body, `%${q}%`),
          ilike(items.author, `%${q}%`)
        )
      : undefined
  );

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        id: items.id,
        platform: items.platform,
        kind: items.kind,
        url: items.url,
        author: items.author,
        title: items.title,
        body: items.body,
        publishedAt: items.publishedAt,
        publishedAtPrecision: items.publishedAtPrecision,
        createdAt: items.createdAt,
        topicId: items.topicId,
        topicLabel: topics.label,
        sentimentScore: items.sentimentScore,
        sentimentLabel: items.sentimentLabel,
        sourceKind: items.sourceKind,
        sourceRef: items.sourceRef,
        extractionMethod: items.extractionMethod,
        latestEngagement: items.latestEngagement,
        reach: reachScore,
      })
      .from(items)
      .leftJoin(topics, eq(topics.id, items.topicId))
      .where(filters)
      .orderBy(desc(sql`${effectiveTs}`))
      .offset(offset)
      .limit(limit),
    db.select({ total: count() }).from(items).where(filters),
  ]);

  return NextResponse.json({
    items: rows,
    total,
    offset,
    nextOffset: offset + rows.length < total ? offset + rows.length : null,
  });
}
