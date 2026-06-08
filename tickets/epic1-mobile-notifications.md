# Epic 1 — Mobile Notifications

**Goal:** Receive a notification on your phone when:
1. A new X or Reddit post is ingested for any tracked figure
2. Every 3 hours — a summary of Google Alerts headlines (not individual articles)

**Approach: Telegram Bot**

Free forever. No app to build. No account tiers. One `fetch` call. Notifications land on your phone instantly through the Telegram app, which looks and feels like a text message.

### One-time setup (do this before writing any code — takes 2 minutes)
1. Install Telegram on your phone if you don't have it.
2. Message **@BotFather** on Telegram → `/newbot` → follow prompts → copy the **bot token**.
3. Message your new bot once (just say hi) to open the chat.
4. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser → copy the `chat.id` from the response.
5. Add to Vercel env vars (and `.env.local`):
   ```
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_CHAT_ID=...
   ```

That's the entire setup. No dashboard, no SDK, no device registration.

---

## E1-T1 · Backend: Telegram notification helper

**Type:** Backend — new file  
**Blocks:** E1-T2, E1-T3

### What to do

Create `lib/notifications/telegram.ts`:

```ts
export async function sendNotification(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return; // silently skip if not configured

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",  // allows <b>bold</b> in messages
      }),
    });
  } catch (err) {
    console.error("[telegram] notification failed:", err);
    // Never throw — a notification failure should not crash an ingest job
  }
}
```

Add `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `.env.example` with empty values.

No DB changes. No migration. No registration endpoint.

---

## E1-T2 · Ingest trigger: Notify on new X and Reddit items

**Type:** Backend  
**Blocked by:** E1-T1

### What to do

After each successful ingest in the X and Reddit crons, call `sendNotification` if new items were inserted.

**X — `app/api/cron/twitter/route.ts`:**
```ts
import { sendNotification } from "@/lib/notifications/telegram";

// After inserting items, if any were new:
if (newItems.length > 0) {
  const label = entity.label;
  if (newItems.length === 1) {
    const item = newItems[0];
    await sendNotification(
      `<b>New X post · ${label}</b>\n${item.title ?? item.body?.slice(0, 140) ?? ""}${item.url ? `\n${item.url}` : ""}`
    );
  } else {
    await sendNotification(
      `<b>${newItems.length} new X posts · ${label}</b>`
    );
  }
}
```

**Reddit — `app/api/cron/reddit-rss/route.ts`:**
Same pattern. Reddit post titles are descriptive enough to use as the message body.

**Guards:**
- Only fire if `inserted > 0` — skip duplicate-skips entirely.
- Check company's `backfillStatus` (from E3-T1) — if `'pending'` or `'processing'`, skip. Don't notify on historical data dumps.
- If more than 5 new items in a single cron run, send one batched message instead of 5 individual ones.

---

## E1-T3 · Cron: 3-hour Google Alerts digest

**Type:** Backend — new cron  
**Blocked by:** E1-T1

### What to do

Create `app/api/cron/notify-google-alerts-digest/route.ts`.

Logic:
1. Query `news_timeline_days` where `period_date = today (UTC)` and `generated_at > now() - interval '3 hours'`.
2. If nothing is fresh, return early — no message sent.
3. Build a digest message grouped by feed label:
   ```
   <b>Google Alerts Digest</b>

   • <b>Sam Altman</b> — 8 articles, mostly negative
   • <b>ChatGPT</b> — 14 articles, mixed
   • <b>OpenAI</b> — 6 articles, positive
   ```
   Pull `itemCount` and `sentimentLabel` from `news_timeline_days`. Keep the whole message under 300 chars.
4. Call `sendNotification(message)`.
5. **Dedup guard:** To avoid sending the same digest twice, track the last sent time. Simplest approach — store a `last_digest_notified_at` timestamp in a single-row config using a new `app_config` table, or just check if any `news_timeline_days.generated_at` is newer than 2.5 hours ago (i.e. only fire if there's actually new data since the last window).

Add to `vercel.json`:
```json
{ "path": "/api/cron/notify-google-alerts-digest", "schedule": "30 */3 * * *" }
```

The `30` minute offset ensures `summarize-news-timeline` (which runs at `0 */4 * * *`) has had time to generate fresh summaries before the digest fires.

---

## Dependency order

```
E1-T1 (Telegram helper — 20 lines, no DB)
  ├─ E1-T2 (X + Reddit ingest trigger)
  └─ E1-T3 (Google Alerts digest cron)
```

**E1-T2 and E1-T3 are fully independent** once E1-T1 exists. Total lift: ~3 files, no migrations, no new services to sign up for beyond a free Telegram account.
