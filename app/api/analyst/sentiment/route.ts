import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { items } from "@/lib/db/schema";
import { effectiveTs, pacificDay } from "@/lib/db/sql-fragments";
import { and, avg, count, eq, gte, isNotNull, sql } from "drizzle-orm";

// Sentiment view: per-platform mean daily sentiment + pos/neu/neg/mixed split
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const days = Math.min(Number(searchParams.get("days")) || 14, 90);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const scored = and(
    eq(items.companyId, companyId),
    gte(sql`${effectiveTs}`, cutoff),
    isNotNull(items.sentimentScore)
  );

  const [daily, splits] = await Promise.all([
    db
      .select({
        platform: items.platform,
        date: pacificDay,
        avgSentiment: avg(items.sentimentScore),
        count: count(),
      })
      .from(items)
      .where(scored)
      .groupBy(items.platform, sql`2`)
      .orderBy(sql`2`),
    db
      .select({
        platform: items.platform,
        label: items.sentimentLabel,
        count: count(),
      })
      .from(items)
      .where(scored)
      .groupBy(items.platform, items.sentimentLabel),
  ]);

  const platforms = new Map<
    string,
    {
      platform: string;
      series: Array<{ date: string; avgSentiment: string | null; count: number }>;
      split: Record<string, number>;
    }
  >();

  const ensure = (platform: string) => {
    if (!platforms.has(platform)) {
      platforms.set(platform, {
        platform,
        series: [],
        split: { positive: 0, neutral: 0, negative: 0, mixed: 0 },
      });
    }
    return platforms.get(platform)!;
  };

  for (const row of daily) {
    ensure(row.platform).series.push({ date: row.date, avgSentiment: row.avgSentiment, count: row.count });
  }
  for (const row of splits) {
    if (row.label) ensure(row.platform).split[row.label] = row.count;
  }

  return NextResponse.json({ days, platforms: [...platforms.values()] });
}
