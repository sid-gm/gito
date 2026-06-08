# GX-3: Bulk URL Import

**Type:** Full-stack  
**Depends on:** GX-1 (uses the same `upsertItems` pipeline; no extension needed)  
**Files touched:**
- `app/analyst/submit/page.tsx` — add "Bulk" tab
- `app/api/items/manual/parse-url/route.ts` (new)

---

## Context

The analyst currently pastes one URL at a time into the submit form. After collecting 10–20 URLs from a search session, they spend 15+ minutes submitting them one by one. This ticket adds a "Bulk import" tab: paste a list of URLs, Gito fetches metadata for each, shows a checklist, and submits all at once.

No social APIs used. Reddit items use the existing `.json` trick. For X, Threads, and Instagram, the server fetches the public HTML page and extracts `og:` meta tags — these are rendered server-side for SEO and work without a headless browser.

---

## New API route: `POST /api/items/manual/parse-url`

**Request:** `{ url: string }`

**Response:**
```ts
{
  ok: boolean;
  url: string;
  platform: "twitter" | "reddit" | "threads" | "instagram" | "unknown";
  title: string | null;
  body: string | null;
  author: string | null;
  publishedAt: string | null;
  externalId: string | null;
  subtype: string | null;
  error?: string;   // present if fetch failed
}
```

**Platform detection and fetch strategy:**

```ts
function detectPlatform(url: string) {
  if (/x\.com|twitter\.com/.test(url)) return "twitter";
  if (/threads\.net/.test(url)) return "threads";
  if (/reddit\.com/.test(url)) return "reddit";
  if (/instagram\.com/.test(url)) return "instagram";
  return "unknown";
}
```

**Reddit:** Convert to `.json` URL (same as existing `toRedditJsonUrl` in `submit/page.tsx`). Fetch and extract `data.children[0].data`: `title`, `selftext` (body), `author`, `created_utc`, `id` (externalId).

**X / Threads / Instagram / unknown:** Simple `fetch(url, { headers: { "User-Agent": "Twitterbot/1.0" } })` to get server-rendered HTML (the Twitterbot UA encourages og tag rendering). Extract:
- `og:title` → title
- `og:description` → body
- `og:url` → canonical URL (use instead of input URL if present)

For X specifically, also attempt to extract author from URL path: `/([^/]+)/status/` → author.

For Threads, extract externalId from `/post/([A-Za-z0-9_-]+)`.

**Error handling:** If fetch fails or times out (5s timeout), return `{ ok: false, error: "Could not fetch URL" }`. Never throw — always return a response. The frontend will show a "failed" state for that URL.

**Do not call this route server-side for X, Threads, or Instagram if the URL would require a JS-rendered page.** These platforms' og tags are SEO-rendered so a plain fetch works, but if the response contains no og tags, return `{ ok: true, title: null, body: null, ... }` and let the analyst fill in manually.

---

## Submit page — "Bulk" tab

Add a second tab to `app/analyst/submit/page.tsx` alongside the existing single-item form.

### Tab switcher

At the top of the page, add:
```tsx
<div className="tab-bar">
  <button className={cx("tab", mode === "single" && "active")} onClick={() => setMode("single")}>Single</button>
  <button className={cx("tab", mode === "bulk" && "active")} onClick={() => setMode("bulk")}>Bulk import</button>
</div>
```

Single mode = existing form, unchanged.

### Bulk mode UI

**Step 1: URL entry**

```tsx
<textarea
  placeholder={"Paste URLs here, one per line:\nhttps://x.com/...\nhttps://reddit.com/r/...\nhttps://www.threads.net/..."}
  rows={8}
  value={rawUrls}
  onChange={(e) => setRawUrls(e.target.value)}
/>
<button onClick={handleParse} disabled={parsing}>
  {parsing ? "Fetching…" : "Fetch & preview"}
</button>
```

`handleParse`: split `rawUrls` by newline, deduplicate, filter valid URLs (up to 30 max — show a warning if more). Call `POST /api/items/manual/parse-url` for each URL **in parallel** (Promise.all). Show a progress indicator ("Fetching 12 of 30…").

**Step 2: Review checklist**

After fetching, show a table of results:

| ✓ | Platform | Author | Title (truncated 80 chars) | Status |
|---|----------|--------|---------------------------|--------|
| ☑ | 🐦 X | @kartik | "I'm sorry but if Pratt doesn't…" | Ready |
| ☑ | 📘 Reddit | u/throwaway | "Getting to the bottom of…" | Ready |
| ☐ | 🔴 Error | — | https://x.com/... | Failed to fetch |

- All "Ready" rows checked by default; "Failed" rows unchecked
- Analyst can uncheck items to exclude
- "Failed" rows: show the URL with a small "Edit manually" link that opens the single-item form pre-filled with the URL

**Entity selector** (single dropdown, applies to all selected items):
- Same entity dropdown as the single-item form
- "Auto-match by keyword" option (default) — uses the server-side keyword matching in GX-1's bulk endpoint
- Or pick a specific entity to force-assign all

**Step 3: Submit**

```tsx
<button onClick={handleBulkSubmit} disabled={submitting || checkedItems.length === 0}>
  Import {checkedItems.length} item{checkedItems.length !== 1 ? "s" : ""}
</button>
```

Calls `POST /api/items/manual/bulk` (already exists) with:
```ts
{
  items: checkedItems.map(item => ({
    url: item.url,
    title: item.title ?? item.url,
    body: item.body,
    author: item.author,
    publishedAt: item.publishedAt,
    externalId: item.externalId,
    subtype: item.subtype,
  })),
  entityId: entityId !== "auto" ? entityId : undefined,
  companyId,
  matchEntities: entityId === "auto",
}
```

On success: show "✓ Imported N items" banner and reset to Step 1.

---

## State machine

```ts
type BulkState = 
  | { step: "entry" }
  | { step: "fetching"; total: number; done: number }
  | { step: "review"; results: ParsedUrl[] }
  | { step: "submitting" }
  | { step: "done"; inserted: number };
```

---

## Acceptance Criteria

- [ ] "Bulk import" tab appears on submit page, switching does not reset single-item form state
- [ ] Up to 30 URLs accepted; warning shown if more pasted
- [ ] Reddit URLs return title + body via `.json` endpoint
- [ ] X / Threads URLs return at least a title via `og:title` 
- [ ] Failed URLs shown with "Failed to fetch" badge, unchecked by default
- [ ] Entity auto-match and explicit entity selection both work
- [ ] Submitting calls existing `/api/items/manual/bulk` endpoint
- [ ] Success state shows item count and resets form
