import { NextResponse } from "next/server";
import { and, count, eq, gt, gte, isNull, lte } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems, trackedEntities } from "@/lib/db/schema";
import { verifyCronSecret } from "@/lib/cron-auth";
import { classifyCluster, classifyItemSignals } from "@/lib/ai/classify";
import { analyzeEntitySentiment } from "@/lib/ai/sentiment";
import { computeNarrativeStage, NEWS_PLATFORMS } from "@/lib/narrative-stage";

const BATCH_SIZE = 15;

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
        cluster.lastSeenAt > cluster.classifiedAt ||
        (cluster.classification === "narrative" && !cluster.sentimentLabel);

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
        const sentimentResult = await analyzeEntitySentiment({
          entityLabel: entity?.label ?? "Unknown",
          clusterLabel: cluster.label,
          itemTitles: titles,
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

  return NextResponse.json({ ok: true, classified, stageRefreshed, signalsTagged });
}
