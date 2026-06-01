import Parser from "rss-parser";
import type { NewIngestedItem, RssFeed } from "@/lib/db/schema";

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

export async function collectGoogleAlerts(
  feed: RssFeed
): Promise<NewIngestedItem[]> {
  const parsed = await parser.parseURL(feed.feedUrl);

  return (parsed.items ?? []).map((item) => ({
    entityId: feed.entityId,
    rssFeedId: feed.id,
    platform: "google_alerts" as const,
    externalId: item.link ?? item.guid ?? null,
    url: item.link ?? null,
    title: stripHtml(item.title),
    body: item.contentSnippet ?? stripHtml(item.content),
    author: item.creator ?? null,
    publishedAt: item.pubDate ? new Date(item.pubDate) : null,
    rawJson: item as Record<string, unknown>,
  }));
}
