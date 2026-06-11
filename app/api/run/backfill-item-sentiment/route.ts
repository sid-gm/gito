import { NextResponse } from "next/server";
import { and, count, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, trackedEntities } from "@/lib/db/schema";
import { scoreItemRows } from "@/lib/ai/item-sentiment";

export const maxDuration = 300;

/**
 * One-off backfill of per-item sentiment for a single company. The classify
 * cron only scores items ingested after the feature shipped; this scores the
 * trailing window for companies that want history (e.g. Daniel Lurie, 7 days).
 * Idempotent — re-run until `remaining` hits 0.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const companyId: string | undefined = body.companyId;
  const days: number = Math.min(Number(body.days) || 7, 90);
  const limit: number = Math.min(Number(body.limit) || 400, 1000);

  if (!companyId) {
    return NextResponse.json({ error: "companyId is required" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const windowFilter = and(
    eq(trackedEntities.companyId, companyId),
    isNull(ingestedItems.sentimentAnalyzedAt),
    or(
      gte(ingestedItems.publishedAt, cutoff),
      and(isNull(ingestedItems.publishedAt), gte(ingestedItems.createdAt, cutoff))
    )
  );

  const rows = await db
    .select({
      id: ingestedItems.id,
      title: ingestedItems.title,
      body: ingestedItems.body,
      author: ingestedItems.author,
      entityLabel: trackedEntities.label,
    })
    .from(ingestedItems)
    .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
    .where(windowFilter)
    .orderBy(desc(sql`COALESCE(${ingestedItems.publishedAt}, ${ingestedItems.createdAt})`))
    .limit(limit);

  const scored = rows.length > 0 ? await scoreItemRows(rows) : 0;

  const [remainingRow] = await db
    .select({ cnt: count(ingestedItems.id) })
    .from(ingestedItems)
    .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
    .where(windowFilter);

  return NextResponse.json({
    ok: true,
    companyId,
    days,
    scored,
    remaining: remainingRow?.cnt ?? 0,
  });
}
