import { db } from "@/lib/db";
import { redditSubreddits, trackedEntities } from "@/lib/db/schema";
import type { NewIngestedItem } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { collectSubredditRss } from "./reddit-rss";
import { upsertItems } from "./ingest";

export async function collectAndIngestRedditRss(companyId: string): Promise<number> {
  const subreddits = await db
    .select()
    .from(redditSubreddits)
    .where(eq(redditSubreddits.companyId, companyId));

  if (subreddits.length === 0) return 0;

  const entities = await db
    .select()
    .from(trackedEntities)
    .where(eq(trackedEntities.companyId, companyId));

  let total = 0;

  for (const sub of subreddits) {
    try {
      const posts = await collectSubredditRss(sub.subredditName, sub.keywordFilters ?? []);

      const items: NewIngestedItem[] = posts.map((post) => {
        const text = `${post.title} ${post.body ?? ""}`.toLowerCase();
        const matchingEntity = entities.find((e) =>
          text.includes(e.label.toLowerCase())
        );

        return {
          platform: "reddit" as const,
          externalId: post.post_id,
          url: post.permalink,
          title: post.title,
          body: post.body,
          author: post.author,
          publishedAt: new Date(post.published_iso),
          entityId: matchingEntity?.id ?? null,
          subtype: "reddit_post",
          rawJson: { subreddit: post.subreddit, keywordFilters: sub.keywordFilters },
        };
      });

      const inserted = await upsertItems(items);
      total += inserted;
    } catch (err) {
      console.error(`[Reddit RSS] r/${sub.subredditName} (company ${companyId}):`, err);
    }
  }

  return total;
}
