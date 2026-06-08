# Reddit Post: "Ingest Thread" Button on Feed

## Background

When a Reddit post gets ingested via RSS (platform = 'reddit', subtype = 'reddit_post'), we only have the post title/body — no comments. The existing `ThreadIngestDialog` component + `POST /api/items/manual/reddit-thread` route already handles ingesting a full comment thread (user pastes the URL, comments are parsed from Reddit's `.json` API).

This ticket wires up a button directly on the feed card for Reddit posts so users can one-click open the `ThreadIngestDialog` pre-filled with that post's URL.

---

## What exists

- `components/ThreadIngestDialog.tsx` — full dialog that accepts a Reddit URL, fetches comments via `{url}.json`, and posts to the ingest API. Already handles auto-detection of Reddit URLs.
- `POST /api/items/manual/reddit-thread` — ingests thread + comments, creates a cluster with sentiment.
- Feed cards somewhere in `components/` or `app/feed/` render `ingested_items`.

---

## Change: Feed card for Reddit posts

Locate the feed item card component. For items where `platform === 'reddit'` and `subtype === 'reddit_post'`:

Add an **"Ingest Thread"** button (secondary/ghost style) to the card's action area.

On click:
- Open `ThreadIngestDialog` with `defaultUrl` pre-filled from `item.url`
- The dialog already handles fetching comments and submitting — no changes needed to the dialog itself

The button should only appear for `reddit_post` subtypes (not `reddit_comment` or `reddit_thread` items which are already ingested threads).

---

## UX details

- Button label: **"Ingest Thread"** with a small comment/thread icon
- Placement: alongside any existing actions on the card (e.g. next to "View" or source link)
- After successful ingest, show a brief inline success state on the button (e.g. "Ingested ✓") — the dialog's own `onInserted` callback handles the toast/confirmation, so just close and update button state
- If the thread URL has already been ingested (the ingest API returns a 409 or the cluster already exists), the button should reflect that — show "Thread Ingested" in a disabled/muted state

---

## Detecting already-ingested threads

To show the disabled state without an extra fetch on every card render, check client-side: if `ingested_items` already contains a row with `externalId === item.url` and `subtype === 'reddit_thread'`, mark it ingested. 

The simplest approach: when the feed loads items, include a flag `threadIngested: boolean` computed server-side in the feed API response for reddit post items.

In the feed API route, for items where `platform = 'reddit'` and `subtype = 'reddit_post'`, do a single bulk check:
```sql
SELECT external_id FROM ingested_items
WHERE subtype = 'reddit_thread'
AND external_id = ANY(:postUrls)
```
Return the flag alongside the item data.

---

## Acceptance Criteria

- [ ] "Ingest Thread" button appears on feed cards for `platform = 'reddit'` + `subtype = 'reddit_post'` items only
- [ ] Clicking opens `ThreadIngestDialog` pre-filled with the post URL
- [ ] Successful ingest closes dialog and updates button to "Thread Ingested" (disabled)
- [ ] Button shows "Thread Ingested" (disabled) on initial render if thread was previously ingested
- [ ] No button appears on `reddit_comment` or `reddit_thread` subtypes
- [ ] No changes needed to `ThreadIngestDialog` or the ingest API route

---

## Notes

- The `ThreadIngestDialog` already calls `toRedditJsonUrl()` internally to convert the post URL to `.json` for comment fetching — pre-filling the URL is sufficient.
- Keep the button subtle — this is a power-user action, not a primary CTA on every card.
- If the feed uses virtualization, make sure the dialog portal renders outside the virtualized list.
