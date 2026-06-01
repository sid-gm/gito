import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, rssFeeds } from "@/lib/db/schema";

// One-off: backfill rss_feed_id on google_alerts items that predate the column.
// For each item with no rss_feed_id, look up rss_feeds by entity_id and stamp it.
export async function POST() {
  const items = await db
    .select({ id: ingestedItems.id, entityId: ingestedItems.entityId })
    .from(ingestedItems)
    .where(and(eq(ingestedItems.platform, "google_alerts"), isNull(ingestedItems.rssFeedId)));

  let updated = 0;
  for (const item of items) {
    if (!item.entityId) continue;
    const feeds = await db
      .select({ id: rssFeeds.id })
      .from(rssFeeds)
      .where(eq(rssFeeds.entityId, item.entityId))
      .orderBy(rssFeeds.createdAt)
      .limit(1);
    if (feeds.length === 0) continue;
    await db
      .update(ingestedItems)
      .set({ rssFeedId: feeds[0].id })
      .where(eq(ingestedItems.id, item.id));
    updated++;
  }

  console.log(`[backfill-rss-feed-id] updated ${updated} / ${items.length} items`);
  return NextResponse.json({ ok: true, total: items.length, updated });
}
