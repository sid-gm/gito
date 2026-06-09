import { and, desc, eq, gte, inArray, isNull, lte, max, or, sql } from "drizzle-orm";
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { db } from "@/lib/db";
import {
  clusters,
  clusterItems,
  clusterNewsLinks,
  ingestedItems,
  rssFeeds,
  trackedEntities,
} from "@/lib/db/schema";

const CLUSTERS_PER_ENTITY = 5;
const NEWS_HEADLINE_LIMIT = 30;
const MIN_CONFIDENCE = 0.6;

export type LinkNewsResult = {
  clustersProcessed: number;
  linksCreated: number;
};

type NewsCandidate = {
  id: string;
  title: string | null;
  url: string | null;
  publishedAt: Date | null;
  createdAt: Date;
};

// Link the closest related news articles to clusters of social discussion.
// News never joins cluster membership — each link carries an explanation of
// why the article relates to the conversation.
export async function linkNewsForEntity(
  entityId: string,
  limit: number = CLUSTERS_PER_ENTITY
): Promise<LinkNewsResult> {
  const entityRow = await db
    .select({ label: trackedEntities.label })
    .from(trackedEntities)
    .where(eq(trackedEntities.id, entityId))
    .then((rows) => rows[0]);
  if (!entityRow) return { clustersProcessed: 0, linksCreated: 0 };

  const narrativeClusters = await db
    .select({
      id: clusters.id,
      label: clusters.label,
      narrativeSummary: clusters.narrativeSummary,
      firstSeenAt: clusters.firstSeenAt,
      lastSeenAt: clusters.lastSeenAt,
    })
    .from(clusters)
    .where(
      and(
        eq(clusters.entityId, entityId),
        isNull(clusters.archivedAt),
        or(eq(clusters.classification, "narrative"), eq(clusters.analystClassification, "narrative"))
      )
    )
    .orderBy(desc(clusters.lastSeenAt));

  if (narrativeClusters.length === 0) return { clustersProcessed: 0, linksCreated: 0 };

  // Many google_alerts items carry only rssFeedId (entityId null) — match through the entity's feeds too
  const feedRows = await db
    .select({ id: rssFeeds.id })
    .from(rssFeeds)
    .where(eq(rssFeeds.entityId, entityId));
  const feedIds = feedRows.map((f) => f.id);
  const newsOwnerFilter =
    feedIds.length > 0
      ? or(eq(ingestedItems.entityId, entityId), inArray(ingestedItems.rssFeedId, feedIds))!
      : eq(ingestedItems.entityId, entityId);

  // Newest link per cluster — only relink clusters with new activity since
  const newestLinks = await db
    .select({
      clusterId: clusterNewsLinks.clusterId,
      newestAt: max(clusterNewsLinks.createdAt),
    })
    .from(clusterNewsLinks)
    .groupBy(clusterNewsLinks.clusterId);
  const newestByCluster = new Map(newestLinks.map((r) => [r.clusterId, r.newestAt]));

  const candidates = narrativeClusters
    .filter((c) => {
      const newest = newestByCluster.get(c.id);
      return !newest || c.lastSeenAt > newest;
    })
    .slice(0, limit);

  let clustersProcessed = 0;
  let linksCreated = 0;

  for (const cluster of candidates) {
    try {
      const windowStart = new Date(cluster.firstSeenAt.getTime() - 3 * 24 * 3600000);
      const windowEnd = new Date(cluster.lastSeenAt.getTime() + 24 * 3600000);
      const effectiveDate = sql`COALESCE(${ingestedItems.publishedAt}, ${ingestedItems.createdAt})`;

      const newsItems: NewsCandidate[] = await db
        .select({
          id: ingestedItems.id,
          title: ingestedItems.title,
          url: ingestedItems.url,
          publishedAt: ingestedItems.publishedAt,
          createdAt: ingestedItems.createdAt,
        })
        .from(ingestedItems)
        .where(
          and(
            newsOwnerFilter,
            eq(ingestedItems.platform, "google_alerts"),
            gte(effectiveDate, windowStart),
            lte(effectiveDate, windowEnd)
          )
        )
        .orderBy(desc(effectiveDate))
        .limit(NEWS_HEADLINE_LIMIT);

      const withTitle = newsItems.filter((n) => n.title?.trim());
      clustersProcessed++;
      if (withTitle.length === 0) continue;

      const samplePosts = await db
        .select({ title: ingestedItems.title, body: ingestedItems.body })
        .from(clusterItems)
        .innerJoin(ingestedItems, eq(clusterItems.itemId, ingestedItems.id))
        .where(eq(clusterItems.clusterId, cluster.id))
        .orderBy(desc(clusterItems.addedAt))
        .limit(5);

      const postList = samplePosts
        .map((p) => {
          const text = [p.title, p.body].filter(Boolean).join(" — ");
          return `- ${text.replace(/\s+/g, " ").slice(0, 200)}`;
        })
        .join("\n");

      const newsList = withTitle
        .map((n, i) => {
          const date = (n.publishedAt ?? n.createdAt).toISOString().split("T")[0];
          return `[${i + 1}] "${n.title!.trim()}" (${date})`;
        })
        .join("\n");

      const prompt = `Cluster of social discussion about "${entityRow.label}": "${cluster.label ?? "(unlabeled)"}"${cluster.narrativeSummary ? ` — ${cluster.narrativeSummary}` : ""}

Sample posts from the discussion:
${postList}

Recent news headlines about ${entityRow.label}:
${newsList}

Which headlines relate to this discussion? For each related headline, classify the relationship:
- "driving": the discussion is reacting to this news
- "related": tangential context for the discussion
And give a one-line explanation of the connection.
Only include genuinely related headlines — leave out generic mentions.

Respond ONLY with valid JSON:
{"links":[{"news":1,"relationship":"driving","explanation":"...","confidence":0.9}]}`;

      const { text } = await generateText({
        model: openai("gpt-4o-mini"),
        prompt,
        maxOutputTokens: 500,
      });

      const raw = text.trim().replace(/```json\n?|\n?```/g, "").trim();
      const parsed = JSON.parse(raw) as {
        links: { news: number; relationship: string; explanation?: string; confidence?: number }[];
      };
      if (!Array.isArray(parsed.links)) continue;

      const existing = await db
        .select({ url: clusterNewsLinks.url, headline: clusterNewsLinks.headline })
        .from(clusterNewsLinks)
        .where(eq(clusterNewsLinks.clusterId, cluster.id));
      const seen = new Set(existing.map((l) => l.url ?? l.headline));

      for (const link of parsed.links) {
        const news = withTitle[link.news - 1];
        if (!news) continue;
        if ((link.confidence ?? 0) < MIN_CONFIDENCE) continue;
        const dedupeKey = news.url ?? news.title!.trim();
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        await db.insert(clusterNewsLinks).values({
          clusterId: cluster.id,
          newsItemId: news.id,
          headline: news.title!.trim(),
          url: news.url,
          publishedAt: news.publishedAt ?? news.createdAt,
          relationship: link.relationship === "driving" ? "driving" : "related",
          explanation: link.explanation ?? null,
          confidence: link.confidence ?? null,
        });
        linksCreated++;
      }
    } catch (err) {
      console.error(`[link-news] cluster ${cluster.id}:`, err);
    }
  }

  return { clustersProcessed, linksCreated };
}

// Run news linking for every entity that has active narrative clusters.
export async function linkNewsForAllEntities(
  perEntityLimit: number = CLUSTERS_PER_ENTITY
): Promise<LinkNewsResult> {
  const entityRows = await db
    .selectDistinct({ entityId: clusters.entityId })
    .from(clusters)
    .where(
      and(
        isNull(clusters.archivedAt),
        or(eq(clusters.classification, "narrative"), eq(clusters.analystClassification, "narrative"))
      )
    );

  let clustersProcessed = 0;
  let linksCreated = 0;
  for (const row of entityRows) {
    if (!row.entityId) continue;
    const result = await linkNewsForEntity(row.entityId, perEntityLimit);
    clustersProcessed += result.clustersProcessed;
    linksCreated += result.linksCreated;
  }
  return { clustersProcessed, linksCreated };
}
