# Gito Extension — Thread Tracking Tickets

---

## TICKET-1: Auto-collect scroll-before-scrape

**Priority:** High | **Dependency:** All collection tickets

Auto-collect currently opens a tab and immediately runs DOM selectors after `waitForTabLoad`. Most social platforms lazy-load content below the fold, so replies and later posts in a feed are absent at load time.

### Acceptance Criteria
- Add `scrollPage(tabId, steps?, delayMs?)` helper to `collector.ts`
- After `waitForTabLoad` and before any DOM extraction, call `scrollPage`
- Default: 3 scroll steps × ~700px, 1.5 s delay between each
- Applied to: Twitter search, Threads search, Reddit search, Twitter thread pages, Threads thread pages, Twitter profile pages
- Thread page collectors (collectXThread, collectThreadsReplies) may use more steps since replies are farther down the page

### Notes
- Scroll is executed via `chrome.scripting.executeScript` inside the tab (`window.scrollBy`)
- Total added latency per tab: ~4–5 s. Acceptable given data completeness tradeoff.

---

## TICKET-2: Ingest parent tweet when keyword-matching reply is detected

**Priority:** Medium | **Dependency:** TICKET-1, Goal 1 (parentId schema)

When auto-collect finds a tweet on a search page that is actually a reply (e.g., `https://x.com/FightOpinion/status/2064098923455840712`), the parent tweet (`https://x.com/SIChrisMannix/status/2064071769648979996`) should also be ingested and linked.

### Background
Reply tweets have the same URL structure as original tweets. In the DOM, a reply article contains a "Replying to @username" element with a link to the parent tweet's `/status/` URL. This parent link can be extracted at scrape time.

### Acceptance Criteria
- In `collectX`, after extracting each tweet article, check for a "Replying to" link (`a[href*="/status/"]` inside a reply-context element that appears before the tweet text)
- If found, set `subtype: "x_reply"` on the item and include `parentExternalId` pointing to the parent tweet status ID
- Collect parent tweets as additional `x_post` items in the same batch (deduplicated)
- At ingest time, `parentId` is resolved and stored on the reply row

### Notes
- Parent tweet DOM link is typically in a `div` above `[data-testid="tweetText"]` with text like "Replying to @username"
- Only collect parent if it's not already in the DB (handled by `onConflictDoNothing`)

---

## TICKET-3: Threads reply collection from thread post URLs

**Priority:** High | **Dependency:** TICKET-1, Goal 2 (tracked threads)

Open a Threads post URL (`https://www.threads.net/@user/post/POST_ID`) and scrape the replies that appear inline below the root post.

### Background
The Threads reply page (confirmed via screenshot) shows:
- Root post at top with engagement (103 likes, 4 comments shown)
- "Reply to @username..." input separator
- Reply items below: each with author handle, timestamp, body text, engagement icons

### Acceptance Criteria
- `collectThreadsReplies(postUrl, tabId)` function in `collector.ts`
- Scrolls page before collecting (TICKET-1)
- Root post identified as first article; replies are all subsequent articles
- Root post: `subtype: "threads_post"`, replies: `subtype: "threads_reply"`
- Replies carry `parentExternalId` and `rootExternalId` = root post's externalId
- Handle both `threads.net` and `threads.com` domains

### Estimated DOM Selectors
- Articles: `div[role="article"], article`
- Author: `a[href^="/@"]`
- Body: `[data-pressable-container]` (primary) or `p`, `span` fallback
- Post link/ID: `a[href*="/post/"]` within article

---

## TICKET-4: Schema — parentId and rootPostId on ingested_items

**Priority:** High | **Status:** Implemented

Add self-referential parent linking to `ingested_items` so replies can be structurally linked to their parent posts and thread root.

### Schema Changes
- `parent_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL` — direct parent (e.g., tweet being replied to)
- `root_post_id UUID REFERENCES ingested_items(id) ON DELETE SET NULL` — root of the thread (top-level post)
- `ExtensionItem` interface gains `parentExternalId?: string | null` and `rootExternalId?: string | null`
- Ingest route resolves `parentExternalId` / `rootExternalId` to DB UUIDs after insert

---

## TICKET-5: Tracked threads — schema + auto-collect

**Priority:** High | **Status:** Implemented

Add a `tracked_threads` table and extend auto-collect to revisit specific post URLs on each run, collecting root post + evolving replies.

### Schema
```
tracked_threads (
  id, company_id, platform, post_url, post_external_id,
  entity_id, label, is_active, created_at, last_collected_at
)
```

### Extension Behavior
- Context API returns active tracked threads per company
- Popup stores them on connect/sync
- Each auto-collect run visits every active tracked thread URL, scrolls, and collects root + replies
- Replies ingested with `parentId`/`rootPostId` resolved at ingest time

### API
- `GET /api/tracked-threads` — list for company
- `POST /api/tracked-threads` — add a thread to track
- `DELETE /api/tracked-threads/:id` — remove

---

## TICKET-6: Account-based Twitter auto-collect

**Priority:** Medium | **Status:** Implemented

Collect latest tweets from specific Twitter account profiles during each auto-collect run.

### Behavior
- Context API returns `twitterAccounts: string[]` from `twitter_handles` table
- Popup stores them on connect/sync
- Auto-collect visits `https://x.com/{handle}` for each account, scrolls, collects tweets
- Items ingested as `x_post` (profile timeline shows original tweets + reposts)

---

## TICKET-7: Thread narrative evolution view (backlog)

**Priority:** Low | **Status:** Backlog

Show how a tracked thread's replies have evolved over time, using the existing `cluster_period_narratives` pipeline.

### Acceptance Criteria
- "Thread Detail" page showing a tracked thread with daily AI narratives
- Reply timeline: how many replies per day, top replies by traction
- Feeds into existing cluster/narrative pipeline once thread data is properly structured via TICKET-4/5
