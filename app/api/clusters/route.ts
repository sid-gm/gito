import { NextResponse } from "next/server";
import { and, asc, avg, count, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities } from "@/lib/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const entityId = searchParams.get("entityId") ?? undefined;
  const sort = searchParams.get("sort") ?? "activity";
  const hideSingletons = searchParams.get("hideSingletons") === "true";
  const classificationFilter = searchParams.get("classification") ?? "all";
  const analystClassificationFilter = searchParams.get("analystClassification") ?? undefined;

  const baseConditions = [isNull(clusters.archivedAt)];
  if (entityId) baseConditions.push(eq(clusters.entityId, entityId));

  const companyId = searchParams.get("companyId") ?? undefined;
  if (companyId) {
    const entityIds = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
    if (entityIds.length > 0) {
      baseConditions.push(inArray(clusters.entityId, entityIds.map((e) => e.id)));
    } else {
      return NextResponse.json([]);
    }
  }
  if (hideSingletons) baseConditions.push(gte(clusters.itemCount, 2));

  // Analyst classification filter (explicit reviewer decisions)
  if (analystClassificationFilter === "noise") {
    baseConditions.push(eq(clusters.analystClassification, "noise"));
  } else if (analystClassificationFilter === "signal_watch") {
    baseConditions.push(
      or(
        eq(clusters.analystClassification, "signal"),
        eq(clusters.analystClassification, "watch")
      )!
    );
  } else if (analystClassificationFilter === "signal") {
    baseConditions.push(eq(clusters.analystClassification, "signal"));
  } else if (analystClassificationFilter === "watch") {
    baseConditions.push(eq(clusters.analystClassification, "watch"));
  }

  // Effective classification = analystClassification if set, else classification
  if (classificationFilter === "narrative") {
    baseConditions.push(
      or(
        eq(clusters.analystClassification, "narrative"),
        and(
          eq(clusters.classification, "narrative"),
          or(
            isNull(clusters.analystClassification),
            eq(clusters.analystClassification, "signal"),
            eq(clusters.analystClassification, "watch")
          )
        )
      )!
    );
  } else if (classificationFilter === "noise") {
    baseConditions.push(
      or(
        eq(clusters.analystClassification, "noise"),
        and(isNull(clusters.analystClassification), eq(clusters.classification, "noise"))
      )!
    );
  } else if (classificationFilter === "unclassified") {
    baseConditions.push(
      and(isNull(clusters.analystClassification), eq(clusters.classification, "unclassified"))!
    );
  }

  const stagePriority = sql<number>`CASE ${clusters.narrativeStage}
    WHEN 'emerging'   THEN 1
    WHEN 'developing' THEN 2
    WHEN 'revival'    THEN 3
    WHEN 'peaked'     THEN 4
    WHEN 'relaxed'    THEN 5
    WHEN 'declining'  THEN 6
    ELSE 7
  END`;

  const secondarySort =
    sort === "size"     ? desc(clusters.itemCount) :
    sort === "created"  ? desc(clusters.createdAt) :
    sort === "momentum" ? desc(clusters.momentum) :
                          desc(clusters.lastSeenAt);

  const orderBy = [asc(stagePriority), secondarySort];

  const allClusters = await db
    .select({
      id: clusters.id,
      entityId: clusters.entityId,
      label: clusters.label,
      itemCount: clusters.itemCount,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      // Classification fields
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
      sentimentScore: clusters.sentimentScore,
      sentimentLabel: clusters.sentimentLabel,
    })
    .from(clusters)
    .where(and(...baseConditions))
    .orderBy(...orderBy);

  const filtered = allClusters;

  // Stats (no extra filters — always show total picture)
  const statsConditions = [isNull(clusters.archivedAt)];
  if (entityId) statsConditions.push(eq(clusters.entityId, entityId));

  const [clusterStats] = await db
    .select({ total: count(clusters.id), avgSize: avg(clusters.itemCount) })
    .from(clusters)
    .where(and(...statsConditions));

  const [itemStats] = await db
    .select({ totalItems: count(ingestedItems.id) })
    .from(ingestedItems);

  const [clusteredStats] = await db
    .select({ itemsClustered: count(clusterItems.itemId) })
    .from(clusterItems);

  // Fetch all items for visible clusters in one query, then group in memory
  const clusterIds = filtered.map((c) => c.id);
  const allItems =
    clusterIds.length > 0
      ? await db
          .select({
            clusterId: clusterItems.clusterId,
            itemId: ingestedItems.id,
            similarity: clusterItems.similarity,
            itemSignal: clusterItems.itemSignal,
            analystSignal: clusterItems.analystSignal,
            analystNote: clusterItems.analystNote,
            analystFlag: clusterItems.analystFlag,
            title: ingestedItems.title,
            body: ingestedItems.body,
            url: ingestedItems.url,
            externalId: ingestedItems.externalId,
            platform: ingestedItems.platform,
            publishedAt: ingestedItems.publishedAt,
            ingestedAt: ingestedItems.createdAt,
            itemEntityId: ingestedItems.entityId,
          })
          .from(clusterItems)
          .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
          .where(inArray(clusterItems.clusterId, clusterIds))
          .orderBy(desc(clusterItems.similarity))
      : [];

  function dedupeItems<T extends { url: string | null; title: string | null; similarity: number }>(items: T[]): T[] {
    const seen = new Map<string, T>();
    for (const item of items) {
      const key = item.url ?? item.title ?? "";
      if (!key) continue;
      const prev = seen.get(key);
      if (!prev || item.similarity > prev.similarity) seen.set(key, item);
    }
    return [...seen.values()];
  }

  const itemsByCluster = new Map<string, typeof allItems>();
  for (const item of allItems) {
    if (!itemsByCluster.has(item.clusterId)) itemsByCluster.set(item.clusterId, []);
    itemsByCluster.get(item.clusterId)!.push(item);
  }

  const allEntityIds = [...new Set(allItems.map((i) => i.itemEntityId).filter((id): id is string => !!id))];
  const entityRows = allEntityIds.length > 0
    ? await db.select({ id: trackedEntities.id, label: trackedEntities.label }).from(trackedEntities).where(inArray(trackedEntities.id, allEntityIds))
    : [];
  const entityMap = new Map(entityRows.map((e) => [e.id, e.label]));

  const result = filtered.map((cluster) => {
    const items = itemsByCluster.get(cluster.id) ?? [];
    const platforms = [...new Set(items.map((i) => i.platform))];
    const displayable = dedupeItems(items.filter((i) => i.title || i.body || i.url));
    const effectiveClassification = cluster.analystClassification ?? cluster.classification;
    const clusterEntityIds = [...new Set(items.map((i) => i.itemEntityId).filter((id): id is string => !!id))];
    const clusterTrackedEntities = clusterEntityIds.map((id) => ({ id, label: entityMap.get(id) ?? id }));
    return {
      ...cluster,
      effectiveClassification,
      topItems: displayable.slice(0, 3),
      platforms,
      trackedEntities: clusterTrackedEntities,
    };
  });

  try {
    return NextResponse.json({
      clusters: result,
      stats: {
        total: clusterStats?.total ?? 0,
        avgSize: parseFloat((clusterStats?.avgSize ?? "0").toString()).toFixed(1),
        itemsClustered: clusteredStats?.itemsClustered ?? 0,
        totalItems: itemStats?.totalItems ?? 0,
      },
    });
  } catch (err) {
    console.error("[GET /api/clusters]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
