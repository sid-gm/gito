import { NextResponse } from "next/server";
import { and, count, desc, eq, gte, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { trackedEntities, ingestedItems, clusterItems, clusters } from "@/lib/db/schema";

const VALID_PLATFORMS = [
  "hackernews", "reddit", "twitter", "google_alerts", "manual", "threads", "instagram", "facebook",
] as const;
type ValidPlatform = typeof VALID_PLATFORMS[number];

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const companyId = searchParams.get("companyId");
  const platform = searchParams.get("platform");
  const date = searchParams.get("date");

  if (!companyId || !platform || !date) {
    return NextResponse.json({ error: "companyId, platform, and date are required" }, { status: 400 });
  }

  if (!VALID_PLATFORMS.includes(platform as ValidPlatform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const dayStart = new Date(`${date}T00:00:00.000Z`);
  const dayEnd = new Date(`${date}T23:59:59.999Z`);
  const typedPlatform = platform as ValidPlatform;

  const [clusterRows, itemRows] = await Promise.all([
    db
      .select({
        id: clusters.id,
        label: clusters.label,
        sentimentScore: clusters.sentimentScore,
        sentimentLabel: clusters.sentimentLabel,
        itemCount: count(ingestedItems.id),
      })
      .from(clusters)
      .innerJoin(clusterItems, eq(clusterItems.clusterId, clusters.id))
      .innerJoin(ingestedItems, eq(ingestedItems.id, clusterItems.itemId))
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .where(
        and(
          eq(trackedEntities.companyId, companyId),
          eq(ingestedItems.platform, typedPlatform),
          gte(ingestedItems.publishedAt, dayStart),
          lt(ingestedItems.publishedAt, dayEnd)
        )
      )
      .groupBy(clusters.id)
      .orderBy(desc(count(ingestedItems.id)))
      .limit(5),

    db
      .select({
        id: ingestedItems.id,
        title: ingestedItems.title,
        body: ingestedItems.body,
        url: ingestedItems.url,
        publishedAt: ingestedItems.publishedAt,
        author: ingestedItems.author,
      })
      .from(ingestedItems)
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .where(
        and(
          eq(trackedEntities.companyId, companyId),
          eq(ingestedItems.platform, typedPlatform),
          gte(ingestedItems.publishedAt, dayStart),
          lt(ingestedItems.publishedAt, dayEnd)
        )
      )
      .orderBy(desc(ingestedItems.publishedAt))
      .limit(20),
  ]);

  return NextResponse.json({
    clusters: clusterRows.map((c) => ({
      ...c,
      itemCount: Number(c.itemCount),
    })),
    items: itemRows.map((it) => ({
      ...it,
      publishedAt: it.publishedAt?.toISOString() ?? null,
    })),
  });
}
