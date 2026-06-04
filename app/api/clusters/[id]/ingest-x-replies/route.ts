import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems, trackedEntities } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { analyzeEntitySentiment } from "@/lib/ai/sentiment";
import { eq, inArray, count } from "drizzle-orm";
import { z } from "zod";

const tweetSchema = z.object({
  author: z.string(),
  displayName: z.string(),
  body: z.string().min(1),
  tweetUrl: z.string().nullable(),
  timestamp: z.string().nullable(),
  isOriginalPost: z.boolean(),
});

const schema = z.object({
  tweets: z.array(tweetSchema).min(1).max(500),
  threadUrl: z.string().url(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { tweets, threadUrl } = parsed.data;

  // Fetch the cluster and its existing OP item's publishedAt
  const [cluster] = await db
    .select({ id: clusters.id, entityId: clusters.entityId })
    .from(clusters)
    .where(eq(clusters.id, clusterId))
    .limit(1);

  if (!cluster) {
    return NextResponse.json({ error: "cluster not found" }, { status: 404 });
  }

  // Get the OP item's publishedAt to use for all reply items
  const [opItem] = await db
    .select({ publishedAt: ingestedItems.publishedAt })
    .from(ingestedItems)
    .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, clusterId))
    .limit(1);

  const now = new Date();
  const opPublishedAt = opItem?.publishedAt ?? now;

  // Only insert reply tweets (OP already exists in the cluster)
  const replies = tweets.filter((t) => !t.isOriginalPost);
  if (replies.length === 0) {
    return NextResponse.json({ inserted: 0, sentimentLabel: null, sentimentScore: null });
  }

  const replyItems: NewIngestedItem[] = replies.map((t, i) => ({
    platform: "twitter",
    externalId: `${threadUrl}#reply-${i}-${t.author}`,
    url: t.tweetUrl ?? threadUrl,
    title: `${t.author}: ${t.body.slice(0, 80)}${t.body.length > 80 ? "…" : ""}`,
    body: t.body,
    author: t.author,
    publishedAt: opPublishedAt,
    entityId: cluster.entityId,
    subtype: "x_reply",
    rawJson: null,
  }));

  await db
    .insert(ingestedItems)
    .values(replyItems)
    .onConflictDoNothing({ target: [ingestedItems.platform, ingestedItems.externalId] });

  const replyExternalIds = replyItems.map((r) => r.externalId!).filter(Boolean);
  const replyRows = await db
    .select({ id: ingestedItems.id })
    .from(ingestedItems)
    .where(inArray(ingestedItems.externalId, replyExternalIds));

  if (replyRows.length === 0) {
    return NextResponse.json({ inserted: 0, sentimentLabel: null, sentimentScore: null });
  }

  await db
    .insert(clusterItems)
    .values(replyRows.map((r) => ({ clusterId, itemId: r.id, similarity: 1.0 })))
    .onConflictDoNothing();

  // Recount and update the cluster
  const [{ total }] = await db
    .select({ total: count(clusterItems.itemId) })
    .from(clusterItems)
    .where(eq(clusterItems.clusterId, clusterId));

  await db
    .update(clusters)
    .set({ itemCount: total, lastSeenAt: now })
    .where(eq(clusters.id, clusterId));

  // Re-run sentiment if cluster has an entity
  let sentimentLabel: string | null = null;
  let sentimentScore: number | null = null;

  if (cluster.entityId) {
    try {
      const [entityRow] = await db
        .select({ label: trackedEntities.label })
        .from(trackedEntities)
        .where(eq(trackedEntities.id, cluster.entityId))
        .limit(1);

      const [clusterRow] = await db
        .select({ label: clusters.label })
        .from(clusters)
        .where(eq(clusters.id, clusterId))
        .limit(1);

      if (entityRow) {
        const allItems = await db
          .select({ title: ingestedItems.title, body: ingestedItems.body })
          .from(ingestedItems)
          .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
          .where(eq(clusterItems.clusterId, clusterId));

        const result = await analyzeEntitySentiment({
          entityLabel: entityRow.label,
          clusterLabel: clusterRow?.label ?? "",
          items: allItems.map((i) => ({
            title: i.title ?? "",
            body: i.body ?? null,
            analystNote: null,
          })),
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
      // Non-fatal
    }
  }

  return NextResponse.json({ inserted: replyRows.length, sentimentLabel, sentimentScore });
}
