# GX-4: Chrome Extension — Scheduled Auto-Collect

**Type:** Chrome Extension (extends GX-2)  
**Depends on:** GX-1 (ingest API), GX-2 (extension base)  
**Files touched:**
- `gito-extension/background.ts` — add alarm-based scheduler
- `gito-extension/collector.ts` (new) — platform-specific page collectors
- `gito-extension/popup.ts` — add schedule config UI
- `gito-extension/manifest.json` — add `alarms` permission

---

## Context

GX-2 requires the analyst to be actively browsing and manually clicking. This ticket makes the extension work autonomously: it opens search pages in the background on a schedule, extracts visible posts, and pushes them to Gito — no analyst interaction required. The analyst opens Gito to find a fresh queue of posts already waiting.

This is only possible as a browser extension (not server-side) because X and Threads require JavaScript rendering. The extension IS the headless browser.

---

## How it works

Chrome's `chrome.alarms` API fires the background service worker on a repeating schedule. On each alarm:
1. Read configured search terms + platforms from `chrome.storage.sync`
2. For each search, open an offscreen tab (or use `chrome.scripting` on a new tab), navigate to the search URL, wait for content to render, extract posts, close the tab
3. POST extracted items to GX-1's `/api/items/extension-ingest`
4. Update badge count with new items found

---

## New manifest permission

```json
"permissions": ["contextMenus", "storage", "activeTab", "scripting", "alarms", "tabs"]
```

---

## Search config (stored in `chrome.storage.sync`)

```ts
type SearchConfig = {
  terms: string[];          // e.g. ["lurie", "daniel lurie", "SF mayor"]
  platforms: Array<"twitter" | "threads" | "reddit">;
  intervalMinutes: number;  // 30 | 60 | 120 | 240
  enabled: boolean;
};
```

Instagram excluded — their search is login-gated and DOM structure is inconsistent.

---

## Popup additions

Add a "Auto-collect" section below the connection settings:

```
Auto-collect
────────────
Search terms: [lurie, daniel lurie          ] (comma-separated)
Platforms:   [✓] X  [✓] Threads  [✓] Reddit
Interval:    [Every hour ▼]
             [Enable auto-collect  ●]
             
Last run: 14 min ago · 7 new items found
Next run: in 46 min
```

On toggle enable: `chrome.alarms.create("gito-collect", { periodInMinutes: config.intervalMinutes })`.  
On toggle disable: `chrome.alarms.clear("gito-collect")`.

---

## `collector.ts` — platform search URLs + DOM extractors

### X / Twitter

Search URL: `https://x.com/search?q=${encodeURIComponent(term)}&f=live`

Post extractor (same DOM approach as GX-2's `extractTweet`, but applied to all articles on the search results page):
```ts
async function collectX(term: string, tabId: number): Promise<ExtensionItem[]> {
  // inject content script into tab
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (searchTerm) => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      return Array.from(articles).slice(0, 20).map(a => {
        const body = a.querySelector('[data-testid="tweetText"]')?.textContent ?? "";
        const authorEl = a.querySelector('[data-testid="User-Name"] a[href*="/"]');
        const author = authorEl?.getAttribute("href")?.replace("/", "") ?? "";
        const timeEl = a.querySelector("time");
        const publishedAt = timeEl?.getAttribute("datetime") ?? null;
        const statusLink = a.querySelector('a[href*="/status/"]');
        const url = statusLink ? `https://x.com${statusLink.getAttribute("href")}` : window.location.href;
        const externalIdMatch = url.match(/\/status\/(\d+)/);
        return {
          url,
          title: body.slice(0, 200),
          body,
          author: `@${author}`,
          publishedAt,
          platform: "twitter" as const,
          subtype: "x_post",
          externalId: externalIdMatch?.[1] ?? null,
        };
      }).filter(i => i.body.length > 0);
    },
    args: [term],
  });
  return results[0]?.result ?? [];
}
```

### Threads

Search URL: `https://www.threads.net/search?q=${encodeURIComponent(term)}&serp_type=default`

```ts
async function collectThreads(term: string, tabId: number): Promise<ExtensionItem[]> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const posts = document.querySelectorAll('div[role="article"], article');
      return Array.from(posts).slice(0, 20).map(p => {
        const body = p.textContent?.trim() ?? "";
        const authorEl = p.querySelector('a[href^="/@"]');
        const author = authorEl?.getAttribute("href")?.replace("/@", "") ?? "";
        const url = window.location.href;
        const postLinkEl = p.querySelector('a[href*="/post/"]');
        const postUrl = postLinkEl ? `https://www.threads.net${postLinkEl.getAttribute("href")}` : url;
        const externalIdMatch = postUrl.match(/\/post\/([A-Za-z0-9_-]+)/);
        return {
          url: postUrl,
          title: body.slice(0, 200),
          body,
          author,
          publishedAt: null,
          platform: "threads" as const,
          subtype: "threads_post",
          externalId: externalIdMatch?.[1] ?? null,
        };
      }).filter(i => i.body.length > 20);
    },
  });
  return results[0]?.result ?? [];
}
```

### Reddit

Search URL: `https://www.reddit.com/search/?q=${encodeURIComponent(term)}&sort=new`

Reddit is server-rendered — use the JSON API instead of DOM scraping for reliability:

```ts
async function collectReddit(term: string): Promise<ExtensionItem[]> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(term)}&sort=new&limit=20`;
  const res = await fetch(url, { headers: { "User-Agent": "Gito-Extension/1.0" } });
  const json = await res.json();
  return json.data.children
    .filter((c: any) => c.kind === "t3")
    .map((c: any) => ({
      url: `https://www.reddit.com${c.data.permalink}`,
      title: c.data.title,
      body: c.data.selftext || null,
      author: c.data.author,
      publishedAt: new Date(c.data.created_utc * 1000).toISOString(),
      platform: "reddit" as const,
      subtype: "reddit_post",
      externalId: c.data.id,
    }));
}
```

Reddit's search JSON endpoint works without auth from an extension (same as the existing `.json` trick).

---

## Background service worker — alarm handler

```ts
// background.ts addition

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "gito-collect") return;
  
  const config: SearchConfig = await chrome.storage.sync.get(["terms", "platforms", "intervalMinutes", "enabled"]);
  if (!config.enabled || !config.terms?.length) return;
  
  const { gitoUrl, apiKey } = await chrome.storage.sync.get(["gitoUrl", "apiKey"]);
  if (!gitoUrl || !apiKey) return;

  const allItems: ExtensionItem[] = [];

  for (const term of config.terms) {
    for (const platform of config.platforms) {
      try {
        let items: ExtensionItem[] = [];
        
        if (platform === "reddit") {
          items = await collectReddit(term);
        } else {
          // Open tab, wait for render, collect, close
          const searchUrl = platform === "twitter"
            ? `https://x.com/search?q=${encodeURIComponent(term)}&f=live`
            : `https://www.threads.net/search?q=${encodeURIComponent(term)}`;
          
          const tab = await chrome.tabs.create({ url: searchUrl, active: false });
          await waitForTabLoad(tab.id!, 8000); // wait up to 8s
          
          items = platform === "twitter"
            ? await collectX(term, tab.id!)
            : await collectThreads(term, tab.id!);
          
          await chrome.tabs.remove(tab.id!);
        }
        
        allItems.push(...items);
      } catch (err) {
        console.error(`[Gito auto-collect] ${platform}/${term}:`, err);
      }
    }
  }

  if (allItems.length === 0) return;

  // Deduplicate by externalId + platform before sending
  const unique = dedupeByExternalId(allItems);
  
  const res = await fetch(`${gitoUrl}/api/items/extension-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ items: unique }),
  });
  
  const data = await res.json();
  const inserted = data.inserted ?? 0;
  
  // Update stats
  const today = new Date().toISOString().slice(0, 10);
  const stats = await chrome.storage.local.get(["dailyCount", "lastRun", "lastInserted"]);
  await chrome.storage.local.set({
    lastRun: new Date().toISOString(),
    lastInserted: inserted,
    dailyCount: stats.dailyCount?.date === today 
      ? { date: today, count: stats.dailyCount.count + inserted }
      : { date: today, count: inserted },
  });
  
  if (inserted > 0) {
    chrome.action.setBadgeText({ text: String(inserted) });
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 30000);
  }
});

function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    chrome.tabs.onUpdated.addListener(function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        // Extra wait for JS rendering
        setTimeout(resolve, 2000);
      }
    });
  });
}
```

---

## Dedup logic

```ts
function dedupeByExternalId(items: ExtensionItem[]): ExtensionItem[] {
  const seen = new Set<string>();
  return items.filter(i => {
    const key = i.externalId ? `${i.platform}:${i.externalId}` : `${i.platform}:${i.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
```

Server-side dedup (`onConflictDoNothing` in GX-1) is also in place as a safety net.

---

## Notes on tab opening

Opening background tabs may trigger browser anti-automation warnings on some platforms. To minimize this:
- Keep `active: false` on created tabs so they don't flash in the foreground
- Don't open more than 1 tab at a time (sequential, not parallel)
- Use a reasonable interval (minimum 30 min recommended in popup)
- Tabs are closed immediately after extraction

If the user is not logged into X or Threads in Chrome, the search pages will still load and show results — login is not required to view search results on either platform.

---

## Acceptance Criteria

- [ ] `alarms` and `tabs` permissions in manifest
- [ ] Popup shows search config fields (terms, platforms, interval, enable toggle)
- [ ] Enable toggle creates alarm; disable clears it
- [ ] On alarm fire: Reddit collected via JSON, X via tab+DOM, Threads via tab+DOM
- [ ] Items POSTed to `/api/items/extension-ingest` in bulk
- [ ] Badge shows count of newly inserted items for 30s after each run
- [ ] Popup shows "Last run: X min ago · N new items" and "Next run: in X min"
- [ ] Dedup prevents sending the same item twice within a run
- [ ] Tabs opened during collection are closed after use, even on error
- [ ] Consecutive failed runs (3+) disable auto-collect and show error state in popup
