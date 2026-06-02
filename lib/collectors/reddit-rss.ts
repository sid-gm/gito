import Parser from "rss-parser";

const parser = new Parser();

function buildRssUrl(subredditName: string, keywordFilters: string[]): string {
  if (subredditName === "all") {
    const q = keywordFilters.join(" OR ");
    const params = new URLSearchParams({ q, sort: "new", type: "link" });
    return `https://www.reddit.com/search.rss?${params}`;
  }
  if (keywordFilters.length === 0) {
    return `https://www.reddit.com/r/${subredditName}/new/.rss`;
  }
  const q = keywordFilters.join(" OR ");
  const params = new URLSearchParams({ q, restrict_sr: "1", sort: "new" });
  return `https://www.reddit.com/r/${subredditName}/search.rss?${params}`;
}

function stripHtml(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface RedditRssPost {
  post_id: string;
  title: string;
  permalink: string;
  author: string;
  subreddit: string;
  published_iso: string;
  body: string | null;
}

export async function collectSubredditRss(
  subredditName: string,
  keywordFilters: string[]
): Promise<RedditRssPost[]> {
  const url = buildRssUrl(subredditName, keywordFilters);

  const proxyBase = process.env.REDDIT_PROXY_URL;
  const fetchUrl = proxyBase
    ? `${proxyBase}?url=${encodeURIComponent(url)}`
    : url;

  const res = await fetch(fetchUrl, {
    headers: { "User-Agent": "GitoSMA/1.0" },
  });

  if (res.status === 404) {
    throw new Error(`r/${subredditName} not found (404)`);
  }
  if (!res.ok) {
    throw new Error(`Reddit RSS ${res.status} for r/${subredditName}`);
  }

  const xml = await res.text();
  const feed = await parser.parseString(xml);

  return feed.items.map((item) => {
    // Reddit Atom feeds use <id> which rss-parser exposes as item.id, not item.guid
    const guid = (item as Record<string, unknown>).id as string ?? item.guid ?? "";
    const post_id = guid.replace(/^t\d+_/, "") || guid;

    const rawBody = stripHtml(item.content ?? item.contentSnippet);
    const body = rawBody.length >= 10 ? rawBody : null;

    const rawAuthor =
      item.creator ??
      ((item as Record<string, unknown>).author as string | undefined) ??
      "";
    const author = rawAuthor.replace(/^\/u\//, "");

    return {
      post_id,
      title: item.title ?? "",
      permalink: item.link ?? "",
      author,
      subreddit: subredditName,
      published_iso: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
      body,
    };
  });
}
