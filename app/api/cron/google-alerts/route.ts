import { NextResponse } from "next/server";
import { verifyCronSecret } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { rssFeeds } from "@/lib/db/schema";
import { upsertItems } from "@/lib/collectors/ingest";
import { collectGoogleAlerts } from "@/lib/collectors/google-alerts";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const feeds = await db.select().from(rssFeeds);
  let total = 0;

  for (const feed of feeds) {
    try {
      const items = await collectGoogleAlerts(feed);
      const inserted = await upsertItems(items);
      total += inserted;
    } catch (err) {
      console.error(`[GoogleAlerts] feed ${feed.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, inserted: total });
}
