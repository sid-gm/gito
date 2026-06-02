import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestedItems, trackedEntities } from "@/lib/db/schema";
import { count, max, gte, eq, and, inArray } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  let entityFilter = undefined;
  if (companyId) {
    const rows = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
    const ids = rows.map((e) => e.id);
    if (ids.length === 0) {
      return NextResponse.json({ today: 0, sevenDays: 0, lastPoll: null });
    }
    entityFilter = inArray(ingestedItems.entityId, ids);
  }

  const platform = eq(ingestedItems.platform, "reddit");

  const [todayRow] = await db
    .select({ count: count() })
    .from(ingestedItems)
    .where(and(platform, gte(ingestedItems.publishedAt, startOfToday), entityFilter));

  const [sevenDaysRow] = await db
    .select({ count: count() })
    .from(ingestedItems)
    .where(and(platform, gte(ingestedItems.publishedAt, sevenDaysAgo), entityFilter));

  const [lastPollRow] = await db
    .select({ lastPoll: max(ingestedItems.createdAt) })
    .from(ingestedItems)
    .where(entityFilter ? and(platform, entityFilter) : platform);

  return NextResponse.json({
    today: todayRow?.count ?? 0,
    sevenDays: sevenDaysRow?.count ?? 0,
    lastPoll: lastPollRow?.lastPoll ?? null,
  });
}
