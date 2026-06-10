import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { entityDayInsights, trackedEntities } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId");
  const entityId = req.nextUrl.searchParams.get("entityId");
  const date = req.nextUrl.searchParams.get("date");
  const window = req.nextUrl.searchParams.get("window") ?? "30d";

  const conditions = [];

  if (entityId) {
    conditions.push(eq(entityDayInsights.entityId, entityId));
  } else if (companyId) {
    const entityRows = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
    if (entityRows.length === 0) return NextResponse.json({ insights: [] });
    conditions.push(inArray(entityDayInsights.entityId, entityRows.map((e) => e.id)));
  } else {
    return NextResponse.json({ error: "companyId or entityId required" }, { status: 400 });
  }

  if (date) {
    conditions.push(eq(entityDayInsights.periodDate, date));
  } else {
    const windowDays = window === "90d" ? 90 : window === "7d" ? 7 : 30;
    const cutoff = new Date(Date.now() - windowDays * 24 * 3600000).toISOString().slice(0, 10);
    conditions.push(gte(entityDayInsights.periodDate, cutoff));
  }

  const rows = await db
    .select({
      entityId: entityDayInsights.entityId,
      periodDate: entityDayInsights.periodDate,
      newsScore: entityDayInsights.newsScore,
      socialScore: entityDayInsights.socialScore,
      divergence: entityDayInsights.divergence,
      driverSummary: entityDayInsights.driverSummary,
      topClusterIds: entityDayInsights.topClusterIds,
    })
    .from(entityDayInsights)
    .where(and(...conditions))
    .orderBy(asc(entityDayInsights.periodDate));

  return NextResponse.json({ insights: rows });
}
