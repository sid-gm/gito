# Epic 3 — Retroactive Company Creation

**Goal:** Allow a new company to be added with a retroactive history dump, so that stories that broke before Gito was watching can be clustered and analyzed. After the retroactive import, normal forward-looking tracking (keywords, RSS feeds) kicks in as usual.

---

## E3-T1 · DB: Add `ingest_mode` and `backfill_status` fields to `companies`

**Type:** Database migration  
**Blocks:** E3-T2, E3-T3

### What to do
Add two nullable columns to the `companies` table in `lib/db/schema.ts`:

```ts
ingestMode: text("ingest_mode"),       // 'live' | 'retroactive'
backfillStatus: text("backfill_status"), // null | 'pending' | 'processing' | 'done'
```

Write and run the Drizzle migration. These fields let the UI show a "retroactive import in progress" banner and let the clustering pipeline treat historical items differently (e.g. don't fire notifications on old items during backfill).

---

## E3-T2 · Frontend: Company creation wizard

**Type:** Frontend  
**Blocked by:** E3-T1  
**Blocks:** E3-T3

### What to do
Add a "New Company" button/flow to the app (likely in the Sidebar or a dedicated `/companies/new` route).

The wizard has **two steps**:

**Step 1 — Mode picker**
```
┌─────────────────────────────────────────────┐
│  How do you want to start tracking?         │
│                                             │
│  ○ From scratch                             │
│    Start capturing from today forward.      │
│                                             │
│  ○ Retroactively                            │
│    You have existing stories. Dump them in  │
│    and Gito will cluster and analyze them.  │
│    Then start tracking forward.             │
└─────────────────────────────────────────────┘
```

**Step 2a (From scratch)** — just company name + optional initial keyword/entity setup. Creates the company and lands on the `/track` page for that company to configure sources.

**Step 2b (Retroactive)** — company name, then routes to the bulk import flow (E3-T3). Set `ingestMode = 'retroactive'` and `backfillStatus = 'pending'` on the company row.

### API changes needed
- `POST /api/companies` already exists — extend the body schema to accept `ingestMode`.
- `PATCH /api/companies/[id]` — add endpoint to update `backfillStatus` (needed by E3-T3).

---

## E3-T3 · Frontend + API: Retroactive bulk import UI

**Type:** Full-stack  
**Blocked by:** E3-T2

### What to do

#### Frontend — `/companies/[id]/backfill` page

A page accessible after Step 2b of the wizard. It has:

1. **Instructions copy:** "Paste your stories below, one per row. Each story needs a headline and a date. Body text is optional but improves clustering."

2. **Input format** — a textarea or table where each row represents a story:
   - `date` (required) — ISO or human-readable, e.g. `2024-03-15`
   - `title` (required)
   - `body` (optional)
   - `url` (optional)
   - `source` (optional — e.g. "NYT", "Twitter", "Reddit")

   Support **two input modes** the user can toggle:
   - **Paste CSV/TSV** — pastes a spreadsheet dump with headers
   - **Manual entry** — add rows one by one with a form

3. **Preview table** — show parsed rows before submission with a row count and any parse errors highlighted.

4. **Submit button** — "Import [N] stories and cluster" — sends to the bulk ingest endpoint, then triggers clustering.

5. **Progress state** — after submission, show a status banner "Clustering your stories... this may take a minute." Poll `GET /api/companies/[id]` (or a new status endpoint) until `backfillStatus = 'done'`, then redirect to `/narratives` for that company.

#### Backend — extend `/api/items/manual/bulk`

The existing endpoint already accepts up to 500 items. For retroactive imports:
- Accept the optional `companyId` (already supported).
- After bulk insert, if the company's `ingestMode = 'retroactive'` and `backfillStatus = 'pending'`, automatically kick off clustering for those items by calling the clustering logic inline (or enqueue via a new endpoint).
- Set `backfillStatus = 'processing'` immediately, then `'done'` when clustering finishes.

#### New endpoint: `POST /api/companies/[id]/backfill-cluster`

Runs clustering scoped to items for this company that were ingested with `platform = 'manual'` and `publishedAt` in the past. Reuses `lib/ai/run-cluster.ts`. Sets `backfillStatus = 'done'` when complete.

> **Note on notifications:** The ingest cron triggers for X and Reddit should check `backfillStatus` — skip firing push notifications for items ingested during a retroactive backfill to avoid spamming your phone with historical data.

---

## E3-T4 · Frontend: Post-backfill onboarding → configure live tracking

**Type:** Frontend  
**Blocked by:** E3-T3

### What to do
After `backfillStatus = 'done'`, show a banner (or modal) on the `/narratives` page:

```
✓ Import complete — 47 stories clustered into 6 narratives.
  Now set up live tracking so Gito captures what happens next.
  [Configure keywords & sources →]
```

The CTA routes to `/track` for that company. No backend work needed — this is purely a UX handoff between the retroactive and live-tracking states.

---

## Dependency order

```
E3-T1 (DB: company fields)
  └─ E3-T2 (wizard UI)
       └─ E3-T3 (bulk import + backend clustering)
            └─ E3-T4 (post-backfill onboarding)
```

Start with **E3-T1** immediately — the migration is trivial and unblocks everything else. **E3-T3** is the biggest ticket and the core of this epic.
