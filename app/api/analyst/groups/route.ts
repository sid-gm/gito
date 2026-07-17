import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items, topics } from "@/lib/db/schema";
import { effectiveTs, pacificDay } from "@/lib/db/sql-fragments";
import { and, avg, count, desc, eq, gte, sql } from "drizzle-orm";

// Groups view: volume + avg sentiment by time / platform / topic
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const by = searchParams.get("by") ?? "time";
  const days = Math.min(Number(searchParams.get("days")) || 7, 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const filters = and(eq(items.companyId, companyId), gte(sql`${effectiveTs}`, cutoff));

  if (by === "time") {
    const rows = await db
      .select({
        bucket: pacificDay,
        count: count(),
        avgSentiment: avg(items.sentimentScore),
      })
      .from(items)
      .where(filters)
      .groupBy(sql`1`)
      .orderBy(sql`1`);
    return NextResponse.json({ by, groups: rows });
  }

  if (by === "platform") {
    const rows = await db
      .select({
        bucket: items.platform,
        count: count(),
        avgSentiment: avg(items.sentimentScore),
      })
      .from(items)
      .where(filters)
      .groupBy(items.platform)
      .orderBy(desc(count()));
    return NextResponse.json({ by, groups: rows });
  }

  if (by === "topic") {
    const rows = await db
      .select({
        bucket: sql<string>`COALESCE(${topics.label}, '(no topic)')`,
        topicId: items.topicId,
        count: count(),
        avgSentiment: avg(items.sentimentScore),
      })
      .from(items)
      .leftJoin(topics, eq(topics.id, items.topicId))
      .where(filters)
      .groupBy(sql`1`, items.topicId)
      .orderBy(desc(count()));
    return NextResponse.json({ by, groups: rows });
  }

  return NextResponse.json({ error: "by must be time|platform|topic" }, { status: 400 });
}
