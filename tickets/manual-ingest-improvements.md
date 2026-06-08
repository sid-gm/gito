# Manual Ingest Improvements (3 tickets)

These are all surgical changes to existing files. No new tables or migrations needed.

---

## MI-T1 · X thread replies — paste-mode ingest

**Type:** Full-stack  
**Files touched:**
- `app/submit/page.tsx`
- `app/api/items/manual/parse-x-thread/route.ts` (new)
- `app/api/items/manual/x-thread/route.ts` (new)

### Context
Reddit thread ingest works by either fetching the `.json` API or falling back to paste. X's API is fully locked down (paid), so paste-only is the approach. The Reddit paste parser at `app/api/items/manual/parse-reddit/route.ts` is the pattern to follow.

### Backend — `POST /api/items/manual/parse-x-thread`

Parse pasted X thread text. When you copy a thread from x.com, the clipboard produces **markdown-style links** for each element. The actual format (confirmed from real paste) looks like this:

```
[nico laqua](https://x.com/nico_laqua)
[@nico_laqua](https://x.com/nico_laqua)
·
[May 31](https://x.com/nico_laqua/status/2061339333639213162)
What makes yours better
[dany](https://x.com/danywander)
[@danywander](https://x.com/danywander)
·
[Jun 1](https://x.com/danywander/status/2061352286106882216)
everything
Show replies
[Turning Point Action](https://x.com/TPAction)
[@TPAction](https://x.com/TPAction)
Ad
...
```

Each tweet block follows this structure:
1. `[Display Name](profile_url)` — display name line
2. `[@handle](profile_url)` — handle line
3. `·` — literal separator
4. `[Date](status_url)` — date + the tweet's own URL
5. Tweet body text (one or more lines, until the next block starts)

**Parser logic:**

```ts
// Regex to extract markdown link text and href
const mdLink = /^\[(.+?)\]\((https?:\/\/.+?)\)$/;

// A tweet block starts when we see: mdLink (display name) → mdLink starting with @ (handle) → "·"
```

Extract from the status URL in line 4: the tweet's `externalId` is the full status URL (e.g. `https://x.com/nico_laqua/status/2061339333639213162`).

**Skip these lines/blocks:**
- Any block containing an `Ad` line immediately after the handle — this is a promoted tweet, discard the whole block
- Lines matching `Show replies`, `Show more`, `Show less`
- Lines matching `/^\d+ (Repost|Like|Reply|Bookmark|Quote)/i` (engagement counts)

**Output type:**
```ts
type ParsedTweet = {
  author: string;        // handle without @, e.g. "nico_laqua"
  displayName: string;   // e.g. "nico laqua"
  body: string;
  tweetUrl: string | null;   // the status URL extracted from the date link
  timestamp: string | null;  // the date text, e.g. "May 31" or "Jun 1"
  isOriginalPost: boolean;   // true for first non-ad block
}
```

### Backend — `POST /api/items/manual/x-thread`

Model this exactly after `app/api/items/manual/reddit-thread/route.ts` but:
- Use `platform: "twitter"` (not `"reddit"`)
- `subtype: "x_reply"` for replies, `"x_post"` for the OP tweet
- `externalId` pattern: `${threadUrl}#reply-${i}-${tweet.author}`
- Everything else is identical: insert thread item + reply items, create cluster, run sentiment

### Frontend — `app/page.tsx` (feed row action button)

The feed's `FeedRow` component (line 394) already has an "Ingest thread" button for Reddit posts, gated by `isRedditPost` (line 397). Add the same button for X posts.

**Add alongside the existing Reddit detection:**
```ts
const isRedditPost = item.platform === "reddit" && item.subtype === "reddit_post";
const isXPost = item.platform === "twitter" && (item.subtype === "x_post" || item.subtype == null);
const alreadyIngested = item.threadIngested ?? false;
```

**Add a parallel button in `feedrow-actions` (after line 458):**
```tsx
{isXPost && item.url && (
  <button
    className={cx("btn btn-ghost btn-sm", alreadyIngested && "btn-muted")}
    disabled={alreadyIngested}
    onClick={() => !alreadyIngested && onIngestThread?.(item.url!)}
    title={alreadyIngested ? "Replies already ingested" : "Ingest X replies"}
    style={{ fontSize: 11, opacity: alreadyIngested ? 0.45 : 1 }}
  >
    {alreadyIngested ? "Replies ingested" : "≡ Ingest X replies"}
  </button>
)}
```

This reuses the existing `onIngestThread` callback and `ThreadIngestDialog` machinery — the dialog already receives `defaultUrl` and will need to detect X URLs to show the paste panel instead of the Reddit fetch flow (see below).

**Update `ThreadIngestDialog.tsx`** to handle X URLs. Currently it only renders the Reddit fetch/paste UI. When `defaultUrl` is an X URL, it should skip the Reddit fetch button entirely and go straight to the X paste panel (the textarea + "Parse thread" button from MI-T1). The dialog title should change to "Ingest X replies" and the placeholder text should be X-specific.

The simplest approach: add `isXUrl(url)` detection at the top of the dialog alongside the existing `isRedditUrl(url)`, then branch the UI accordingly. The submit path calls `/api/items/manual/x-thread` instead of the bulk endpoint.

---

### Frontend — `app/submit/page.tsx`

The submit page already has a full Reddit comment panel (lines 284–404). Add a parallel X thread panel that appears when the URL is an X URL.

**Detection:**
```ts
function isXUrl(url: string): boolean {
  return /^https?:\/\/(x\.com|twitter\.com)\//i.test(url);
}
```

The X panel is paste-only (no "Fetch" button since the API is locked down). Show:
1. A `<textarea>` with placeholder "Copy the thread from X and paste here — select all content including replies"
2. "Parse thread" button → calls `/api/items/manual/parse-x-thread`
3. Same checklist preview UI as Reddit (author, body snippet, checkbox per tweet)
4. On submit: calls `/api/items/manual/x-thread` instead of `/api/items/manual/reddit-thread`

The `useThreadFlow` flag (line 185) should also be true when `isXUrl(form.url) && selectedTweets.length > 0`.

---

## MI-T2 · Block submission when no entities exist

**Type:** Frontend only  
**Files touched:** `app/submit/page.tsx`

### Context
Currently the entity selector (line 458–468) is optional — it defaults to `"none"`. If a company has no entities configured yet (e.g. a brand-new retroactive import), the item gets orphaned with no entity association, which means it won't cluster or appear in any narrative.

### What to do

In `submit/page.tsx`, after the `entities` state is loaded, add a guard:

```tsx
{entities.length === 0 && (
  <div className="banner" style={{ background: "...", borderColor: "var(--warn)" }}>
    <strong>No entities configured.</strong> You need at least one tracked entity before
    submitting. <a href="/track" className="ulink">Create an entity →</a>
  </div>
)}
```

And disable the submit button when `entities.length === 0`:
```ts
// In the submit button:
disabled={saving || entities.length === 0}
```

Also update the entity dropdown label and validation:
- Change `<option value="none">— None —</option>` to `<option value="none">— Select entity (required) —</option>`
- Add a red border on the select when `form.entityId === "none"` (same pattern already used in `ThreadIngestDialog.tsx` line 330)
- Block the submit button when `form.entityId === "none"` (the `handleSubmit` already passes `entityId` as undefined if "none", but we should make it an explicit UI block)

This applies to both the standard single-item flow and the thread flow.

---

## MI-T3 · Auto-extract @username from X URL

**Type:** Frontend only  
**Files touched:** `app/submit/page.tsx`

### What to do

Add a `useEffect` that fires when `form.url` changes. If the URL matches the X/Twitter post pattern, extract the username and populate `form.author` — but only if `form.author` is currently empty (don't overwrite a manually entered value).

```ts
useEffect(() => {
  const match = form.url.match(/^https?:\/\/(?:x|twitter)\.com\/([^\/]+)\/status\//i);
  if (match && !form.author) {
    set("author", `@${match[1]}`);
  }
}, [form.url]);
```

That's the entire change. The `@` prefix is added so it renders as `@splitbycomma` in the feed's author field, consistent with how Twitter handles are displayed elsewhere.

**Edge case:** If the user pastes an X URL and then manually edits the author field, the guard `!form.author` ensures their edit isn't overwritten if they change the URL again. Consider also clearing the auto-filled author if the URL is cleared:

```ts
useEffect(() => {
  if (!form.url) return;
  const match = form.url.match(/^https?:\/\/(?:x|twitter)\.com\/([^\/]+)\/status\//i);
  if (match && !form.author) {
    set("author", `@${match[1]}`);
  }
}, [form.url]);
```

No backend changes needed.

---

## Execution order

All three are independent — can be built in parallel. Suggested order if doing sequentially:

1. **MI-T3** — 10 lines of code, zero risk. Do this first.
2. **MI-T2** — frontend only, no new API. Do second.
3. **MI-T1** — two new API routes + frontend panel. Most effort, do last.
