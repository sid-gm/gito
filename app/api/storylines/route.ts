import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, inArray, sum } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, storylines, trackedEntities } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId");
  const entityId = req.nextUrl.searchParams.get("entityId");
  const status = req.nextUrl.searchParams.get("status") ?? "all";

  const conditions = [];
  if (status !== "all") conditions.push(eq(storylines.status, status));
  if (entityId) {
    conditions.push(eq(storylines.entityId, entityId));
  } else if (companyId) {
    const entityRows = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
    if (entityRows.length === 0) return NextResponse.json({ storylines: [] });
    conditions.push(inArray(storylines.entityId, entityRows.map((e) => e.id)));
  }

  const rows = await db
    .select({
      id: storylines.id,
      entityId: storylines.entityId,
      entityLabel: trackedEntities.label,
      title: storylines.title,
      summary: storylines.summary,
      status: storylines.status,
      originClusterId: storylines.originClusterId,
      firstSeenAt: storylines.firstSeenAt,
      lastSeenAt: storylines.lastSeenAt,
      newsSentimentScore: storylines.newsSentimentScore,
      socialSentimentScore: storylines.socialSentimentScore,
      platformLens: storylines.platformLens,
      lensGeneratedAt: storylines.lensGeneratedAt,
    })
    .from(storylines)
    .leftJoin(trackedEntities, eq(storylines.entityId, trackedEntities.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(storylines.lastSeenAt));

  if (rows.length === 0) return NextResponse.json({ storylines: [] });

  const memberStats = await db
    .select({
      storylineId: clusters.storylineId,
      clusterCount: count(clusters.id),
      totalItems: sum(clusters.itemCount),
    })
    .from(clusters)
    .where(inArray(clusters.storylineId, rows.map((r) => r.id)))
    .groupBy(clusters.storylineId);
  const statsById = new Map(memberStats.map((s) => [s.storylineId, s]));

  return NextResponse.json({
    storylines: rows.map((r) => {
      const stats = statsById.get(r.id);
      return {
        ...r,
        firstSeenAt: r.firstSeenAt.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
        lensGeneratedAt: r.lensGeneratedAt?.toISOString() ?? null,
        clusterCount: stats?.clusterCount ?? 0,
        totalItems: Number(stats?.totalItems ?? 0),
      };
    }),
  });
}
