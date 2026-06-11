import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems, trackedEntities } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { analyzeEntitySentiment, withOpFlags } from "@/lib/ai/sentiment";
import { eq, inArray, count } from "drizzle-orm";
import { z } from "zod";

const commentSchema = z.object({
  author: z.string(),
  body: z.string().min(1),
  timestamp: z.string().nullable(),
});

const schema = z.object({
  comments: z.array(commentSchema).min(1).max(500),
  postUrl: z.string().url(),
});

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: clusterId } = await params;
  const body = await req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { comments, postUrl } = parsed.data;

  const [cluster] = await db
    .select({ id: clusters.id, entityId: clusters.entityId })
    .from(clusters)
    .where(eq(clusters.id, clusterId))
    .limit(1);

  if (!cluster) {
    return NextResponse.json({ error: "cluster not found" }, { status: 404 });
  }

  const [opItem] = await db
    .select({ publishedAt: ingestedItems.publishedAt })
    .from(ingestedItems)
    .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(eq(clusterItems.clusterId, clusterId))
    .limit(1);

  const now = new Date();
  const opPublishedAt = opItem?.publishedAt ?? now;

  const commentItems: NewIngestedItem[] = comments.map((c, i) => ({
    platform: "instagram",
    externalId: `${postUrl}#comment-${i}-${c.author}`,
    url: postUrl,
    title: `${c.author}: ${c.body.slice(0, 80)}${c.body.length > 80 ? "…" : ""}`,
    body: c.body,
    author: c.author,
    publishedAt: opPublishedAt,
    entityId: cluster.entityId,
    subtype: "ig_comment",
    rawJson: null,
  }));

  await db
    .insert(ingestedItems)
    .values(commentItems)
    .onConflictDoNothing({ target: [ingestedItems.platform, ingestedItems.externalId] });

  const commentExternalIds = commentItems.map((c) => c.externalId!).filter(Boolean);
  const commentRows = await db
    .select({ id: ingestedItems.id })
    .from(ingestedItems)
    .where(inArray(ingestedItems.externalId, commentExternalIds));

  if (commentRows.length === 0) {
    return NextResponse.json({ inserted: 0, sentimentLabel: null, sentimentScore: null });
  }

  await db
    .insert(clusterItems)
    .values(commentRows.map((r) => ({ clusterId, itemId: r.id, similarity: 1.0 })))
    .onConflictDoNothing();

  const [{ total }] = await db
    .select({ total: count(clusterItems.itemId) })
    .from(clusterItems)
    .where(eq(clusterItems.clusterId, clusterId));

  await db
    .update(clusters)
    .set({ itemCount: total, lastSeenAt: now })
    .where(eq(clusters.id, clusterId));

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
          .select({
            title: ingestedItems.title,
            body: ingestedItems.body,
            author: ingestedItems.author,
            subtype: ingestedItems.subtype,
          })
          .from(ingestedItems)
          .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
          .where(eq(clusterItems.clusterId, clusterId));

        const result = await analyzeEntitySentiment({
          entityLabel: entityRow.label,
          clusterLabel: clusterRow?.label ?? "",
          items: withOpFlags(allItems).map((i) => ({
            title: i.title ?? "",
            body: i.body ?? null,
            analystNote: null,
            author: i.author,
            isOp: i.isOp,
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

  return NextResponse.json({ inserted: commentRows.length, sentimentLabel, sentimentScore });
}
