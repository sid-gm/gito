# GX-2: Chrome Extension — Send to Gito

**Type:** Chrome Extension (standalone build, separate from Next.js app)  
**Depends on:** GX-1 (extension ingest API must be live)  
**Output:** `gito-extension/` directory in the repo root, buildable with `npm run build` → produces `dist/` folder for loading unpacked in Chrome

---

## Context

The analyst's current workflow for every post: copy text → switch to Gito tab → paste → fill fields → submit. This is 8–12 clicks and a tab switch per item. The extension eliminates this entirely: right-click selected text (or press the floating button) → item is in Gito. Zero context switching.

---

## Directory structure

```
gito-extension/
  manifest.json
  popup.html
  popup.ts
  content.ts          ← injected into every page, handles selection + DOM extraction
  background.ts       ← service worker, handles API calls + badge
  icons/
    icon16.png
    icon48.png
    icon128.png       ← use Gito's existing favicon or a simple "G" icon
```

Use vanilla TypeScript compiled with `esbuild`. No React needed — this is a simple UI.

---

## `manifest.json` (Manifest V3)

```json
{
  "manifest_version": 3,
  "name": "Gito — Send to Gito",
  "version": "1.0.0",
  "description": "One-click capture of social posts into Gito.",
  "permissions": ["contextMenus", "storage", "activeTab", "scripting"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [{
    "matches": ["https://x.com/*", "https://twitter.com/*", "https://www.threads.net/*",
                "https://www.reddit.com/*", "https://www.instagram.com/*"],
    "js": ["content.js"]
  }],
  "action": { "default_popup": "popup.html", "default_icon": "icons/icon48.png" }
}
```

---

## Popup (`popup.html` + `popup.ts`)

Two-state UI:

**Not configured:**
- Input: "Gito URL" (e.g. `https://your-gito.vercel.app`)
- Input: "API Key" (from GX-1's Sources page)
- Save button → `chrome.storage.sync.set({ gitoUrl, apiKey })`
- Help text: "Find your API key in Gito → Sources → Extension"

**Configured:**
- Shows domain and masked key (`gito_••••••••••••••••`)
- "Disconnect" button (clears storage)
- Stats: "X items sent today" (stored in `chrome.storage.local`, keyed by date)

---

## Content script (`content.ts`)

### Floating button on text selection

```ts
document.addEventListener("mouseup", () => {
  const selection = window.getSelection();
  if (!selection || selection.toString().trim().length < 20) {
    removeFloatingBtn();
    return;
  }
  showFloatingBtn(selection);
});
```

The floating button:
- Appears near the selection (use `getBoundingClientRect` on the range)
- "→ Gito" label, small pill style
- Click → calls `extractAndSend(selection.toString())`
- Auto-hides after 3s if no click, or on any scroll/click elsewhere

### Platform-aware DOM extraction

When the analyst is on a supported page, `extractAndSend` should attempt to extract richer metadata beyond just the selected text by reading the surrounding DOM. Fall back to raw selected text if DOM parsing fails.

```ts
function extractItem(selectedText: string): ExtensionItem {
  const url = window.location.href;
  
  if (/x\.com|twitter\.com/.test(url)) return extractTweet(selectedText);
  if (/threads\.net/.test(url)) return extractThreadsPost(selectedText);
  if (/reddit\.com/.test(url)) return extractRedditPost(selectedText);
  if (/instagram\.com/.test(url)) return extractInstagramPost(selectedText);
  
  return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "manual" };
}
```

**`extractTweet`:**
- Walk up from the selection anchor to find the closest `article[data-testid="tweet"]` element
- From that article: `[data-testid="tweetText"]` → body, `[data-testid="User-Name"] a` → author handle, `time` element `datetime` attr → publishedAt, `a[href*="/status/"]` → canonical URL
- `platform: "twitter"`, `subtype: "x_post"`
- `externalId`: extract from status URL `/status/(\d+)/`

**`extractThreadsPost`:**
- Closest `article` or `div[role="article"]` containing the selection
- Author: first `a[href^="/@"]` within the article → strip `/@`
- Body: `[data-pressable-container]` or just the selected text
- `platform: "threads"`, `subtype: "threads_post"`
- `externalId`: URL path segment after `/post/`

**`extractRedditPost`:**
- Closest `shreddit-post` or `div[data-post-id]`
- `platform: "reddit"`, `subtype: "reddit_post"`
- `externalId`: `t3_` post ID from URL or data attribute

**`extractInstagramPost`:**
- Selected text as body; author from `header a` in closest `article`
- `platform: "instagram"`, `subtype: "instagram_post"`
- `externalId`: `/p/([A-Za-z0-9_-]+)/` from URL

All extractors: if any field fails, leave it as `undefined` — the API handles nulls fine. The key invariant is that something always gets sent.

---

## Context menu

```ts
// background.ts
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "send-to-gito",
    title: "Send to Gito",
    contexts: ["selection"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "send-to-gito" || !tab?.id) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => window.__gitoSendSelection?.(),
  });
});
```

Content script exposes `window.__gitoSendSelection` which calls `extractAndSend` with the current selection.

---

## API call (`background.ts`)

Content script sends a message to the background worker to make the actual API call (avoids CORS issues with content script origin):

```ts
// content.ts
chrome.runtime.sendMessage({ type: "SEND_ITEM", payload: item });

// background.ts
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "SEND_ITEM") return;
  (async () => {
    const { gitoUrl, apiKey } = await chrome.storage.sync.get(["gitoUrl", "apiKey"]);
    if (!gitoUrl || !apiKey) {
      sendResponse({ ok: false, error: "Not configured" });
      return;
    }
    const res = await fetch(`${gitoUrl}/api/items/extension-ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ items: [msg.payload] }),
    });
    const data = await res.json();
    sendResponse({ ok: res.ok, data });
    if (res.ok) incrementDailyCount();
  })();
  return true; // keep channel open for async response
});
```

---

## Feedback to analyst

Content script shows a brief toast on success/failure:

```ts
function showToast(text: string, type: "success" | "error") {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:2147483647;
    background:${type === "success" ? "#16a34a" : "#dc2626"};
    color:#fff;padding:10px 16px;border-radius:8px;
    font-family:system-ui,sans-serif;font-size:13px;
    box-shadow:0 4px 12px rgba(0,0,0,0.15);
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}
```

Success: "✓ Sent to Gito"  
Error (not configured): "Configure Gito extension first"  
Error (API): "Failed to send — check API key"

---

## Build setup

`gito-extension/package.json`:
```json
{
  "scripts": {
    "build": "esbuild popup.ts content.ts background.ts --bundle --outdir=dist --target=chrome120"
  },
  "devDependencies": {
    "esbuild": "^0.20.0",
    "@types/chrome": "^0.0.268"
  }
}
```

Copy `manifest.json`, `popup.html`, `icons/` into `dist/` as part of build. A simple `build.sh` shell script is fine for this.

---

## Acceptance Criteria

- [ ] Extension loads unpacked in Chrome with no manifest errors
- [ ] Popup shows config form; saves gitoUrl + apiKey to `chrome.storage.sync`
- [ ] Floating "→ Gito" button appears on text selection (≥20 chars) on X, Threads, Reddit, Instagram
- [ ] Context menu "Send to Gito" appears on any text selection in Chrome
- [ ] On X: tweet author, body, URL, and timestamp extracted from DOM (not just raw selected text)
- [ ] On all other platforms: at minimum URL + selected text sent
- [ ] Success/error toast displayed after send
- [ ] `POST /api/items/extension-ingest` called with correct Authorization header
- [ ] Item appears in Gito feed within 2s of clicking the button
- [ ] Daily count incremented in popup stats
