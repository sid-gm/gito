import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rssFeeds } from "@/lib/db/schema";
import { upsertItems } from "@/lib/collectors/ingest";
import { collectGoogleAlerts } from "@/lib/collectors/google-alerts";

export async function POST() {
  const feeds = await db.select().from(rssFeeds);
  let total = 0;

  for (const feed of feeds) {
    try {
      const items = await collectGoogleAlerts(feed);
      const inserted = await upsertItems(items);
      total += inserted;
    } catch (err) {
      console.error(`[GoogleAlerts:poll] feed ${feed.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, inserted: total });
}
