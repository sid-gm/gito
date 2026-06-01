import { NextResponse } from "next/server";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const deleted = await db
    .delete(ingestedItems)
    .where(and(eq(ingestedItems.platform, "google_alerts"), lt(ingestedItems.createdAt, cutoff)))
    .returning({ id: ingestedItems.id });

  console.log(`[purge-news-items] deleted ${deleted.length} items`);
  return NextResponse.json({ ok: true, deleted: deleted.length });
}
