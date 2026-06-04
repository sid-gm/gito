import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities } from "@/lib/db/schema";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");

  if (!companyId) {
    return NextResponse.json({ error: "companyId required" }, { status: 400 });
  }

  const entityRows = await db
    .select({ id: trackedEntities.id })
    .from(trackedEntities)
    .where(eq(trackedEntities.companyId, companyId));

  if (entityRows.length === 0) {
    return NextResponse.json({ briefs: [] });
  }

  const entityIds = entityRows.map((e) => e.id);

  const clusterRows = await db
    .select({ id: clusters.id })
    .from(clusters)
    .where(and(isNull(clusters.archivedAt), inArray(clusters.entityId, entityIds)));

  if (clusterRows.length === 0) {
    return NextResponse.json({ briefs: [] });
  }

  const clusterIds = clusterRows.map((c) => c.id);
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: clusterItems.itemId,
      title: ingestedItems.title,
      url: ingestedItems.url,
      platform: ingestedItems.platform,
      publishedAt: ingestedItems.publishedAt,
      author: ingestedItems.author,
      clusterLabel: clusters.label,
      narrativeStage: clusters.narrativeStage,
    })
    .from(clusterItems)
    .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
    .innerJoin(clusters, eq(clusterItems.clusterId, clusters.id))
    .where(
      and(
        inArray(clusterItems.clusterId, clusterIds),
        eq(clusterItems.itemSignal, "signal"),
        gte(ingestedItems.publishedAt, since)
      )
    )
    .orderBy(desc(ingestedItems.publishedAt))
    .limit(20);

  const briefs = rows.map((r) => ({
    id: r.id,
    title: r.title ?? "(no title)",
    url: r.url ?? null,
    platform: r.platform,
    publishedAt: r.publishedAt?.toISOString() ?? null,
    author: r.author ?? null,
    clusterLabel: r.clusterLabel ?? null,
    narrativeStage: r.narrativeStage ?? null,
  }));

  return NextResponse.json({ briefs });
}
