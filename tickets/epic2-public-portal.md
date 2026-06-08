# Epic 2 — Public Portal vs Analyst Portal

**Goal:** usegito.com shows a curated, read-only public view of tracked companies with Global Narratives, Daily Reports, and Signal Briefs. The current analyst tool moves to a protected `/analyst` path. These are two distinct layouts and audiences.

---

## E2-T1 · Routing: Split analyst portal to `/analyst`, public view at `/`

**Type:** Frontend / routing  
**Blocks:** E2-T5

### What to do

1. Move the current app layout (`app/layout.tsx`, `app/narratives/page.tsx`, `app/track/page.tsx`, etc.) under `app/analyst/`. The Sidebar, CompanyContext, and all analyst pages live here.

2. Create a new `app/(public)/layout.tsx` — minimal layout, no sidebar, no auth hints. This is what usegito.com serves by default.

3. Update `app/page.tsx` (root) to redirect to `app/(public)/page.tsx` — the public landing/companies page.

4. **Auth consideration:** The `/analyst` routes should be access-controlled. For now, a simple env-var-gated middleware check (`ANALYST_PASSWORD` or an IP allowlist) is fine — do not build a full auth system yet. Use Next.js middleware to protect `/analyst/**`.

> The company selector in the public view works differently from the analyst tool — companies are listed as cards or tabs, not a dropdown. See E2-T5.

---

## E2-T2 · API: Public-safe cluster narratives endpoint

**Type:** Backend  
**Blocks:** E2-T5

### What to do

Create `GET /api/public/narratives?companyId=...`

This is a read-only, unauthenticated version of the existing clusters API, but:
- Only returns clusters where `classification = 'narrative'` (no noise, no unclassified)
- Only returns clusters with `narrativeStage` set
- Strips analyst-internal fields: `analystClassification`, `analystNote`, `analystSignal`, `classificationConfidence`
- Returns the top 10 clusters by `momentum DESC` for the company
- No pagination for now

Response shape:
```ts
{
  narratives: Array<{
    id: string;
    label: string;
    narrativeStage: NarrativeStage;
    narrativeSummary: string | null;
    momentum: number | null;
    velocity24h: number | null;
    sentimentLabel: string | null;
    sentimentScore: number | null;
    itemCount: number;
    firstSeenAt: string;
    lastSeenAt: string;
    platformCount: number | null;
  }>
}
```

---

## E2-T3 · API: Public daily report endpoint

**Type:** Backend  
**Blocks:** E2-T5

### What to do

Create `GET /api/public/daily-report?companyId=...`

Reuse the logic from `app/api/daily-report/route.ts` but:
- Strip any analyst-internal annotations
- Return the most recent daily report for the company
- If no report exists for today, return yesterday's (or null with a `generatedAt` timestamp)

This endpoint will be called on page load on the public portal — it should be fast (cached or pre-generated). Consider adding a `Cache-Control: s-maxage=3600` header so Vercel's CDN serves it without hitting the DB on every visit.

---

## E2-T4 · API: Signal Briefs endpoint

**Type:** Backend  
**Blocks:** E2-T5

### What to do

Create `GET /api/public/signal-briefs?companyId=...`

A "Signal Brief" is a snapshot of the highest-signal items from the last 24 hours — essentially the top items where `item_signal = 'signal'` across all clusters for a company.

Query:
```sql
SELECT ci.*, ii.title, ii.url, ii.platform, ii.publishedAt, ii.author,
       c.label as clusterLabel, c.narrativeStage
FROM cluster_items ci
JOIN ingested_items ii ON ii.id = ci.item_id
JOIN clusters c ON c.id = ci.cluster_id
WHERE c.entity_id IN (SELECT id FROM tracked_entities WHERE company_id = ?)
  AND ci.item_signal = 'signal'
  AND ii.published_at > NOW() - INTERVAL '24 hours'
ORDER BY ii.published_at DESC
LIMIT 20
```

Response shape:
```ts
{
  briefs: Array<{
    id: string;
    title: string;
    url: string | null;
    platform: string;
    publishedAt: string;
    author: string | null;
    clusterLabel: string | null;
    narrativeStage: string | null;
  }>
}
```

---

## E2-T5 · Frontend: usegito.com public page

**Type:** Frontend  
**Blocked by:** E2-T1, E2-T2, E2-T3, E2-T4

### What to do

Build `app/(public)/page.tsx` — the public face of Gito.

#### Layout

```
┌────────────────────────────────────────────┐
│  Gito  [Company tabs: OpenAI | Anthropic…] │
├────────────────────────────────────────────┤
│  GLOBAL NARRATIVES                         │
│  [Narrative cards — stage pill, summary,   │
│   sentiment, momentum bar]                 │
├────────────────────────────────────────────┤
│  DAILY REPORT                              │
│  [Generated-at timestamp + report text]    │
├────────────────────────────────────────────┤
│  SIGNAL BRIEFS · Last 24h                  │
│  [List of high-signal items with source,   │
│   cluster label, platform badge, time]     │
└────────────────────────────────────────────┘
```

#### Company tabs
- Fetch `GET /api/companies` (or a public equivalent).
- Render as pill-style tabs at the top. Selecting a tab re-fetches all three sections for that company. Default to the first company.
- URL state: `?company=<id>` so links are shareable.

#### Narrative cards
- Show narrative stage as a colored `StagePill` (reuse the existing component).
- Show `narrativeSummary` truncated to 2 lines with expand.
- Show momentum as a small bar or number.
- Sort: peaked → developing → emerging → relaxed → revival → declining.

#### Daily Report
- Render the report text as markdown (use `react-markdown` or just `dangerouslySetInnerHTML` with sanitization).
- Show `generatedAt` as a relative timestamp ("Updated 2 hours ago").

#### Signal Briefs
- Compact list. Platform icon + title + cluster badge + time ago.
- Link title to the original URL (open in new tab).
- If empty: "No high-signal items in the last 24 hours."

#### No analyst UI
- No "Run cluster", no signal/noise marking, no sources panel, no track page links.
- Read-only. The public user should feel like they're reading a live intelligence brief, not operating a tool.

---

## E2-T6 · SEO + shareable company URLs

**Type:** Frontend  
**Blocked by:** E2-T5

### What to do

Add `generateMetadata` to the public page so that when someone shares `usegito.com?company=<id>`, the OG preview shows:

```
Gito — OpenAI Intelligence Brief
Public narrative tracking for OpenAI · Updated 2 hours ago
```

Also add a canonical link and basic `robots.txt` that allows indexing of the public view and disallows `/analyst/**`.

This is a fast follow after E2-T5 ships — lower priority but important for the marketing use case.

---

## Dependency order

```
E2-T1 (routing split)          ─┐
E2-T2 (public narratives API)   ├─→ E2-T5 (public page) → E2-T6 (SEO)
E2-T3 (public daily report API) ┤
E2-T4 (signal briefs API)      ─┘
```

**E2-T1** is the most important to do first — it establishes the routing contract everything else builds on. **E2-T2, T3, T4** can be done in parallel. **E2-T5** is the integration point.
