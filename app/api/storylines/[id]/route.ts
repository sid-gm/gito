import { NextRequest, NextResponse } from "next/server";
import { asc, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, clusterNewsLinks, ingestedItems, storylines, trackedEntities } from "@/lib/db/schema";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const row = await db
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
    .where(eq(storylines.id, id))
    .then((rows) => rows[0]);

  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Members in chronological order — the origin cluster ("where this started") first
  const members = await db
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
      classification: clusters.classification,
      analystClassification: clusters.analystClassification,
    })
    .from(clusters)
    .where(eq(clusters.storylineId, id))
    .orderBy(asc(clusters.firstSeenAt));

  const memberIds = members.map((m) => m.id);

  const platformRows =
    memberIds.length > 0
      ? await db
          .select({
            clusterId: clusterItems.clusterId,
            platform: ingestedItems.platform,
            itemCount: count(),
          })
          .from(clusterItems)
          .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
          .where(inArray(clusterItems.clusterId, memberIds))
          .groupBy(clusterItems.clusterId, ingestedItems.platform)
      : [];
  const platformsByCluster = new Map<string, Array<{ platform: string; itemCount: number }>>();
  for (const p of platformRows) {
    if (!platformsByCluster.has(p.clusterId)) platformsByCluster.set(p.clusterId, []);
    platformsByCluster.get(p.clusterId)!.push({ platform: p.platform, itemCount: p.itemCount });
  }

  const newsRows =
    memberIds.length > 0
      ? await db
          .select({
            id: clusterNewsLinks.id,
            clusterId: clusterNewsLinks.clusterId,
            headline: clusterNewsLinks.headline,
            url: clusterNewsLinks.url,
            publishedAt: clusterNewsLinks.publishedAt,
            relationship: clusterNewsLinks.relationship,
            explanation: clusterNewsLinks.explanation,
          })
          .from(clusterNewsLinks)
          .where(inArray(clusterNewsLinks.clusterId, memberIds))
          .orderBy(desc(clusterNewsLinks.publishedAt))
      : [];
  const newsByCluster = new Map<string, typeof newsRows>();
  for (const n of newsRows) {
    if (!newsByCluster.has(n.clusterId)) newsByCluster.set(n.clusterId, []);
    newsByCluster.get(n.clusterId)!.push(n);
  }

  return NextResponse.json({
    storyline: {
      ...row,
      firstSeenAt: row.firstSeenAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      lensGeneratedAt: row.lensGeneratedAt?.toISOString() ?? null,
    },
    clusters: members.map((m) => ({
      ...m,
      firstSeenAt: m.firstSeenAt.toISOString(),
      lastSeenAt: m.lastSeenAt.toISOString(),
      effectiveClassification: m.analystClassification ?? m.classification,
      isOrigin: m.id === row.originClusterId,
      platforms: platformsByCluster.get(m.id) ?? [],
      newsLinks: (newsByCluster.get(m.id) ?? []).map((n) => ({
        ...n,
        publishedAt: n.publishedAt?.toISOString() ?? null,
      })),
    })),
  });
}
