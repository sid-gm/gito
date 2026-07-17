import Parser from "rss-parser";
import type { NewItem, RssFeed } from "@/lib/db/schema";

const parser = new Parser();

function stripHtml(raw: string | null | undefined): string | null {
  if (!raw) return null;
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .trim() || null;
}

// Google News / publisher feeds → items with platform='news'. Topic comes from
// the feed (provenance), never from text matching.
export async function collectRssFeed(feed: RssFeed): Promise<NewItem[]> {
  const parsed = await parser.parseURL(feed.feedUrl);

  return (parsed.items ?? []).flatMap((item) => {
    const externalId = item.link ?? item.guid ?? null;
    if (!externalId) return [];
    const publishedAt = item.pubDate ? new Date(item.pubDate) : null;
    const validDate = publishedAt && !isNaN(publishedAt.getTime()) ? publishedAt : null;

    return [{
      companyId: feed.companyId,
      platform: "news" as const,
      kind: "post" as const,
      externalId,
      url: item.link ?? null,
      title: stripHtml(item.title),
      body: item.contentSnippet ?? stripHtml(item.content),
      author: item.creator ?? null,
      publishedAt: validDate,
      publishedAtPrecision: (validDate ? "exact" : "unknown") as "exact" | "unknown",
      topicId: feed.topicId,
      sourceKind: "rss" as const,
      sourceRef: feed.id,
    }];
  });
}
