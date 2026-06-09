import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { trackedEntities, ingestedItems, clusters, clusterItems } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { verifyExtensionKey } from "@/lib/extension-auth";
import { eq, inArray, and } from "drizzle-orm";
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
  body: z.string().nullish(),
  author: z.string().nullish(),
  publishedAt: z.string().nullish(),
  platform: z.enum(["twitter", "reddit", "instagram", "threads", "manual"]),
  subtype: z.string().nullish(),
  externalId: z.string().nullish(),
  parentExternalId: z.string().nullish(),
  rootExternalId: z.string().nullish(),
});

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
  entityId: z.string().uuid().optional(),
  collectRunId: z.string().uuid().optional(),
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

  const { items, entityId, collectRunId } = parsed.data;

  let entities: { id: string; label: string }[] = [];
  if (!entityId) {
    entities = await db
      .select({ id: trackedEntities.id, label: trackedEntities.label })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
  }

  const now = new Date();
  const safeDate = (s: string | null | undefined): Date => {
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
      collectRunId: collectRunId ?? null,
    };
  });

  // Insert all items
  const insertedRows = await db
    .insert(ingestedItems)
    .values(toInsert)
    .onConflictDoNothing({ target: [ingestedItems.platform, ingestedItems.externalId] })
    .returning({ id: ingestedItems.id });

  const insertedCount = insertedRows.length;

  // Resolve parentId / rootPostId for items that supplied parentExternalId / rootExternalId
  const itemsWithParent = items.filter((i) => i.parentExternalId || i.rootExternalId);
  if (itemsWithParent.length > 0) {
    const toResolve = [...new Set([
      ...itemsWithParent.map((i) => i.externalId).filter(Boolean),
      ...itemsWithParent.map((i) => i.parentExternalId).filter(Boolean),
      ...itemsWithParent.map((i) => i.rootExternalId).filter(Boolean),
    ])] as string[];

    const resolved = toResolve.length > 0
      ? await db
          .select({ id: ingestedItems.id, externalId: ingestedItems.externalId })
          .from(ingestedItems)
          .where(inArray(ingestedItems.externalId, toResolve))
      : [];

    const eidToId = new Map(resolved.map((r) => [r.externalId!, r.id]));

    for (const item of itemsWithParent) {
      if (!item.externalId) continue;
      const itemId = eidToId.get(item.externalId);
      if (!itemId) continue;
      const parentId = item.parentExternalId ? (eidToId.get(item.parentExternalId) ?? null) : null;
      const rootPostId = item.rootExternalId ? (eidToId.get(item.rootExternalId) ?? null) : null;
      if (parentId || rootPostId) {
        await db
          .update(ingestedItems)
          .set({ ...(parentId ? { parentId } : {}), ...(rootPostId ? { rootPostId } : {}) })
          .where(and(eq(ingestedItems.id, itemId)));
      }
    }
  }

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
