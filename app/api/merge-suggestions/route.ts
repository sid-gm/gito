import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterMergeSuggestions, trackedEntities } from "@/lib/db/schema";

export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get("companyId");
  const entityId = req.nextUrl.searchParams.get("entityId");

  const conditions = [eq(clusterMergeSuggestions.status, "pending")];
  if (entityId) {
    conditions.push(eq(clusterMergeSuggestions.entityId, entityId));
  } else if (companyId) {
    const entityRows = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
    if (entityRows.length === 0) return NextResponse.json({ suggestions: [] });
    conditions.push(inArray(clusterMergeSuggestions.entityId, entityRows.map((e) => e.id)));
  }

  const rows = await db
    .select()
    .from(clusterMergeSuggestions)
    .where(and(...conditions))
    .orderBy(desc(clusterMergeSuggestions.confidence), desc(clusterMergeSuggestions.createdAt));

  if (rows.length === 0) return NextResponse.json({ suggestions: [] });

  const allClusterIds = [...new Set(rows.flatMap((r) => r.clusterIds))];
  const liveClusters = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      itemCount: clusters.itemCount,
      lastSeenAt: clusters.lastSeenAt,
      classification: clusters.classification,
      analystClassification: clusters.analystClassification,
    })
    .from(clusters)
    .where(and(inArray(clusters.id, allClusterIds), isNull(clusters.archivedAt)));
  const liveById = new Map(liveClusters.map((c) => [c.id, c]));

  const suggestions = [];
  for (const row of rows) {
    const members = row.clusterIds
      .map((id) => liveById.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    // A suggestion is only actionable while all its clusters are still live
    if (members.length < 2 || members.length !== row.clusterIds.length) {
      await db
        .update(clusterMergeSuggestions)
        .set({ status: "stale", resolvedAt: new Date() })
        .where(eq(clusterMergeSuggestions.id, row.id));
      continue;
    }

    suggestions.push({
      id: row.id,
      entityId: row.entityId,
      suggestedLabel: row.suggestedLabel,
      confidence: row.confidence,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
      clusters: members.map((c) => ({
        id: c.id,
        label: c.label,
        itemCount: c.itemCount,
        effectiveClassification: c.analystClassification ?? c.classification,
      })),
    });
  }

  return NextResponse.json({ suggestions });
}
