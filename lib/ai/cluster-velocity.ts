import { and, count, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { clusters, clusterItems, ingestedItems } from "@/lib/db/schema";
import { computeNarrativeStage, NEWS_PLATFORMS } from "@/lib/narrative-stage";

export async function updateVelocityAndStage(clusterIds: string[]) {
  if (clusterIds.length === 0) return;

  const now = new Date();
  const h24ago = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const h48ago = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const clusterRows = await db
    .select({
      id: clusters.id,
      firstSeenAt: clusters.firstSeenAt,
      peakMomentum: clusters.peakMomentum,
      narrativeStage: clusters.narrativeStage,
    })
    .from(clusters)
    .where(inArray(clusters.id, clusterIds));

  for (const cluster of clusterRows) {
    try {
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

      const platformRows = await db
        .select({ platform: sql<string>`DISTINCT ${ingestedItems.platform}` })
        .from(clusterItems)
        .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
        .where(eq(clusterItems.clusterId, cluster.id));

      const platforms = [...new Set(platformRows.map((r) => r.platform).filter(Boolean))];
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

      await db
        .update(clusters)
        .set({
          velocity24h,
          prevVelocity24h,
          momentum,
          peakMomentum: newPeakMomentum,
          platformCount: platforms.length,
          narrativeStage,
        })
        .where(eq(clusters.id, cluster.id));
    } catch (err) {
      console.error(`[cluster/velocity] cluster ${cluster.id}:`, err);
    }
  }
}
