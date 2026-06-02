import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestedItems, trackedEntities } from "@/lib/db/schema";
import { desc, eq, and, inArray, SQL } from "drizzle-orm";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const platform = searchParams.get("platform");
  const entityId = searchParams.get("entityId");
  const companyId = searchParams.get("companyId");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 500);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const conditions: SQL[] = [];
  if (platform) conditions.push(eq(ingestedItems.platform, platform as never));
  if (entityId) conditions.push(eq(ingestedItems.entityId, entityId));
  if (companyId) {
    const entityIds = await db
      .select({ id: trackedEntities.id })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
    conditions.push(inArray(ingestedItems.entityId, entityIds.map((e) => e.id)));
  }

  const items = await db
    .select({
      id: ingestedItems.id,
      entityId: ingestedItems.entityId,
      entityLabel: trackedEntities.label,
      platform: ingestedItems.platform,
      externalId: ingestedItems.externalId,
      url: ingestedItems.url,
      title: ingestedItems.title,
      body: ingestedItems.body,
      author: ingestedItems.author,
      publishedAt: ingestedItems.publishedAt,
      subtype: ingestedItems.subtype,
      createdAt: ingestedItems.createdAt,
    })
    .from(ingestedItems)
    .leftJoin(trackedEntities, eq(ingestedItems.entityId, trackedEntities.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(ingestedItems.publishedAt))
    .limit(limit)
    .offset(offset);

  // Bulk-check which reddit_post URLs already have ingested comments
  const redditPostUrls = items
    .filter((i) => i.platform === "reddit" && i.subtype === "reddit_post" && i.url)
    .map((i) => i.url as string);

  const ingestedThreadUrlSet = new Set<string>();
  if (redditPostUrls.length > 0) {
    const rows = await db
      .selectDistinct({ url: ingestedItems.url })
      .from(ingestedItems)
      .where(and(eq(ingestedItems.subtype, "reddit_comment"), inArray(ingestedItems.url, redditPostUrls)));
    for (const r of rows) {
      if (r.url) ingestedThreadUrlSet.add(r.url);
    }
  }

  const result = items.map((i) => ({
    ...i,
    threadIngested:
      i.platform === "reddit" && i.subtype === "reddit_post"
        ? ingestedThreadUrlSet.has(i.url ?? "")
        : false,
  }));

  return NextResponse.json(result);
}
