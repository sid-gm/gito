import { NextRequest, NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, clusterPeriodNarratives, ingestedItems, trackedEntities } from "@/lib/db/schema";
import { analyzeEntitySentiment, withOpFlags } from "@/lib/ai/sentiment";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [clusterRow] = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      analystNote: clusters.analystNote,
      entityLabel: trackedEntities.label,
    })
    .from(clusters)
    .leftJoin(trackedEntities, eq(clusters.entityId, trackedEntities.id))
    .where(eq(clusters.id, id))
    .limit(1);

  if (!clusterRow) return NextResponse.json({ error: "not found" }, { status: 404 });

  const itemRows = await db
    .select({
      title: ingestedItems.title,
      body: ingestedItems.body,
      analystNote: clusterItems.analystNote,
      author: ingestedItems.author,
      subtype: ingestedItems.subtype,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, id))
    .orderBy(desc(clusterItems.similarity), asc(ingestedItems.createdAt))
    .limit(40);

  if (itemRows.length === 0) return NextResponse.json({ error: "no items" }, { status: 422 });

  const items = withOpFlags(itemRows);

  const periodRows = await db
    .select({
      periodDate: clusterPeriodNarratives.periodDate,
      aiNarrative: clusterPeriodNarratives.aiNarrative,
      analystNarrative: clusterPeriodNarratives.analystNarrative,
    })
    .from(clusterPeriodNarratives)
    .where(eq(clusterPeriodNarratives.clusterId, id))
    .orderBy(clusterPeriodNarratives.periodDate);

  const periodNarratives = periodRows
    .map((p) => ({ periodDate: p.periodDate, narrative: p.analystNarrative ?? p.aiNarrative ?? "" }))
    .filter((p) => p.narrative.trim().length > 0);

  const result = await analyzeEntitySentiment({
    entityLabel: clusterRow.entityLabel ?? "Unknown",
    clusterLabel: clusterRow.label,
    items,
    periodNarratives,
    clusterAnalystNote: clusterRow.analystNote,
  });

  const now = new Date();
  await db
    .update(clusters)
    .set({
      sentimentScore: result.score,
      sentimentLabel: result.sentiment,
      sentimentAnalyzedAt: now,
    })
    .where(eq(clusters.id, id));

  return NextResponse.json({
    sentimentScore: result.score,
    sentimentLabel: result.sentiment,
    sentimentAnalyzedAt: now.toISOString(),
  });
}
