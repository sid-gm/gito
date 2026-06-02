import { and, eq, inArray, isNull, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ingestedItems, clusters, clusterItems, trackedEntities } from "@/lib/db/schema";
import { analyzeEntitySentiment } from "@/lib/ai/sentiment";
import { updateVelocityAndStage } from "@/lib/ai/cluster-velocity";

const REDDIT_SUBTYPES = ["reddit_post", "reddit_thread", "reddit_comment"] as const;

/**
 * Detects groups of unclustered Reddit items (post/thread + comments) sharing
 * the same thread URL and creates clusters for them, mirroring the manual
 * reddit-thread submission flow. Also handles the case where some items in
 * a URL group are already in a cluster — adding the unclustered remainder to it.
 *
 * Returns the number of thread groups processed.
 */
export async function groupRedditThreadsIntoClusters(): Promise<number> {
  const unclusteredItems = await db
    .select({
      id: ingestedItems.id,
      url: ingestedItems.url,
      title: ingestedItems.title,
      body: ingestedItems.body,
      entityId: ingestedItems.entityId,
      subtype: ingestedItems.subtype,
      publishedAt: ingestedItems.publishedAt,
    })
    .from(ingestedItems)
    .leftJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
    .where(
      and(
        eq(ingestedItems.platform, "reddit"),
        inArray(ingestedItems.subtype, [...REDDIT_SUBTYPES]),
        isNotNull(ingestedItems.url),
        isNull(clusterItems.itemId)
      )
    );

  if (unclusteredItems.length === 0) return 0;

  // Group unclustered items by thread URL
  const byUrl = new Map<string, typeof unclusteredItems>();
  for (const item of unclusteredItems) {
    const url = item.url!;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url)!.push(item);
  }

  let processed = 0;
  const clusterIdsForVelocity = new Set<string>();

  for (const [url, items] of byUrl) {
    const posts = items.filter(
      (i) => i.subtype === "reddit_post" || i.subtype === "reddit_thread"
    );
    const comments = items.filter((i) => i.subtype === "reddit_comment");

    // Require at least one post/thread AND at least one comment
    if (posts.length === 0 || comments.length === 0) continue;

    const allIds = items.map((i) => i.id);
    const postItem = posts[0];
    const entityId =
      postItem.entityId ?? items.find((i) => i.entityId)?.entityId ?? null;

    // Check if any item with this URL is already in a cluster (e.g., from a
    // prior manual submission that created a cluster for some of these items)
    const existingClusterLink = await db
      .select({ clusterId: clusterItems.clusterId })
      .from(ingestedItems)
      .innerJoin(clusterItems, eq(clusterItems.itemId, ingestedItems.id))
      .where(
        and(eq(ingestedItems.platform, "reddit"), eq(ingestedItems.url, url))
      )
      .limit(1)
      .then((rows) => rows[0]?.clusterId ?? null);

    try {
      if (existingClusterLink) {
        // Add unclustered items to the existing cluster
        await db
          .insert(clusterItems)
          .values(
            allIds.map((itemId) => ({
              clusterId: existingClusterLink,
              itemId,
              similarity: 1.0,
            }))
          )
          .onConflictDoNothing();

        await db
          .update(clusters)
          .set({
            itemCount: sql`${clusters.itemCount} + ${allIds.length}`,
            lastSeenAt: new Date(),
          })
          .where(eq(clusters.id, existingClusterLink));

        clusterIdsForVelocity.add(existingClusterLink);
      } else {
        // Create a new cluster for this thread
        const label = (postItem.title ?? url).slice(0, 80);
        const now = postItem.publishedAt ?? new Date();

        const [newCluster] = await db
          .insert(clusters)
          .values({
            entityId,
            label,
            itemCount: allIds.length,
            firstSeenAt: now,
            lastSeenAt: now,
            classification: "unclassified",
          })
          .returning({ id: clusters.id });

        await db
          .insert(clusterItems)
          .values(
            allIds.map((itemId) => ({
              clusterId: newCluster.id,
              itemId,
              similarity: 1.0,
            }))
          )
          .onConflictDoNothing();

        clusterIdsForVelocity.add(newCluster.id);

        if (entityId) {
          try {
            const [entityRow] = await db
              .select({ label: trackedEntities.label })
              .from(trackedEntities)
              .where(eq(trackedEntities.id, entityId))
              .limit(1);

            if (entityRow) {
              const result = await analyzeEntitySentiment({
                entityLabel: entityRow.label,
                clusterLabel: label,
                items: items.map((i) => ({
                  title: i.title,
                  body: i.body,
                  analystNote: null,
                })),
              });

              await db
                .update(clusters)
                .set({
                  sentimentScore: result.score,
                  sentimentLabel: result.sentiment,
                  sentimentAnalyzedAt: new Date(),
                })
                .where(eq(clusters.id, newCluster.id));
            }
          } catch {
            // Non-fatal — cluster still created successfully
          }
        }
      }

      processed++;
    } catch (err) {
      console.error(`[reddit-thread-cluster] url=${url}:`, err);
    }
  }

  if (clusterIdsForVelocity.size > 0) {
    await updateVelocityAndStage([...clusterIdsForVelocity]);
  }

  return processed;
}
