# Replace Apify with PRAW for Reddit Data Collection

## Background

Reddit data is currently fetched via a third-party Apify actor (`spry_wholemeal~reddit-scraper`), which requires a paid Apify token and makes synchronous HTTP calls to Apify's cloud. The goal is to replace this with PRAW (Python Reddit API Wrapper), which uses Reddit's free official API directly.

The Apify logic lives entirely in `lib/collectors/reddit-client.ts`. The rest of the Reddit pipeline (`lib/collectors/reddit.ts`, the poll route, subreddit management) does not need to change — only the client implementation.

---

## Scope

**Replace** `lib/collectors/reddit-client.ts` — swap the Apify HTTP calls for PRAW calls via a small Python sidecar or serverless function.

**Do not change:**
- `lib/collectors/reddit.ts` (matching logic, `collectAllSubreddits`)
- `app/api/sources/poll/reddit/route.ts`
- `app/api/subreddits/` routes
- DB schema

---

## Implementation

### 1. Python sidecar script: `scripts/reddit_fetch.py`

Write a Python script using PRAW that accepts subreddit names + post limit as CLI args (or stdin JSON) and outputs a JSON array of posts matching the existing `RedditPost` interface.

The output schema must match `RedditPost` exactly:
```ts
{
  post_id, title, text, url, permalink, author, subreddit,
  created_utc_iso, score, upvote_ratio, num_comments,
  engagement_level, score_per_hour, comments_per_hour,
  link_flair_text, is_controversial
}
```

`engagement_level` should be derived from score (e.g. `"low"` < 10, `"medium"` < 100, `"high"` >= 100). `score_per_hour` and `comments_per_hour` can be approximated from post age.

PRAW setup:
```python
import praw
reddit = praw.Reddit(
    client_id=os.environ["REDDIT_CLIENT_ID"],
    client_secret=os.environ["REDDIT_CLIENT_SECRET"],
    user_agent="gito-sma-tool/1.0"
)
```

Fetch logic: use `subreddit.new(limit=N)` for each subreddit, collect into the output array.

### 2. Update `lib/collectors/reddit-client.ts`

Replace `runApifyScrape` with a function that spawns `scripts/reddit_fetch.py` as a child process (via Node's `child_process.spawn`) and parses stdout as JSON.

```ts
async function runPrawScrape(subreddits: string[], limit: number): Promise<RedditPost[]> {
  // spawn python3 scripts/reddit_fetch.py --subreddits r1,r2 --limit N
  // capture stdout, parse JSON
}
```

Update `RedditClient.create()` to read `REDDIT_CLIENT_ID` and `REDDIT_CLIENT_SECRET` instead of `APIFY_TOKEN`.

### 3. Environment variables

Remove: `APIFY_TOKEN`
Add:
- `REDDIT_CLIENT_ID` — from Reddit app dashboard (free, script-type app)
- `REDDIT_CLIENT_SECRET` — same

Update `.env.example` and Vercel environment config.

### 4. Reddit app setup (one-time, done by developer)

1. Go to https://www.reddit.com/prefs/apps
2. Create a new app → type: **script**
3. Name: `gito-sma-tool`
4. Redirect URI: `http://localhost:8080` (unused but required)
5. Copy client ID (under app name) and secret

---

## Acceptance Criteria

- [ ] `POST /api/sources/poll/reddit` returns posts without hitting Apify
- [ ] Returned posts are stored correctly in the DB (same shape as before)
- [ ] `APIFY_TOKEN` is no longer referenced anywhere in the codebase
- [ ] `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` are documented in `.env.example`
- [ ] Script works for batches of multiple subreddits in a single call
- [ ] No change to subreddit management UI or matching logic

---

## Notes

- PRAW free tier: 100 requests/minute, 1000 requests/10 minutes. At current poll frequency this is well within limits.
- `subreddit.new()` returns posts sorted by new, matching the current Apify actor's `sort: "new"` behavior.
- If Vercel's serverless environment makes spawning Python difficult, an alternative is to expose the Python script as a separate lightweight service (e.g. a free Railway or Render instance) and call it via HTTP — same interface, just networked instead of subprocess.
