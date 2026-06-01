# Gito — News Timeline Pivot Tickets

These tickets restructure Google Alerts from a clustering source into a dedicated
**News Timeline** feature on the Narratives page. Google Alerts items will no longer
enter the embed → cluster → classify pipeline. They become an independent news
context layer, per RSS feed, with per-day AI summaries and sentiment.

**Retention policy:** Raw Google Alerts articles (`ingested_items` rows where
`platform = 'google_alerts'`) are kept for **7 days only**, then hard-deleted.
The `news_timeline_days` AI summaries are kept **permanently** — they are the
long-term record of the news cycle. Nothing else in the DB is affected.

---

## TICKET-01 · DB: Create `rss_feeds` table and migrate `googleAlertsFeedUrl`

**Type:** Database migration  
**Blocks:** TICKET-02, TICKET-04, TICKET-05, TICKET-06

### What to do
1. Add a new `rss_feeds` table to `lib/db/schema.ts`:
   ```ts
   export const rssFeeds = pgTable("rss_feeds", {
     id:        uuid("id").defaultRandom().primaryKey(),
     entityId:  uuid("entity_id").references(() => trackedEntities.id, { onDelete: "cascade" }).notNull(),
     label:     text("label").notNull(),          // e.g. "Sam Altman", "ChatGPT"
     feedUrl:   text("feed_url").notNull(),
     createdAt: timestamp("created_at").defaultNow().notNull(),
   }, (t) => [unique("rss_feeds_entity_url_unique").on(t.entityId, t.feedUrl)]);
   ```
2. Write a Drizzle migration that:
   - Creates the `rss_feeds` table.
   - Copies every non-null `google_alerts_feed_url` from `tracked_entities` into
     `rss_feeds`, using the entity's `label` as the feed label.
   - Drops the `google_alerts_feed_url` column from `tracked_entities`.
3. Remove `googleAlertsFeedUrl` from the `trackedEntities` table definition in schema.ts.
4. Export `RssFeed` and `NewRssFeed` types.

---

## TICKET-02 · DB: Create `news_timeline_days` table

**Type:** Database migration  
**Blocks:** TICKET-05, TICKET-06

### What to do
Add to `lib/db/schema.ts`:
```ts
export const newsTimelineDays = pgTable("news_timeline_days", {
  id:             uuid("id").defaultRandom().primaryKey(),
  rssFeedId:      uuid("rss_feed_id").references(() => rssFeeds.id, { onDelete: "cascade" }).notNull(),
  periodDate:     text("period_date").notNull(),   // "YYYY-MM-DD" UTC
  aiSummary:      text("ai_summary"),
  sentimentScore: real("sentiment_score"),
  sentimentLabel: text("sentiment_label"),         // positive | negative | neutral | mixed
  itemCount:      integer("item_count").default(0).notNull(),
  generatedAt:    timestamp("generated_at"),
  createdAt:      timestamp("created_at").defaultNow().notNull(),
  updatedAt:      timestamp("updated_at").defaultNow().notNull(),
}, (t) => [unique("news_timeline_days_feed_date_unique").on(t.rssFeedId, t.periodDate)]);
```
Write and run the Drizzle migration.

---

## TICKET-03 · DB: Add `rssFeedId` column to `ingested_items`

**Type:** Database migration  
**Blocks:** TICKET-04, TICKET-05

### What to do
1. Add a nullable FK column to `ingested_items`:
   ```ts
   rssFeedId: uuid("rss_feed_id").references(() => rssFeeds.id, { onDelete: "set null" }),
   ```
2. Write and run the Drizzle migration.
3. This column lets downstream queries group news items by feed rather than entity.

---

## TICKET-04 · Collector: Support multiple RSS feeds + stamp `rss_feed_id`

**Type:** Backend  
**Blocked by:** TICKET-01, TICKET-03

### What to do
1. Update `lib/collectors/google-alerts.ts`:
   - Change the function signature from `collectGoogleAlerts(entity: TrackedEntity)`
     to `collectGoogleAlerts(feed: RssFeed): Promise<NewIngestedItem[]>`.
   - Each returned item should include `rssFeedId: feed.id` and `entityId` looked up
     from the feed's `entityId`.
2. Update `app/api/cron/google-alerts/route.ts`:
   - Query `rss_feeds` table (join to `trackedEntities` for entityId) instead of
     iterating entities by `googleAlertsFeedUrl`.
   - Pass each `RssFeed` row to `collectGoogleAlerts`.
3. Update `lib/collectors/ingest.ts` (`upsertItems`) to write `rssFeedId` when present.
4. Update `app/api/sources/poll/google-alerts/route.ts` and
   `app/api/sources/stats/google-alerts/route.ts` similarly.

---

## TICKET-05 · Cron: New `summarize-news-timeline` job

**Type:** Backend — new cron  
**Blocked by:** TICKET-02, TICKET-03, TICKET-04

### What to do
Create `app/api/cron/summarize-news-timeline/route.ts`:

Logic:
1. Query all `rss_feeds` rows (join entity for context label).
2. For each feed, fetch `ingested_items` where `platform = 'google_alerts'` and
   `rss_feed_id = feed.id`, grouped by `period_date` (UTC date of `created_at`).
3. For each (feed, day) pair:
   - Skip if `news_timeline_days` already has an up-to-date row (generatedAt ≥
     latest item in that day).
   - Build a prompt from the day's article titles (up to 8).
   - Call `gpt-4o-mini` for a 1–2 sentence daily summary.
   - Call `gpt-4o-mini` (or reuse the sentiment lib at `lib/ai/sentiment.ts`) for
     a sentiment score + label.
   - Upsert into `news_timeline_days`.
4. Respect the 20-cluster limit pattern from `summarize-narratives` — process up to
   30 (feed × day) pairs per run to stay within Vercel function timeout.

Add to `vercel.json` crons:
```json
{ "path": "/api/cron/summarize-news-timeline", "schedule": "0 */4 * * *" }
```

---

## TICKET-06 · API: New `GET /api/news-timeline` endpoint

**Type:** Backend — new API route  
**Blocked by:** TICKET-02, TICKET-03

### What to do
Create `app/api/news-timeline/route.ts`.

Query params:
- `companyId` (required)
- `entityId` (optional, filters to one entity)
- `window` — `7d` (default) | `30d` | `90d`

Response shape:
```ts
{
  feeds: Array<{
    feedId: string;
    feedLabel: string;
    entityId: string;
    entityLabel: string;
    days: Array<{
      date: string;           // YYYY-MM-DD
      aiSummary: string | null;
      sentimentScore: number | null;
      sentimentLabel: string | null;
      itemCount: number;
    }>;
  }>;
}
```

Logic:
- Join `rss_feeds` → `trackedEntities` → filter by companyId / entityId.
- Join `news_timeline_days` for the requested date window.
- Return feeds sorted by label; days sorted descending.

---

## TICKET-07 · Frontend: News Timeline section on Narratives page

**Type:** Frontend  
**Blocked by:** TICKET-06

### Reference design files
The design was prototyped in Claude Design and exported as the following files —
copy these directly into the codebase and wire them to real API data:

| File | Destination |
|------|-------------|
| `timeline.css` | `app/narratives/timeline.css` (import in the page) |
| `timeline_core.jsx` | Port to `components/news-timeline/timeline_core.tsx` |
| `TimelineTrack.jsx` | Port to `components/news-timeline/TimelineTrack.tsx` |
| `NarrativesPage.jsx` | Use as the reference for what to add to `app/narratives/page.tsx` |
| `news_data.js` | Use **only** during development to stub the API — remove before ship |

The `.jsx` files use plain React globals (`window.NarrativesPage`, `Object.assign(window, ...)`).
When porting to Next.js, convert to named ES module exports and replace `React.Fragment` / 
`React.useState` etc. with normal imports from `"react"`.

---

### Component architecture (from design)

**`timeline_core.tsx`** — pure helpers, no DOM. Export:
- Constants: `NTL_WINDOWS`, `NTL_COLW`, `NTL_BAND_H`, `NTL_CHIP_LANE`
- Helpers: `windowSlice`, `feedStats`, `scoreToY`, `dotRadius`, `fmtScore`,
  `fmtDayMon`, `fmtFullDate`, `sentSlug`, `expandedCount`
- Components: `SentPill`, `TimelineAxis`, `GridLines`, `HoverPop`

**`TimelineTrack.tsx`** — feed-level components. Export:
- `FeedHeader` — sticky-left 224 px panel with feed label, entity badge, avg
  sentiment score + trend glyph, sentiment pill, item count, active days.
- `FeedRail` — horizontally scrollable chart band with:
  - Bipolar SVG area + polyline (score range −1..1, zero baseline at midpoint)
  - Dots sized by `itemCount`, colored by sentiment slug
  - Chip lane above the band: summary cards with stems pointing to each dot
    (shown only for recent days per the `density` setting)
  - Null ticks (small dash) for days with no data
- `CombinedTimeline` — overlaid multi-feed view; each feed gets a distinct
  stroke color from `NTL_FEED_COLOR`
- `VerticalView` — newest-first vertical list; one row per day with spine,
  node dot, sentiment pill, score, item count, and summary text

---

### Layout / arrangement / density modes

| Setting | Values | Default |
|---------|--------|---------|
| style (layout) | `trend` (area + line + dots), `rail` (flat dots), `vertical` | `trend` |
| arrangement | `stacked` (each feed separate), `combined` (overlaid), `tabs` (one at a time) | `stacked` |
| density | `recent` (chip for last 7 days), `all` (chip every day), `minimal` (dots only) | `recent` |

These are local UI state — do **not** persist to URL or DB. A simple `useState` object is fine.

---

### Toolbar (add to existing Narratives toolbar row)
```
Window:  [7 days] [30 days] [90 days]   (segmented, monospace)
Feed:    [All 4]  [Sam Altman] [ChatGPT] [OpenAI] [Greg Brockman]
                                                  (segmented, pill-style)
```
The feed segmented control is built from the `feedLabel` values returned by
`/api/news-timeline`. "All" shows all feeds stacked. A single feed button
activates tab/focus mode.

---

### Section shell
Wrap the entire timeline in `.ntl-section` (see `timeline.css`):
- `border: 1px solid var(--border)`, `border-radius: var(--r-3)`,
  `background: var(--paper-2)` — visually distinct from cluster cards below.
- Section bar: `◈ News Timeline · Google Alerts` eyebrow + right-aligned meta
  "avg sentiment per day · −1.00 to +1.00".
- Legend row beneath the bar: Positive · Negative · Mixed · Neutral · No data,
  plus right-aligned note: "dot size = items that day · raw articles purged after 7d,
  summaries kept".

---

### Data wiring
Fetch from `/api/news-timeline?companyId=...&window=7d` (respect the `entityId`
filter from the existing entity dropdown at the top of the page).

API response shape (matches `news_data.js` and TICKET-06):
```ts
{
  feeds: Array<{
    feedId: string;
    feedLabel: string;
    entityId: string;
    entityLabel: string;
    entityType: string;       // "keyword" | "executive" | "product"
    days: Array<{             // ascending, oldest → newest
      date: string;           // "YYYY-MM-DD"
      aiSummary: string | null;
      sentimentScore: number | null;   // −1..+1
      sentimentLabel: string | null;   // "positive"|"negative"|"mixed"|"neutral"
      itemCount: number;
    }>;
  }>;
}
```

The window slice (last N days) is computed **client-side** from the full 90-day
response using `windowSlice()` — no need to re-fetch when toggling windows.
Fetch once on mount (or when `companyId`/`entityId` changes).

---

### Sentiment color tokens (add to `colors_and_type.css` or global CSS)
```css
:root {
  --nd-positive: var(--pos);    /* green */
  --nd-negative: var(--neg);    /* red */
  --nd-mixed:    var(--warn);   /* amber */
  --nd-neutral:  var(--ink-50);
}
```

---

### What this replaces / does NOT replace
- Rendered **above** the existing cluster narrative list on `app/narratives/page.tsx`.
- Does **not** remove or modify any existing narrative cluster components.
- No signal/noise marking, no "Run classify", no report generation — this section
  is strictly read-only news context.

---

## TICKET-08 · Cron: Purge `google_alerts` raw items older than 7 days

**Type:** Backend — new cron  
**Blocked by:** nothing (can be done now)

### What to do
Create `app/api/cron/purge-news-items/route.ts`:

```ts
// Hard-delete ingested_items where platform = 'google_alerts'
// and created_at < now() - interval '7 days'
await db.delete(ingestedItems).where(
  and(
    eq(ingestedItems.platform, "google_alerts"),
    lt(ingestedItems.createdAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))
  )
);
```

- Run **after** `summarize-news-timeline` has had a chance to process the items
  (i.e. schedule this later in the day than TICKET-05's cron).
- The `news_timeline_days` summaries are **not touched** — they are the permanent record.
- `cluster_items` rows referencing deleted items will cascade-delete automatically
  (FK has `onDelete: "cascade"`), so no extra cleanup needed there.

Add to `vercel.json`:
```json
{ "path": "/api/cron/purge-news-items", "schedule": "0 6 * * *" }
```

### Important ordering within a day
`summarize-news-timeline` runs every 4 hours. The purge runs once at 06:00 UTC.
This guarantees items are summarized before deletion as long as the summarize cron
has run at least once in the preceding 7 days (it will have).

---

## TICKET-09 · Pipeline: Exclude `google_alerts` items from embed + cluster crons

**Type:** Backend  
**Blocked by:** nothing (can be done now)

### What to do
1. `app/api/cron/embed/route.ts` — add a `ne(ingestedItems.platform, 'google_alerts')`
   filter to the query that fetches un-embedded items.
2. `app/api/cron/cluster/route.ts` — add the same platform exclusion filter so
   Google Alerts items are never candidates for clustering.
3. `app/api/run/embed/route.ts` and `app/api/run/cluster/route.ts` — apply the same
   exclusion filters for the manual-trigger endpoints.
4. Existing `google_alerts` rows already in `cluster_items` do not need to be
   removed (leave historical data). Just stop adding new ones.

---

## TICKET-10 · Deprecate: Remove `summarize-narratives` Google Alerts bleed-through

**Type:** Backend cleanup  
**Blocked by:** TICKET-09

### What to do
In `app/api/cron/summarize-narratives/route.ts`, the query that fetches items for
each cluster joins `ingestedItems`. Add a filter to exclude
`platform = 'google_alerts'` from the titles used to generate period narratives.
This prevents news wire copy from polluting opinion-based narrative summaries.

---

## TICKET-11 · Track page: RSS feed management UI

**Type:** Frontend  
**Blocked by:** TICKET-01

### What to do
Update `app/track/page.tsx` (or wherever entities are configured) to replace the
single "Google Alerts feed URL" field with a multi-feed manager:

- List existing `rss_feeds` rows for the entity.
- "Add RSS feed" button → inline form with `label` (text) + `feed_url` (text).
- Delete button per feed row.

New API routes needed:
- `GET /api/rss-feeds?entityId=...` — list feeds for entity.
- `POST /api/rss-feeds` — `{ entityId, label, feedUrl }` → insert.
- `DELETE /api/rss-feeds/[id]` — delete feed row.

---

## TICKET-12 · DB cleanup: Backfill `rss_feed_id` on existing `google_alerts` items

**Type:** Database / data migration  
**Blocked by:** TICKET-01, TICKET-03

### What to do
Write a one-off migration script (or a `/api/migrate` endpoint) that:
1. For each row in `ingested_items` where `platform = 'google_alerts'` and
   `rss_feed_id IS NULL`:
   - Look up `rss_feeds` by `entity_id = ingested_items.entity_id`.
   - If exactly one feed exists for that entity, set `rss_feed_id`.
   - If multiple feeds exist (won't happen post-migration, but defensive), set to
     the first one by `created_at`.
2. Log how many rows were updated.

This ensures historical items are queryable by the new timeline endpoint.
Note: given the 7-day retention policy (TICKET-08), this backfill only matters for
items ingested in the last 7 days. Run it immediately after TICKET-01 and TICKET-03
ship.

---

## Summary of dependency order

```
TICKET-01 (rss_feeds table)
  └─ TICKET-02 (news_timeline_days table)
  └─ TICKET-03 (ingested_items.rss_feed_id)
       └─ TICKET-04 (updated collector)
            └─ TICKET-05 (new cron: summarize-news-timeline)
            └─ TICKET-06 (new API: /api/news-timeline)
                 └─ TICKET-07 (frontend: News Timeline UI)
       └─ TICKET-12 (backfill existing items)
  └─ TICKET-11 (Track page: RSS feed UI)

TICKET-08 (7-day purge cron) — independent, ship immediately
TICKET-09 (exclude from embed/cluster) — independent, ship immediately
  └─ TICKET-10 (summarize-narratives cleanup)
```

Start with **TICKET-08** and **TICKET-09** (no dependencies) and **TICKET-01**
all in parallel. TICKET-08 is the most urgent — it stops accumulating raw news
articles in the DB right away.
