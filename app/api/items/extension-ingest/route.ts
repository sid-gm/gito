import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedEntities, ingestedItems, clusters, clusterItems } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

const itemSchema = z.object({
  url: z.string(),
  title: z.string().min(1),
  body: z.string().optional(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  platform: z.enum(["twitter", "reddit", "instagram", "threads", "manual"]),
  subtype: z.string().optional(),
  externalId: z.string().optional(),
});

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
  entityId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const companyId = await verifyExtensionKey(req);
  if (!companyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400, headers: CORS });
  }

  const { items, entityId } = parsed.data;

  let entities: { id: string; label: string }[] = [];
  if (!entityId) {
    entities = await db
      .select({ id: trackedEntities.id, label: trackedEntities.label })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
  }

  const now = new Date();
  const safeDate = (s: string | undefined): Date => {
    if (!s) return now;
    const d = new Date(s);
    return isNaN(d.getTime()) ? now : d;
  };

  const toInsert: NewIngestedItem[] = items.map((item) => {
    let matchedEntityId: string | null = entityId ?? null;
    if (!matchedEntityId && entities.length > 0) {
      const titleLower = item.title.toLowerCase();
      const bodyLower = (item.body ?? "").toLowerCase();
      const match = entities.find(
        (e) => titleLower.includes(e.label.toLowerCase()) || bodyLower.includes(e.label.toLowerCase())
      );
      matchedEntityId = match?.id ?? null;
    }

    return {
      platform: item.platform,
      externalId: item.externalId ?? null,
      url: item.url,
      title: item.title,
      body: item.body ?? null,
      author: item.author ?? null,
      publishedAt: safeDate(item.publishedAt),
      entityId: matchedEntityId,
      subtype: item.subtype ?? null,
      rawJson: null,
    };
  });

  // Insert all items
  const insertedRows = await db
    .insert(ingestedItems)
    .values(toInsert)
    .onConflictDoNothing({ target: [ingestedItems.platform, ingestedItems.externalId] })
    .returning({ id: ingestedItems.id });

  const insertedCount = insertedRows.length;

  // Cluster Twitter threads (x_post + x_reply) and Reddit threads (reddit_post + reddit_comment/reddit_reply)
  const isTwitterThread = items.some((i) => i.subtype === "x_post") && items.some((i) => i.subtype === "x_reply");
  const isRedditThread =
    items.some((i) => i.subtype === "reddit_post") &&
    items.some((i) => i.subtype === "reddit_comment" || i.subtype === "reddit_reply");

  if (isTwitterThread || isRedditThread) {
    // Resolve IDs for all items in the batch (including pre-existing duplicates).
    const externalIds = toInsert.map((i) => i.externalId).filter((id): id is string => !!id);
    const resolvedRows = externalIds.length > 0
      ? await db
          .select({ id: ingestedItems.id })
          .from(ingestedItems)
          .where(inArray(ingestedItems.externalId, externalIds))
      : [];

    // Fall back to the freshly inserted IDs for items that had no externalId.
    const resolvedIds = new Set([
      ...resolvedRows.map((r) => r.id),
      ...insertedRows.map((r) => r.id),
    ]);

    if (resolvedIds.size > 0) {
      const post = items.find((i) => i.subtype === "x_post" || i.subtype === "reddit_post");
      const defaultLabel = isRedditThread ? "Reddit thread" : "Twitter thread";
      const clusterLabel = (post?.title ?? post?.body ?? defaultLabel).slice(0, 80);
      const resolvedEntityId = toInsert.find((i) => i.entityId)?.entityId ?? null;

      const [newCluster] = await db
        .insert(clusters)
        .values({
          entityId: resolvedEntityId,
          label: clusterLabel,
          itemCount: resolvedIds.size,
          firstSeenAt: now,
          lastSeenAt: now,
          classification: "unclassified",
        })
        .returning({ id: clusters.id });

      await db
        .insert(clusterItems)
        .values([...resolvedIds].map((itemId) => ({ clusterId: newCluster.id, itemId, similarity: 1.0 })))
        .onConflictDoNothing();
    }
  }

  return NextResponse.json({ inserted: insertedCount, skipped: items.length - insertedCount }, { headers: CORS });
}
