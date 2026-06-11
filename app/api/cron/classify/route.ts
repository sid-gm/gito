import { NextResponse } from "next/server";
import { and, asc, count, desc, eq, gt, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";
import { classifyCluster, classifyItemSignals } from "@/lib/ai/classify";
import { analyzeEntitySentiment, withOpFlags } from "@/lib/ai/sentiment";
import { scoreItemRows } from "@/lib/ai/item-sentiment";
import { computeNarrativeStage, NEWS_PLATFORMS } from "@/lib/narrative-stage";
import { linkNewsForAllEntities } from "@/lib/ai/link-news";
import { assignClustersToStorylines } from "@/lib/ai/storylines";

export const maxDuration = 300;

const BATCH_SIZE = 15;
// Sentiment is a single cheap LLM call per cluster, so the backfill can chew
// through a larger batch than full classification
const SENTIMENT_BATCH_SIZE = 40;
// Per-item sentiment: forward-only from ship date — older items stay unscored
// unless explicitly backfilled (see /api/run/backfill-item-sentiment)
const ITEM_SENTIMENT_SINCE = new Date("2026-06-11T00:00:00.000Z");
const ITEM_SENTIMENT_BATCH = 120;

export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const now = new Date();
  const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const toClassify = await db
    .select({
      id: clusters.id,
      entityId: clusters.entityId,
      label: clusters.label,
      itemCount: clusters.itemCount,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
      classifiedAt: clusters.classifiedAt,
      classification: clusters.classification,
      peakMomentum: clusters.peakMomentum,
      narrativeStage: clusters.narrativeStage,
      sentimentLabel: clusters.sentimentLabel,
    })
    .from(clusters)
    .where(
      and(
        isNull(clusters.archivedAt),
        gte(clusters.itemCount, 2),
        isNull(clusters.analystClassification)
      )
    )
    // Clusters needing AI classification first, so already-classified clusters
    // (which only get a velocity/stage refresh) can't starve the batch
    .orderBy(
      sql`(${clusters.classification} = 'unclassified' OR ${clusters.classifiedAt} IS NULL OR ${clusters.lastSeenAt} > ${clusters.classifiedAt}) DESC`,
      desc(clusters.lastSeenAt)
    )
    .limit(BATCH_SIZE);

  let classified = 0;
  let stageRefreshed = 0;
  let signalsTagged = 0;

  for (const cluster of toClassify) {
    try {
      // Always recompute velocity + stage so time-based transitions (e.g. emerging → developing)
      // apply even when no new items have arrived since last AI classification.
      const [v24] = await db
        .select({ cnt: count(clusterItems.itemId) })
        .from(clusterItems)
        .where(and(eq(clusterItems.clusterId, cluster.id), gt(clusterItems.addedAt, h24ago)));
      const velocity24h = v24?.cnt ?? 0;

      const [vPrev] = await db
        .select({ cnt: count(clusterItems.itemId) })
        .from(clusterItems)
        .where(
          and(
            eq(clusterItems.clusterId, cluster.id),
            gt(clusterItems.addedAt, h48ago),
            lte(clusterItems.addedAt, h24ago)
          )
        );
      const prevVelocity24h = vPrev?.cnt ?? 0;

      const items = await db
        .select({ title: ingestedItems.title, body: ingestedItems.body, platform: ingestedItems.platform })
        .from(clusterItems)
        .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
        .where(eq(clusterItems.clusterId, cluster.id))
        .limit(5);

      const platforms = [...new Set(items.map((i) => i.platform).filter(Boolean))];
      const nonNewsPlatformCount = platforms.filter((p) => !NEWS_PLATFORMS.includes(p)).length;

      const ageInDays =
        (now.getTime() - new Date(cluster.firstSeenAt).getTime()) / (1000 * 60 * 60 * 24);

      const momentum = (velocity24h + prevVelocity24h) / 2;
      const newPeakMomentum = Math.max(cluster.peakMomentum ?? 0, velocity24h);

      const narrativeStage = computeNarrativeStage({
        velocity24h,
        prevVelocity24h,
        peakMomentum: cluster.peakMomentum,
        ageInDays,
        platformCount: platforms.length,
        nonNewsPlatformCount,
        currentStage: cluster.narrativeStage ?? undefined,
      });

      const needsAIClassify =
        cluster.classification === "unclassified" ||
        !cluster.classifiedAt ||
        cluster.lastSeenAt > cluster.classifiedAt;

      if (!needsAIClassify) {
        // Velocity + stage refresh only — skip the AI call
        await db
          .update(clusters)
          .set({ narrativeStage, velocity24h, prevVelocity24h, momentum, peakMomentum: newPeakMomentum, platformCount: platforms.length })
          .where(eq(clusters.id, cluster.id));
        stageRefreshed++;
        continue;
      }

      const titles = items.map((i) => i.title ?? i.body?.slice(0, 120) ?? "").filter(Boolean);
      if (titles.length === 0) continue;

      const [entity] = cluster.entityId
        ? await db
            .select({ label: trackedEntities.label })
            .from(trackedEntities)
            .where(eq(trackedEntities.id, cluster.entityId))
        : [{ label: "Unknown" }];

      const result = await classifyCluster({
        entityLabel: entity?.label ?? "Unknown",
        clusterLabel: cluster.label,
        itemTitles: titles,
        itemCount: cluster.itemCount,
        ageInDays,
        platformCount: platforms.length,
      });

      let sentimentScore: number | null = null;
      let sentimentLabel: string | null = null;

      if (result.classification === "narrative") {
        const sentimentItems = await db
          .select({
            title: ingestedItems.title,
            body: ingestedItems.body,
            author: ingestedItems.author,
            subtype: ingestedItems.subtype,
          })
          .from(clusterItems)
          .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
          .where(eq(clusterItems.clusterId, cluster.id))
          .orderBy(asc(ingestedItems.createdAt))
          .limit(40);

        const sentimentResult = await analyzeEntitySentiment({
          entityLabel: entity?.label ?? "Unknown",
          clusterLabel: cluster.label,
          items: withOpFlags(sentimentItems).map((i) => ({
            title: i.title,
            body: i.body,
            analystNote: null,
            author: i.author,
            isOp: i.isOp,
          })),
        });
        sentimentScore = sentimentResult.score;
        sentimentLabel = sentimentResult.sentiment;
      }

      await db
        .update(clusters)
        .set({
          classification: result.classification,
          narrativeStage,
          narrativeSummary: result.narrativeSummary,
          momentum,
          peakMomentum: newPeakMomentum,
          velocity24h,
          prevVelocity24h,
          platformCount: platforms.length,
          classifiedAt: now,
          ...(sentimentLabel !== null && {
            sentimentScore,
            sentimentLabel,
            sentimentAnalyzedAt: now,
          }),
        })
        .where(eq(clusters.id, cluster.id));

      classified++;

      if (result.classification === "narrative" && result.narrativeSummary) {
        const untaggedItems = await db
          .select({
            itemId: clusterItems.itemId,
            title: ingestedItems.title,
            body: ingestedItems.body,
            platform: ingestedItems.platform,
          })
          .from(clusterItems)
          .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
          .where(
            and(
              eq(clusterItems.clusterId, cluster.id),
              eq(clusterItems.itemSignal, "unclassified"),
              isNull(clusterItems.analystSignal)
            )
          );

        if (untaggedItems.length > 0) {
          const signalResult = await classifyItemSignals({
            narrativeSummary: result.narrativeSummary,
            items: untaggedItems.map((i) => ({ title: i.title, body: i.body, platform: i.platform })),
          });

          for (const s of signalResult.items) {
            const idx = s.index - 1;
            if (idx < 0 || idx >= untaggedItems.length) continue;
            const item = untaggedItems[idx];
            await db
              .update(clusterItems)
              .set({ itemSignal: s.signal, signalReason: s.reason })
              .where(
                and(
                  eq(clusterItems.clusterId, cluster.id),
                  eq(clusterItems.itemId, item.itemId)
                )
              );
            signalsTagged++;
          }
        }
      }
    } catch (err) {
      console.error(`[cron/classify] cluster ${cluster.id}:`, err);
    }
  }

  // Sentiment backfill: any active cluster still missing sentiment. Timeline
  // sentiment averages every cluster a day's items belong to, so clusters
  // can't wait on a "narrative" classification (or any classification at all)
  let sentimentBackfilled = 0;
  const needsSentiment = await db
    .select({
      id: clusters.id,
      entityId: clusters.entityId,
      label: clusters.label,
    })
    .from(clusters)
    .where(
      and(
        isNull(clusters.archivedAt),
        isNull(clusters.sentimentLabel)
      )
    )
    .orderBy(desc(clusters.lastSeenAt))
    .limit(SENTIMENT_BATCH_SIZE);

  for (const cluster of needsSentiment) {
    try {
      const items = await db
        .select({
          title: ingestedItems.title,
          body: ingestedItems.body,
          author: ingestedItems.author,
          subtype: ingestedItems.subtype,
        })
        .from(clusterItems)
        .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
        .where(eq(clusterItems.clusterId, cluster.id))
        .orderBy(asc(ingestedItems.createdAt))
        .limit(40);

      const titles = items.map((i) => i.title ?? i.body?.slice(0, 120) ?? "").filter(Boolean);
      if (titles.length === 0) continue;

      const [entity] = cluster.entityId
        ? await db
            .select({ label: trackedEntities.label })
            .from(trackedEntities)
            .where(eq(trackedEntities.id, cluster.entityId))
        : [{ label: "Unknown" }];

      const sentimentResult = await analyzeEntitySentiment({
        entityLabel: entity?.label ?? "Unknown",
        clusterLabel: cluster.label,
        items: withOpFlags(items).map((i) => ({
          title: i.title,
          body: i.body,
          analystNote: null,
          author: i.author,
          isOp: i.isOp,
        })),
      });

      await db
        .update(clusters)
        .set({
          sentimentScore: sentimentResult.score,
          sentimentLabel: sentimentResult.sentiment,
          sentimentAnalyzedAt: now,
        })
        .where(eq(clusters.id, cluster.id));

      sentimentBackfilled++;
    } catch (err) {
      console.error(`[cron/classify] sentiment backfill cluster ${cluster.id}:`, err);
    }
  }

  // Per-item sentiment: score newly ingested items (all companies, forward-only)
  let itemsScored = 0;
  try {
    const unscoredItems = await db
      .select({
        id: ingestedItems.id,
        title: ingestedItems.title,
        body: ingestedItems.body,
        author: ingestedItems.author,
        entityLabel: trackedEntities.label,
      })
      .from(ingestedItems)
      .innerJoin(trackedEntities, eq(trackedEntities.id, ingestedItems.entityId))
      .where(
        and(
          isNull(ingestedItems.sentimentAnalyzedAt),
          gte(ingestedItems.createdAt, ITEM_SENTIMENT_SINCE)
        )
      )
      .orderBy(desc(ingestedItems.createdAt))
      .limit(ITEM_SENTIMENT_BATCH);

    if (unscoredItems.length > 0) {
      itemsScored = await scoreItemRows(unscoredItems);
    }
  } catch (err) {
    console.error("[cron/classify] item sentiment:", err);
  }

  // Link the closest related news articles to narrative clusters with new activity
  let newsLinked = 0;
  try {
    const linkResult = await linkNewsForAllEntities();
    newsLinked = linkResult.linksCreated;
  } catch (err) {
    console.error("[cron/classify] news linking:", err);
  }

  // Classification is the admission moment for the storyline (arc) layer
  let storylinesAssigned = 0;
  let storylinesCreated = 0;
  try {
    const storylineResult = await assignClustersToStorylines(15);
    storylinesAssigned = storylineResult.assigned;
    storylinesCreated = storylineResult.created;
  } catch (err) {
    console.error("[cron/classify] storyline assignment:", err);
  }

  return NextResponse.json({
    ok: true,
    classified,
    stageRefreshed,
    signalsTagged,
    sentimentBackfilled,
    itemsScored,
    newsLinked,
    storylinesAssigned,
    storylinesCreated,
  });
}
