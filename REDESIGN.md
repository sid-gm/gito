# Gito Redesign — UI, Backend, UX, DB

_Drafted 2026-07-16. Companion to the analyst UI shipped in `d12b517` and the
extension analysis. This is the working spec for stripping Gito down to its
core loop: **collect → score → aggregate → notify**._

The platform is being rebuilt around one honest pipeline: the browser
extension (plus RSS) ingests posts and comments, per-item sentiment is scored,
and the analyst dashboard aggregates it. The narrative/cluster/storyline/report
machinery from the old platform is retired. Config moves out of the extension
into the website; the extension becomes a stateless worker that also reports
its own health (Telegram alerts on logouts / verification walls / 403s).

---

## 1. UI redesign

### 1.1 Analyst dashboard (shipped, mock data)

Commit `d12b517` replaced all of `/analyst` with the five-view design from the
"Gito data aggregation redesign" project (`Gito.dc.html`):

| View | Route | Shows | Backed by (after wiring) |
|---|---|---|---|
| Raw data | `/analyst` | Every ingested post/comment, newest first; platform filter, search; columns: source, content, topic, sentiment, reach | `items` + latest engagement |
| Groups | `/analyst/groups` | Volume bars by time / platform / topic with avg sentiment | `items` grouped counts |
| Sentiment | `/analyst/sentiment` | Per-platform mean daily sentiment (14d small multiples) + pos/neu/neg split | `items.sentiment_score` daily aggregates |
| Bubbles | `/analyst/bubbles` | Packed bubbles (size = volume, color = sentiment) by topic/platform, day/week scrubber, click → top stories | same aggregates + top-N by engagement |
| Sources | `/analyst/sources` | Extension per-platform collection health + RSS feed health | `collect_runs`/`collect_run_events` + `rss_feeds` |

Design system: dark terminal look, `#0f1115` bg / `#12151d` panels, IBM Plex
Sans + Mono, single accent `#4f7cff`, scoped `.an-*` classes in
`app/analyst/analyst.css`. Header chips = tracked topics; range picker
("Last 7 days") becomes a real query param at wiring time.

Remaining UI work:

- Wire each view to the new aggregate endpoints (§2.3) once the DB lands.
- **Reach column needs engagement data** — captured nowhere today (§4).
- Add the config surface (§1.3) so keywords/subreddits are editable on the site.
- Login page and public portal keep their existing design; untouched.

### 1.2 Extension popup — de-clutter

The popup stops being a config form and becomes a **status surface**:

Keep:
- Setup state: Gito URL + API key (the only config that must live in the extension).
- Run now button.
- Last run / next run line.

Add:
- Per-platform health dots (ok / degraded / blocked) from the last run.
- "Manage configuration →" deep link to `usegito.com/analyst/sources`.
- Optional: one quick-add keyword input that POSTs to the server (§3.2).

Remove from popup (moves to website):
- Keyword terms input, platform checkboxes, interval select, enable toggle.
- Entity chips list (already shown in the capture picker).
- Company switcher — **decision:** if Gito is single-company in practice, drop
  multi-account entirely; it's a large share of popup + background complexity.

Unchanged: the in-page manual capture UX (floating "→ Gito" button, context
menu, entity picker, include-comments checkbox).

### 1.3 Config UI on the website

Extend the Sources view (or a `/analyst/sources/settings` panel) with:

- **Topics & keywords**: topics (today's tracked entities) each own N search
  keywords; add/remove keyword chips inline.
- **Subreddits**: name + sort toggles (new / hot) + optional per-subreddit
  keyword filters + active toggle.
- **X handles** and **tracked threads**: existing CRUD, re-homed here.
- **Collector settings**: interval, per-platform pause, enabled master switch.
- **Notifications**: Telegram on/off, quiet hours (optional v2).

---

## 2. Backend redesign

### 2.1 Retire (the "stripped" parts)

The analyst UI no longer surfaces any of this, so the pipelines and routes go:

- Clustering: `cron/classify`, `cron/name-clusters`, `cron/archive-clusters`,
  merge suggestions, recluster/reset routes, `lib/ai/cluster*`.
- Storylines, period narratives, `cron/summarize-narratives`, day insights,
  daily briefs, reports (`lib/ai/storylines|daily-brief|day-insights|report-context`).
- Their API routes under `/api/clusters`, `/api/storylines`,
  `/api/merge-suggestions`, `/api/daily-brief`, `/api/daily-report`,
  `/api/entity-day-insights`, `/api/reports`.
- The auto-cluster-per-thread hack inside `extension-ingest` (replaced by real
  threading, §4).

**Decision needed:** the public portal (`app/(public)`) renders the news
timeline (`news_timeline_days`, `cron/summarize-news-timeline`). Keep the
portal → keep that pipeline; kill the portal → retire it too.

### 2.2 Keep

- Auth: analyst session middleware + login; extension Bearer API key
  (`lib/extension-auth`).
- Ingestion: `POST /api/items/extension-ingest` (extended, §2.3),
  `/api/extension/context` (extended), `/api/extension-runs`.
- Per-item sentiment batch scoring (`lib/ai/item-sentiment.ts` +
  `run/backfill-item-sentiment`) — it feeds three of the five views.
- RSS collectors (Google News / publishers) → items with `platform = news`.
- Telegram sender `lib/notifications/telegram.ts` (gets a new caller).
- **Decision needed:** `local-reddit-collector.js` (residential-IP RSS poller).
  Options: keep both (RSS breadth + extension depth/hot/comments), or retire
  it once extension Reddit browsing proves stable. Recommend: keep during the
  transition, revisit after 2 weeks of health data.

### 2.3 New / changed API surface

Analyst reads (thin aggregates over `items`):

```
GET /api/analyst/items?range&platform&topic&q&cursor     → Raw data
GET /api/analyst/groups?by=time|platform|topic&range     → Groups
GET /api/analyst/sentiment?days=14                       → Sentiment (per-platform daily means + splits)
GET /api/analyst/bubbles?by=topic|platform&gran=day|week&period → Bubbles (+top stories)
GET /api/analyst/sources                                 → Sources (runs, health, feeds)
```

Extension protocol (API-key auth, CORS as today):

```
GET  /api/extension/context     → config snapshot: topics+keywords, subreddits(+sorts),
                                  handles, tracked threads, interval, pauses
POST /api/items/extension-ingest → items batch; NEW fields: engagement, source_kind,
                                  source_ref, published_at_precision,
                                  extraction_method, extraction_confidence (§5)
POST /api/extension-runs        → create run (start) / finalize (end) as today
POST /api/extension/health      → NEW: health events (platform, status, detail)
```

Config CRUD: keep `/api/reddit-subreddits`, `/api/twitter-handles`,
`/api/tracked-threads`; add `/api/collect-keywords` and `/api/collect-settings`.

### 2.4 Health → Telegram

- Extension detects per-session: HTTP 403 pages, login walls / checkpoint
  DOM markers (X, Threads, Instagram, Facebook, Reddit block page), and
  "0 items across every session on a platform" as a soft signal.
- It POSTs events to `/api/extension/health`; it never talks to Telegram
  directly (no bot token in the extension).
- Server keeps a per-platform health state (`source_health`): alerts fire on
  **state transitions** (ok → blocked), not on every event; repeat alerts
  throttled to one per platform per N hours.
- Replace the extension's silent "3 strikes → disable everything" with:
  pause **that platform**, alert, keep the rest running.

Sample alert:

```
⚠️ Gito collector: Threads is blocked (login wall) since 14:32.
Last successful run: 12:02. Open threads.com in Chrome and log back in.
```

---

## 3. UX redesign — keyword flow

### 3.1 One source of truth

All collector config lives in Postgres, edited on usegito.com. The extension
holds only URL + API key and **pulls a fresh config snapshot at the start of
every run** (today it snapshots once at connect time and goes stale).

### 3.2 Flows

**Add a keyword on the website** (primary):
1. Sources → Topics & keywords → type keyword under a topic → saved via
   `POST /api/collect-keywords`.
2. Next run (or "Run now"), the extension's context pull includes it; sessions
   are queued per keyword × platform.
3. Items found by that keyword arrive tagged with the owning topic — topic
   assignment by **provenance** (which keyword found it), replacing today's
   fragile substring-match of entity labels against item text.

**Add a keyword from the popup** (secondary): quick-add input → same
`POST /api/collect-keywords` (attached to a default topic, re-assignable on
the site). The popup never writes config to `chrome.storage`.

**Configure subreddits**: Sources → Subreddits → add name, pick new/hot,
optional keyword filters. Extension browses `r/<sub>/new/` and `r/<sub>/hot/`
listing pages on a real tab (DOM scrape — never the JSON API), filters
client-side, drills into matching posts for comments.

### 3.3 Run lifecycle (end to end)

```
chrome.alarm (interval from server config)
  → GET /api/extension/context            (fresh config)
  → POST /api/extension-runs              (run start, runId)
  → session per keyword×platform, per subreddit×sort, then tracked/profiles
      - one background tab, scroll, scrape ≤20 posts
      - drill into ≤5 post pages for comments/replies
      - if DOM extraction fails but the page is healthy: Vision fallback pass (§5)
      - POST extension-ingest incrementally (items + engagement + provenance)
      - on failure: POST /api/extension/health event; continue other sessions
      - 30s alarm chain between sessions (MV3-safe, and pacing against 403s)
  → finalize run (counts, per-platform status)
  → server: health state transitions → Telegram
  → Sources view reflects the run within one refresh
```

Pacing rules (the lesson from the removed Reddit auto-collect): one subreddit
per session, jittered scroll delays, per-run session cap, and per-platform
pause on block — the goal is to look like a slow human, not a crawler.

---

## 4. DB redesign

Grounded in how the extension actually ingests (posts + their visible
comments), fixing the recorded flaws: inconsistent threading, no engagement,
faked timestamps, no provenance, no company scope on items, counts-only runs.

### 4.1 Core tables

```sql
-- topics = today's tracked_entities (analysis grouping; header chips)
topics (
  id uuid PK, company_id FK, label text, created_at
)

collect_keywords (
  id uuid PK, company_id FK, topic_id FK→topics,
  term text, platforms text[] CHECK ⊆ {twitter,threads,reddit},
  is_active bool DEFAULT true, created_at,
  UNIQUE (company_id, term)
)

reddit_subreddits (            -- keep table, extend
  id, company_id, subreddit_name,
  sorts text[] DEFAULT '{new}' CHECK ⊆ {new,hot},   -- NEW
  keyword_filters text[], is_active bool, created_at
)

twitter_handles / tracked_threads   -- keep as-is
collect_settings (company_id PK, interval_minutes int, enabled bool,
                  paused_platforms text[], max_thread_drills int DEFAULT 5)
```

### 4.2 Items — posts and comments, threaded for real

```sql
items (
  id uuid PK,
  company_id uuid FK,                    -- NEW: items scoped directly
  platform platform_enum,                -- twitter|threads|reddit|instagram|facebook|news|manual
  kind text CHECK (kind IN ('post','comment')),
  external_id text, url text,
  author text,
  title text,                            -- real titles only (reddit/news); no body[:200] copies
  body text,
  published_at timestamptz NULL,         -- NEVER faked to ingest time
  published_at_precision text CHECK (IN ('exact','approx','unknown')),
  -- threading (structural, replaces the cluster hack)
  parent_id uuid FK→items NULL,
  root_post_id uuid FK→items NULL,
  thread_key text NULL,                  -- platform:root_external_id
  depth int NULL,                        -- reddit comment depth preserved
  -- analysis
  topic_id uuid FK→topics NULL,          -- assigned by provenance, editable
  sentiment_score real, sentiment_label text, sentiment_analyzed_at timestamptz,
  -- provenance
  source_kind text CHECK (IN ('keyword_search','subreddit_new','subreddit_hot',
                              'tracked_thread','profile','manual','rss')),
  source_ref text,                       -- the term / subreddit / handle / feed id
  collect_run_id uuid FK NULL,
  -- extraction tier (§5)
  extraction_method text CHECK (IN ('dom','vision')) DEFAULT 'dom',
  extraction_confidence real NULL,       -- mean OCR confidence for vision items
  dedupe_key text NULL,                  -- hash(platform, author, body prefix); unique
                                         -- (partial index) when external_id IS NULL
  latest_engagement jsonb NULL,          -- cache of newest snapshot for cheap "Reach"
  created_at timestamptz,
  UNIQUE (platform, external_id)
)

engagement_snapshots (                   -- re-scrapes upsert here instead of being dropped
  item_id FK→items, captured_at timestamptz,
  likes int, replies int, reposts int, upvotes int, views bigint,  -- nullable per platform
  PRIMARY KEY (item_id, captured_at)
)
```

Ingest changes: on `(platform, external_id)` conflict, **update
`latest_engagement` + insert a snapshot** rather than skipping silently; the
parent/root resolution pass stays but every collector now supplies
`parentExternalId`/`rootExternalId` (Reddit comments via `thingid` +
`postid`, Facebook comments via `comment_id` → post), not just X.

### 4.3 Runs and health

```sql
collect_runs (
  id uuid PK, company_id, triggered_by text ('auto'|'manual'),
  started_at, finished_at, status text ('running'|'ok'|'partial'|'failed'),
  items_collected int, items_inserted int
)

collect_run_events (
  id uuid PK, run_id FK, at timestamptz,
  platform text, source_kind text, source_ref text,
  status text CHECK (IN ('ok','zero_results','http_403','logged_out',
                         'checkpoint','error')),
  detail text, items_count int
)

source_health (                          -- drives Telegram + Sources view
  company_id, platform, PRIMARY KEY (company_id, platform),
  state text ('ok'|'degraded'|'blocked'),
  since timestamptz, last_ok_at timestamptz, last_notified_at timestamptz
)
```

### 4.4 Keep / retire

Keep: `companies`, `rss_feeds` (RSS items land in `items` with
`platform='news'`, `source_kind='rss'`), `news_timeline_days` **only if** the
public portal survives.

Retire: `clusters`, `cluster_items`, `cluster_merges`,
`cluster_merge_suggestions`, `cluster_period_narratives`, `cluster_news_links`,
`storylines`, `entity_day_insights`, `daily_briefs`, `threads_filters`
(superseded by `collect_keywords`), `extension_collect_runs` (superseded by
`collect_runs`).

### 4.5 Migration sketch

1. Create new tables; copy `tracked_entities` → `topics`.
2. `ingested_items` → `items`: subtype → `kind` (`*_post`→post, else comment);
   carry `parentId`/`rootPostId`/sentiment/entityId(→topic_id); derive
   `thread_key` from root external id; `published_at_precision='unknown'`
   where `published_at == created_at` (the faked ones); `source_kind='manual'`
   for extension-era items, `'rss'` for feed items; `company_id` backfilled
   via entity → company (orphans get the single company, given one tenant).
3. Extension v2 ships against the new endpoints; old columns freeze; retire
   tables after two clean weeks.

---

## 5. Vision fallback — screenshot extraction (Apple Vision)

DOM selectors are the pipeline's weakest link: they churn (Threads already
migrated domains and dropped `role="article"`), and platforms increasingly
serve markup designed to resist scraping. When selectors fail but the page
*renders* fine, fall back to reading the pixels.

### 5.1 Extraction tiers

- **Tier 1 — DOM extraction** (today's collectors): fast, precise, yields
  external IDs and exact timestamps. Always attempted first.
- **Tier 2 — screenshot + OCR**: capture the rendered page as images and
  extract original post, usernames, timestamps, replies, and engagement
  locally using Apple's Vision framework. No cloud OCR — screenshots never
  leave the Mac (same premise as `local-reddit-collector`: the collector is
  the analyst's own machine, so macOS-only is acceptable).

### 5.2 Architecture

```
extension (session tab)
  scroll + chrome.tabs.captureVisibleTab per viewport (JPEG frames)
    → Chrome native messaging → gito-vision-host (small Swift binary)
        VNRecognizeTextRequest (.accurate, en) → text lines + bounding boxes
        layout pass:
          - group lines into post blocks by vertical gaps
          - classify: username (@handle / u/name / r/sub patterns),
            relative timestamp ("2h", "3d"), body, engagement ("1.2K" → 1200)
          - reply nesting from x-offset indentation
    → structured candidates → extension normalizes to ExtensionItem[]
    → same ingest path, marked extraction_method='vision'
```

The native messaging host is registered at
`~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.gito.vision.json`,
allowlisted to the extension ID — no open ports, no daemon config. The Swift
binary ships alongside the extension (simple `make install` script).

### 5.3 Trigger rules

Per session, in order:

1. DOM collector returns **0 items** and health detection says the page is
   *not* a login wall / 403 → run a Vision pass on the same tab before closing.
2. DOM collector **throws** (selector drift) → Vision pass.
3. Manual capture falls back to selected-text-only → offer "capture via
   screenshot" in the picker.
4. Per-platform kill-switch (`vision_fallback` on/off) in site config.

Every Vision pass logs a `vision_fallback` event in `collect_run_events`, so
the Sources view shows when a platform is surviving on OCR — the early-warning
sign that its selectors need fixing.

### 5.4 Data-quality contract

Vision items are honest about their imprecision:

- `extraction_method='vision'`, `extraction_confidence` = mean OCR confidence.
- No external ID from pixels → `external_id NULL`, dedupe via
  `dedupe_key = hash(platform, author, normalized body prefix)` (partial
  unique index where `external_id IS NULL`).
- Timestamps come from relative labels ("2h") → `published_at_precision='approx'`.
- Engagement parsed from abbreviated labels ("1.2K") → approximate snapshot.
- If a later DOM pass captures the same item with a real external ID, the
  DOM row wins and the vision row is merged into it (match on `dedupe_key`).

Known limits (accepted, because this is a fallback tier, not the default):
truncated bodies behind "Show more" (expand via synthetic clicks before
capture where safe), no media context, emoji loss, occasional mis-grouping in
dense feeds.

---

## Open decisions

1. **Single vs multi-company** — determines popup switcher, `company_id`
   backfill, and whether config UIs need a company scope. (Recommend: single.)
2. **Public portal** — keep (→ keep news timeline pipeline) or kill.
3. **`local-reddit-collector.js`** — run alongside extension Reddit browsing or
   retire it. (Recommend: keep temporarily, revisit with health data.)
4. **X/Threads keyword search** — spec language is Reddit-centric; assume X
   and Threads keyword sessions stay as today unless decided otherwise.
5. **Topical clustering** — retired for now; the `items` design doesn't block
   re-adding a clustering layer later if narratives come back.
