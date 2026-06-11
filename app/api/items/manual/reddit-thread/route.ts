import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems, trackedEntities } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { analyzeEntitySentiment } from "@/lib/ai/sentiment";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

const commentSchema = z.object({
  author: z.string(),
  body: z.string().min(1),
  score: z.number().optional(),
  timestamp: z.string().optional(),
});

const schema = z.object({
  threadUrl: z.string().url(),
  title: z.string().min(1),
  body: z.string().optional(),
  author: z.string().optional(),
  publishedAt: z.string().optional(),
  entityId: z.string().uuid().optional(),
  companyId: z.string().uuid().optional(),
  comments: z.array(commentSchema).min(1).max(500),
});

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const {
    threadUrl, title, body: threadBody, author, publishedAt,
    entityId, companyId, comments,
  } = parsed.data;

  const now = new Date();
  const safeDate = (s: string | undefined): Date => {
    if (!s) return now;
    const d = new Date(s);
    return isNaN(d.getTime()) ? now : d;
  };

  // Resolve entityId from companyId keyword match if not explicitly provided
  let resolvedEntityId: string | null = entityId ?? null;
  if (!resolvedEntityId && companyId) {
    const allEntities = await db
      .select({ id: trackedEntities.id, label: trackedEntities.label })
      .from(trackedEntities)
      .where(eq(trackedEntities.companyId, companyId));
    const titleLower = title.toLowerCase();
    const bodyLower = (threadBody ?? "").toLowerCase();
    const match = allEntities.find(
      (e) => titleLower.includes(e.label.toLowerCase()) || bodyLower.includes(e.label.toLowerCase())
    );
    resolvedEntityId = match?.id ?? null;
  }

  // Insert thread post item
  const threadItem: NewIngestedItem = {
    platform: "reddit",
    externalId: threadUrl,
    url: threadUrl,
    title,
    body: threadBody ?? null,
    author: author ?? null,
    publishedAt: safeDate(publishedAt),
    entityId: resolvedEntityId,
    subtype: "reddit_thread",
    rawJson: null,
  };

  const [threadRow] = await db
    .insert(ingestedItems)
    .values(threadItem)
    .onConflictDoNothing({ target: [ingestedItems.platform, ingestedItems.externalId] })
    .returning({ id: ingestedItems.id });

  let threadItemId: string | null = threadRow?.id ?? null;
  if (!threadItemId) {
    const [existing] = await db
      .select({ id: ingestedItems.id })
      .from(ingestedItems)
      .where(eq(ingestedItems.externalId, threadUrl))
      .limit(1);
    threadItemId = existing?.id ?? null;
  }

  // Insert comment items
  const commentItems: NewIngestedItem[] = comments.map((c, i) => ({
    platform: "reddit",
    externalId: `${threadUrl}#comment-${i}-${c.author}`,
    url: threadUrl,
    title: `${c.author}: ${c.body.slice(0, 80)}${c.body.length > 80 ? "…" : ""}`,
    body: c.body,
    author: c.author,
    publishedAt: safeDate(c.timestamp),
    entityId: resolvedEntityId,
    subtype: "reddit_comment",
    rawJson: c.score !== undefined ? { score: c.score } : null,
  }));

  await db
    .insert(ingestedItems)
    .values(commentItems)
    .onConflictDoNothing({ target: [ingestedItems.platform, ingestedItems.externalId] });

  // Fetch all inserted comment IDs (handles pre-existing dedup)
  const commentExternalIds = commentItems.map((c) => c.externalId!).filter(Boolean);
  const commentRows = await db
    .select({ id: ingestedItems.id })
    .from(ingestedItems)
    .where(inArray(ingestedItems.externalId, commentExternalIds));

  const allItemIds = [
    ...(threadItemId ? [threadItemId] : []),
    ...commentRows.map((r) => r.id),
  ];

  if (allItemIds.length === 0) {
    return NextResponse.json({ error: "no items inserted" }, { status: 422 });
  }

  // Create cluster for this thread
  const clusterLabel = title.slice(0, 80);
  const [newCluster] = await db
    .insert(clusters)
    .values({
      entityId: resolvedEntityId,
      label: clusterLabel,
      itemCount: allItemIds.length,
      firstSeenAt: now,
      lastSeenAt: now,
      classification: "unclassified",
    })
    .returning({ id: clusters.id });

  const clusterId = newCluster.id;

  // Link all items to cluster
  await db
    .insert(clusterItems)
    .values(allItemIds.map((itemId) => ({ clusterId, itemId, similarity: 1.0 })))
    .onConflictDoNothing();

  // Run sentiment analysis if we have an entity
  let sentimentLabel: string | null = null;
  let sentimentScore: number | null = null;

  if (resolvedEntityId) {
    try {
      const [entityRow] = await db
        .select({ label: trackedEntities.label })
        .from(trackedEntities)
        .where(eq(trackedEntities.id, resolvedEntityId))
        .limit(1);

      if (entityRow) {
        const opAuthor = author ?? null;
        const result = await analyzeEntitySentiment({
          entityLabel: entityRow.label,
          clusterLabel,
          items: [
            {
              title,
              body: threadBody ?? null,
              analystNote: null,
              author: opAuthor,
              isOp: true,
            },
            ...comments.map((c) => ({
              title: `${c.author}: ${c.body.slice(0, 80)}`,
              body: c.body,
              analystNote: null,
              author: c.author,
              isOp: opAuthor != null && c.author === opAuthor,
            })),
          ],
        });

        await db
          .update(clusters)
          .set({
            sentimentScore: result.score,
            sentimentLabel: result.sentiment,
            sentimentAnalyzedAt: now,
          })
          .where(eq(clusters.id, clusterId));

        sentimentLabel = result.sentiment;
        sentimentScore = result.score;
      }
    } catch {
      // Non-fatal — cluster still created successfully
    }
  }

  return NextResponse.json({ clusterId, inserted: allItemIds.length, sentimentLabel, sentimentScore });
}
