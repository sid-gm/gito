# Reddit RSS: Ingest Cron Job

## Background

With subreddits configured via the Sources UI (see `reddit-rss-sources-ui.md`), we need a cron that polls Reddit's public RSS feeds every minute and ingests new posts into `ingested_items`.

Reddit's RSS supports server-side keyword search, which we should use instead of fetching all posts and filtering client-side. The URL patterns are:

- **With keywords:** `https://www.reddit.com/r/{subreddit}/search.rss?q=keyword1+OR+keyword2&restrict_sr=1&sort=new`
- **No keywords (all posts):** `https://www.reddit.com/r/{subreddit}/new/.rss`

No auth required. Reddit's RSS is public.

---

## RSS URL construction

```ts
function buildRssUrl(subredditName: string, keywordFilters: string[]): string {
  if (keywordFilters.length === 0) {
    return `https://www.reddit.com/r/${subredditName}/new/.rss`;
  }
  const q = keywordFilters.join(" OR ");
  const params = new URLSearchParams({ q, restrict_sr: "1", sort: "new" });
  return `https://www.reddit.com/r/${subredditName}/search.rss?${params}`;
}
```

Multiple keywords become `q=kw1 OR kw2 OR kw3`. Reddit handles the filtering server-side — no client-side keyword matching needed.

---

## Feed XML structure

The feed is Atom format. Relevant fields per `<entry>`:

```xml
<id>t3_1ta42a0</id>                          <!-- post_id: strip "t3_" prefix -->
<title>Post title here</title>
<link href="https://www.reddit.com/r/.../comments/.../" />   <!-- permalink -->
<author><name>/u/username</name></author>
<published>2026-05-11T13:56:16+00:00</published>
<content type="html">...HTML-encoded content...</content>    <!-- strip HTML for body -->
```

Note: `<content>` is HTML-encoded and contains a formatted table layout. Strip all HTML tags to extract the plain text body. For link posts, the body will be minimal or empty — that's fine.

---

## Collector: `lib/collectors/reddit-rss.ts`

```ts
export interface RedditRssPost {
  post_id: string;        // base36 ID, e.g. "1ta42a0" (stripped of "t3_" prefix)
  title: string;
  permalink: string;      // full reddit.com/r/.../comments/... URL from <link href>
  author: string;         // stripped of "/u/" prefix
  subreddit: string;
  published_iso: string;  // from <published>
  body: string | null;    // plain text extracted from <content>, null if empty
}

export async function collectSubredditRss(
  subredditName: string,
  keywordFilters: string[]
): Promise<RedditRssPost[]>
```

Parse the Atom XML using `fast-xml-parser` (check `package.json` first; add if missing). Each `<entry>` → one post.

HTML stripping: use a simple regex (`/<[^>]*>/g`, `''`) to get body text from `<content>`. If the result is under 10 chars, set `body: null`.

---

## Ingest logic: `lib/collectors/reddit-rss-ingest.ts`

```ts
export async function collectAndIngestRedditRss(companyId: string): Promise<number>
```

Steps:
1. Fetch all `reddit_subreddits` rows for this company (including `keywordFilters`)
2. For each subreddit, call `collectSubredditRss(subredditName, keywordFilters)` — keywords are passed through to the URL, so Reddit filters server-side
3. Resolve `entityId` for each post using keyword-matching against `trackedEntities` for this company (same approach as `lib/collectors/reddit.ts`)
4. Call `upsertItems` with `platform: 'reddit'` and `externalId: post_id`

`NewIngestedItem` shape:
```ts
{
  platform: "reddit",
  externalId: post_id,           // e.g. "1ta42a0"
  url: permalink,
  title,
  body: body ?? null,
  author,
  publishedAt: new Date(published_iso),
  entityId,
  subtype: "reddit_post",
  rawJson: { subreddit, keywordFilters },
}
```

---

## Cron route: `app/api/cron/reddit-rss/route.ts`

Follow the exact pattern of `app/api/cron/hackernews/route.ts`:

```ts
export async function GET(req: Request) {
  const authError = verifyCronSecret(req);
  if (authError) return authError;

  const companies = await getAllCompanies(); // add helper if it doesn't exist
  let total = 0;

  for (const company of companies) {
    try {
      const inserted = await collectAndIngestRedditRss(company.id);
      total += inserted;
    } catch (err) {
      console.error(`[Reddit RSS] company ${company.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, inserted: total });
}
```

---

## vercel.json

Add the cron entry:

```json
{ "path": "/api/cron/reddit-rss", "schedule": "* * * * *" }
```

`* * * * *` = every minute. Vercel Pro supports 1-minute minimum intervals.

---

## Poll route: `app/api/sources/poll/reddit-rss/route.ts`

Add a manual poll route for testing (same pattern as `/api/sources/poll/hackernews`):
- POST with `{ companyId }` body
- Calls `collectAndIngestRedditRss(companyId)`
- Returns `{ inserted: number }`

---

## Acceptance Criteria

- [ ] Cron runs every minute per `vercel.json`
- [ ] No-keyword subreddits use `/new/.rss`; subreddits with keywords use `/search.rss?q=kw1+OR+kw2&restrict_sr=1&sort=new`
- [ ] Atom XML is parsed correctly; `<id>`, `<title>`, `<link href>`, `<author>`, `<published>`, `<content>` all mapped
- [ ] HTML is stripped from `<content>` to produce plain text body
- [ ] `externalId` is the bare post ID (e.g. `1ta42a0`) — dedup via `onConflictDoNothing`
- [ ] `entityId` is resolved via keyword match against `trackedEntities` (null if no match)
- [ ] Manual poll route works for local testing
- [ ] No Apify or PRAW dependency — pure HTTP fetch

---

## Notes

- The existing `lib/collectors/reddit.ts` (PRAW-based) is a separate codepath for `replace-apify-with-praw.md`. Keep them independent.
- Each RSS feed returns ~25 posts. At 1-minute intervals, dedup via `onConflictDoNothing` handles re-fetching the same posts across polls — this is expected and fine.
- If a subreddit is private/banned, the RSS returns a 404 — catch and log per subreddit, don't crash the loop.
- `fast-xml-parser` is the preferred XML lib. Check `package.json` before adding it.
