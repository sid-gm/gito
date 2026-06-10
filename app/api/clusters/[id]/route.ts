import { NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities } from "@/lib/db/schema";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const [cluster] = await db
    .select({
      id: clusters.id,
      entityId: clusters.entityId,
      label: clusters.label,
      itemCount: clusters.itemCount,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      classification: clusters.classification,
      narrativeStage: clusters.narrativeStage,
      narrativeSummary: clusters.narrativeSummary,
      momentum: clusters.momentum,
      peakMomentum: clusters.peakMomentum,
      velocity24h: clusters.velocity24h,
      prevVelocity24h: clusters.prevVelocity24h,
      platformCount: clusters.platformCount,
      analystClassification: clusters.analystClassification,
      analystNote: clusters.analystNote,
      analystReviewedAt: clusters.analystReviewedAt,
      sentimentScore: clusters.sentimentScore,
      sentimentLabel: clusters.sentimentLabel,
      suggestedKeywords: clusters.suggestedKeywords,
    })
    .from(clusters)
    .where(eq(clusters.id, id));

  if (!cluster) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const items = await db
    .select({
      platform: ingestedItems.platform,
      entityId: ingestedItems.entityId,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, id))
    .orderBy(desc(clusterItems.similarity));

  const platforms = [...new Set(items.map((i) => i.platform))];

  const entityIds = [...new Set(items.map((i) => i.entityId).filter((eid): eid is string => !!eid))];
  const entityRows =
    entityIds.length > 0
      ? await db
          .select({ id: trackedEntities.id, label: trackedEntities.label })
          .from(trackedEntities)
          .where(inArray(trackedEntities.id, entityIds))
      : [];

  return NextResponse.json({
    ...cluster,
    effectiveClassification: cluster.analystClassification ?? cluster.classification,
    platforms,
    trackedEntities: entityRows,
  });
}
