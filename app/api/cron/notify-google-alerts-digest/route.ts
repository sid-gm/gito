import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/lib/db";
import { newsTimelineDays, rssFeeds, trackedEntities } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";
import { sendNotification } from "@/lib/notifications/telegram";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const today = new Date().toISOString().slice(0, 10);
  const windowStart = new Date(Date.now() - 2.5 * 60 * 60 * 1000);

  const rows = await db
    .select({
      entityLabel: trackedEntities.label,
      itemCount: newsTimelineDays.itemCount,
      sentimentLabel: newsTimelineDays.sentimentLabel,
    })
    .from(newsTimelineDays)
    .innerJoin(rssFeeds, eq(newsTimelineDays.rssFeedId, rssFeeds.id))
    .innerJoin(trackedEntities, eq(rssFeeds.entityId, trackedEntities.id))
    .where(
      and(
        eq(newsTimelineDays.periodDate, today),
        gt(newsTimelineDays.generatedAt, windowStart)
      )
    );

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: "no fresh data" });
  }

  // Group by entity, summing across multiple feeds for the same entity
  const byEntity = new Map<string, { itemCount: number; sentimentLabel: string | null }>();
  for (const row of rows) {
    const existing = byEntity.get(row.entityLabel);
    if (existing) {
      existing.itemCount += row.itemCount;
    } else {
      byEntity.set(row.entityLabel, { itemCount: row.itemCount, sentimentLabel: row.sentimentLabel });
    }
  }

  const lines = [...byEntity.entries()].map(
    ([label, { itemCount, sentimentLabel }]) =>
      `• <b>${label}</b> — ${itemCount} article${itemCount === 1 ? "" : "s"}${sentimentLabel ? `, ${sentimentLabel}` : ""}`
  );

  const message = `<b>Google Alerts Digest</b>\n\n${lines.join("\n")}`;
  await sendNotification(message.length > 300 ? message.slice(0, 297) + "..." : message);

  return NextResponse.json({ ok: true, sent: true, feeds: byEntity.size });
}
