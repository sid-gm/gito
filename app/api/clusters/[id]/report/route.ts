import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  clusters,
  clusterItems,
  clusterPeriodNarratives,
  ingestedItems,
  trackedEntities,
  companies,
} from "@/lib/db/schema";
import { and, count, desc, eq, gte, sql } from "drizzle-orm";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const clusterRow = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      itemCount: clusters.itemCount,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      narrativeStage: clusters.narrativeStage,
      narrativeSummary: clusters.narrativeSummary,
      sentimentScore: clusters.sentimentScore,
      sentimentLabel: clusters.sentimentLabel,
      velocity24h: clusters.velocity24h,
      prevVelocity24h: clusters.prevVelocity24h,
      platformCount: clusters.platformCount,
      analystClassification: clusters.analystClassification,
      analystNote: clusters.analystNote,
      entityLabel: trackedEntities.label,
      companyName: companies.name,
    })
    .from(clusters)
    .leftJoin(trackedEntities, eq(clusters.entityId, trackedEntities.id))
    .leftJoin(companies, eq(trackedEntities.companyId, companies.id))
    .where(eq(clusters.id, id))
    .limit(1);

  if (!clusterRow.length)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const cluster = {
    ...clusterRow[0],
    firstSeenAt: clusterRow[0].firstSeenAt.toISOString(),
    lastSeenAt: clusterRow[0].lastSeenAt.toISOString(),
  };

  const narratives = await db
    .select({
      periodDate: clusterPeriodNarratives.periodDate,
      aiNarrative: clusterPeriodNarratives.aiNarrative,
      analystNarrative: clusterPeriodNarratives.analystNarrative,
    })
    .from(clusterPeriodNarratives)
    .where(eq(clusterPeriodNarratives.clusterId, id))
    .orderBy(clusterPeriodNarratives.periodDate);

  const items = await db
    .select({
      platform: ingestedItems.platform,
      title: ingestedItems.title,
      author: ingestedItems.author,
      publishedAt: ingestedItems.publishedAt,
      url: ingestedItems.url,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, id))
    .orderBy(desc(clusterItems.similarity))
    .limit(20);

  const sourceBreakdown = await db
    .select({
      platform: ingestedItems.platform,
      itemCount: count(),
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, id))
    .groupBy(ingestedItems.platform)
    .orderBy(desc(count()));

  const since48h = new Date(Date.now() - 48 * 3600000);
  const velocityHistory = await db
    .select({
      bucket: sql<string>`TO_CHAR(DATE_TRUNC('hour', ${clusterItems.addedAt}), 'YYYY-MM-DD HH24:00')`,
      itemCount: count(),
    })
    .from(clusterItems)
    .where(and(eq(clusterItems.clusterId, id), gte(clusterItems.addedAt, since48h)))
    .groupBy(sql`DATE_TRUNC('hour', ${clusterItems.addedAt})`)
    .orderBy(sql`DATE_TRUNC('hour', ${clusterItems.addedAt})`);

  return NextResponse.json({
    cluster,
    narratives,
    items: items.map((i) => ({
      ...i,
      publishedAt: i.publishedAt?.toISOString() ?? null,
    })),
    sourceBreakdown,
    velocityHistory,
  });
}
