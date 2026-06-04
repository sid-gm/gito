import { NextResponse } from "next/server";
import { and, desc, eq, inArray, isNotNull, isNull, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, trackedEntities } from "@/lib/db/schema";

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
    return NextResponse.json({ narratives: [] });
  }

  const entityIds = entityRows.map((e) => e.id);

  const rows = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      narrativeStage: clusters.narrativeStage,
      narrativeSummary: clusters.narrativeSummary,
      momentum: clusters.momentum,
      velocity24h: clusters.velocity24h,
      sentimentLabel: clusters.sentimentLabel,
      sentimentScore: clusters.sentimentScore,
      itemCount: clusters.itemCount,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      platformCount: clusters.platformCount,
    })
    .from(clusters)
    .where(
      and(
        isNull(clusters.archivedAt),
        inArray(clusters.entityId, entityIds),
        isNotNull(clusters.narrativeStage),
        or(
          eq(clusters.classification, "narrative"),
          eq(clusters.analystClassification as any, "narrative")
        )
      )
    )
    .orderBy(desc(clusters.momentum))
    .limit(10);

  const narratives = rows.map((c) => ({
    id: c.id,
    label: c.label ?? "",
    narrativeStage: c.narrativeStage,
    narrativeSummary: c.narrativeSummary ?? null,
    momentum: c.momentum ?? null,
    velocity24h: c.velocity24h ?? null,
    sentimentLabel: c.sentimentLabel ?? null,
    sentimentScore: c.sentimentScore ?? null,
    itemCount: c.itemCount,
    firstSeenAt: c.firstSeenAt.toISOString(),
    lastSeenAt: c.lastSeenAt.toISOString(),
    platformCount: c.platformCount ?? null,
  }));

  return NextResponse.json({ narratives });
}
