import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { rssFeeds, items } from "@/lib/db/schema";
import { collectRssFeed } from "@/lib/collectors/rss";
import { eq } from "drizzle-orm";

export const maxDuration = 300;

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const feeds = await db.select().from(rssFeeds).where(eq(rssFeeds.isActive, true));
  let inserted = 0;
  let failed = 0;

  for (const feed of feeds) {
    try {
      const rows = await collectRssFeed(feed);
      if (rows.length === 0) continue;
      const returned = await db
        .insert(items)
        .values(rows)
        .onConflictDoNothing({ target: [items.companyId, items.platform, items.externalId] })
        .returning({ id: items.id });
      inserted += returned.length;
    } catch (err) {
      failed++;
      console.error(`[collect-rss] feed ${feed.id} (${feed.label}):`, err);
    }
  }

  return NextResponse.json({ ok: true, feeds: feeds.length, inserted, failed });
}
