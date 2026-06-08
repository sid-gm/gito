# Reddit RSS: Sources Page UI

## Background

Reddit exposes public RSS feeds at `https://www.reddit.com/r/{subreddit}/new/.rss` — no auth required. We're re-introducing Reddit as a source using this mechanism instead of Apify/PRAW. This ticket covers the Sources page UI for managing which subreddits to track and what keywords to filter by.

The DB already has a `reddit_subreddits` table (company-scoped, `subreddit_name` column). We need to extend it to support keyword filters, and wire up the Sources page UI.

---

## Schema change

Add a `keyword_filters` column to `reddit_subreddits`:

```sql
ALTER TABLE "reddit_subreddits" ADD COLUMN "keyword_filters" text[] NOT NULL DEFAULT '{}';
```

A row with an empty array means "ingest all posts from this subreddit" — the cron will use the `/new/.rss` endpoint. A non-empty array means "use Reddit's search RSS with these keywords as the query" — the cron constructs `search.rss?q=kw1+OR+kw2&restrict_sr=1&sort=new`. Filtering is server-side on Reddit's end, not post-fetch.

Add the Drizzle migration and update the schema type accordingly.

---

## API routes

### `GET /api/reddit-subreddits`
Returns all subreddit rows for the current company:
```ts
[{ id, subredditName, keywordFilters: string[], createdAt }]
```

### `POST /api/reddit-subreddits`
Body: `{ subredditName: string, keywordFilters?: string[] }`
- Validates subreddit name format (alphanumeric + underscores, 3–21 chars)
- Inserts row; 409 on duplicate

### `DELETE /api/reddit-subreddits/[id]`
Deletes by row ID.

### `PATCH /api/reddit-subreddits/[id]`
Body: `{ keywordFilters: string[] }` — updates keyword filter list only.

---

## Sources page UI

Add a **Reddit** card to `app/sources/page.tsx` alongside HackerNews, Twitter, etc.

The card should show:
- Source name + description: "Reddit RSS — tracks new posts from configured subreddits via public RSS feeds. No credentials required."
- A `requiresEnv: []` (always active)
- Stats chip: total posts ingested today / last 7 days (reuse the existing stats pattern via a new `/api/sources/stats/reddit` route)
- Sparkline (same pattern as other sources)

Below the card (or in an expanded section), show the subreddit manager:

**Subreddit list** — for each configured subreddit:
- Subreddit name (e.g. `r/sanfrancisco`)
- Keyword filters shown as removable chips (or "All posts" if empty)
- Edit button → inline edit of keyword filters (comma-separated input)
- Delete button

**Add subreddit form:**
- Text input for subreddit name (strip leading `r/` if user types it)
- Optional keyword filter input (comma-separated)
- Submit button

UI should follow the existing patterns in the sources page — use the same `PlatformChip`, card layout, and inline form style already used for Threads filters.

---

## Stats route

Add `GET /api/sources/stats/reddit`:
```ts
{ today: number, sevenDays: number, lastPoll: string | null }
```
Query `ingested_items` where `platform = 'reddit'` and `company_id` matches (via entity join). `lastPoll` is the most recent `created_at` among reddit items.

---

## Acceptance Criteria

- [ ] `reddit_subreddits` table has `keyword_filters` column with Drizzle migration
- [ ] CRUD routes work and are protected by company scoping
- [ ] Reddit card appears on Sources page with stats + sparkline
- [ ] User can add a subreddit (with or without keyword filters)
- [ ] User can edit keyword filters on an existing subreddit
- [ ] User can delete a subreddit
- [ ] Empty keyword filters = ingest all posts; non-empty = filter by keyword

---

## Notes

- Keep subreddit name storage normalized (lowercase, no `r/` prefix)
- Max 20 subreddits per company is a reasonable soft limit — add a guard in the POST route
- Keyword filter matching happens at ingest time (see cron ticket), not stored as a separate DB query
