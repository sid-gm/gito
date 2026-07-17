// Platform DOM collectors — protocol v2.
// Every collector returns items in the shape POST /api/items/extension-ingest
// expects: kind post/comment, honest timestamps (never faked), engagement
// snapshots, and parent/root external ids for structural threading.

export type SocialPlatform = "twitter" | "threads" | "reddit" | "instagram" | "facebook" | "linkedin";

export type SourceKind =
  | "keyword_search"
  | "subreddit_new"
  | "subreddit_hot"
  | "tracked_thread"
  | "profile"
  | "manual";

export interface Engagement {
  likes?: number;
  replies?: number;
  reposts?: number;
  upvotes?: number;
  views?: number;
}

export interface ExtensionItem {
  platform: SocialPlatform | "manual";
  kind: "post" | "comment";
  externalId?: string | null;
  url?: string | null;
  author?: string | null;
  title?: string | null; // real titles only (reddit); never body prefixes
  body?: string | null;
  publishedAt?: string | null;
  publishedAtPrecision?: "exact" | "approx" | "unknown";
  parentExternalId?: string | null;
  rootExternalId?: string | null;
  depth?: number | null;
  sourceKind: SourceKind;
  sourceRef?: string | null;
  engagement?: Engagement | null;
  topicId?: string | null;
}

export type PageHealth = "ok" | "http_403" | "logged_out" | "checkpoint";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Jittered scrolling — look like a slow human, not a crawler
export async function scrollPage(tabId: number, steps = 3, baseDelayMs = 1500): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { window.scrollBy(0, 600 + Math.floor(Math.random() * 300)); },
      args: [],
    });
    await delay(baseDelayMs + Math.floor(Math.random() * 800));
  }
}

export function waitForTabLoad(tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    function finish() {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }
    const timer = setTimeout(finish, timeoutMs);
    function onUpdated(id: number, info: chrome.tabs.TabChangeInfo) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        setTimeout(finish, 2000);
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export function dedupeItems(items: ExtensionItem[]): ExtensionItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.externalId
      ? `${i.platform}:${i.externalId}`
      : `${i.platform}:${i.url ?? ""}:${(i.body ?? "").slice(0, 80)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Health detection — is this page a login wall / 403 / checkpoint?
// ---------------------------------------------------------------------------

export async function detectPageHealth(tabId: number, platform: string): Promise<PageHealth> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (plat: string): string => {
      const bodyText = (document.body?.innerText ?? "").slice(0, 4000);
      const title = document.title ?? "";
      const path = window.location.pathname;

      if (/403 forbidden|access denied|blocked by network security/i.test(bodyText) || /^403/i.test(title)) {
        return "http_403";
      }
      if (/\/checkpoint\//.test(path) || /verify (your|it's) (identity|you)|suspicious activity|confirm your identity/i.test(bodyText)) {
        return "checkpoint";
      }

      if (plat === "twitter") {
        if (/\/i\/flow\/login/.test(path)) return "logged_out";
        const hasTweets = !!document.querySelector('article[data-testid="tweet"]');
        const loginWall = !!document.querySelector('a[href="/login"], [data-testid="loginButton"], [data-testid="login"]');
        if (!hasTweets && loginWall) return "logged_out";
      }
      if (plat === "threads") {
        if (/\/login/.test(path)) return "logged_out";
        const hasPosts = document.querySelectorAll('div[data-pressable-container="true"], div[role="article"], article').length > 0;
        if (!hasPosts && /log in|sign up/i.test(bodyText.slice(0, 600))) return "logged_out";
      }
      if (plat === "reddit") {
        if (/whoa there, pardner|blocked/i.test(bodyText) && !document.querySelector("shreddit-post, shreddit-comment")) {
          return "http_403";
        }
        if (/\/login/.test(path)) return "logged_out";
      }
      if (plat === "instagram") {
        if (/\/accounts\/login/.test(path)) return "logged_out";
        if (document.querySelector('input[name="username"]') && document.querySelector('input[name="password"]')) return "logged_out";
      }
      if (plat === "facebook") {
        if (/\/login/.test(path)) return "logged_out";
        if (document.querySelector("#email") && document.querySelector("#pass")) return "logged_out";
      }
      if (plat === "linkedin") {
        if (/\/authwall|\/login|\/uas\//.test(path)) return "logged_out";
      }
      return "ok";
    },
    args: [platform],
  });
  return (results[0]?.result ?? "ok") as PageHealth;
}

// ---------------------------------------------------------------------------
// X / Twitter
// ---------------------------------------------------------------------------

export async function collectX(term: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: (): any[] => {
      const parseCount = (t: string | null | undefined): number | undefined => {
        if (!t) return undefined;
        const m = t.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
        if (!m) return undefined;
        let n = parseFloat(m[1]);
        const u = (m[2] ?? "").toUpperCase();
        if (u === "K") n *= 1e3;
        if (u === "M") n *= 1e6;
        if (u === "B") n *= 1e9;
        return Math.round(n);
      };
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(articles).slice(0, 20).map((a: any) => {
        const body = a.querySelector('[data-testid="tweetText"]')?.textContent ?? "";
        const authorEl = a.querySelector('[data-testid="User-Name"] a[href*="/"]');
        const author = authorEl?.getAttribute("href")?.replace("/", "") ?? "";
        const publishedAt = a.querySelector("time")?.getAttribute("datetime") ?? null;
        const statusLink = a.querySelector('a[href*="/status/"]');
        const url = statusLink ? `https://x.com${new URL(statusLink.href).pathname}` : window.location.href;
        const externalId = url.match(/\/status\/(\d+)/)?.[1] ?? null;
        const engagement = {
          replies: parseCount(a.querySelector('[data-testid="reply"]')?.textContent),
          reposts: parseCount(a.querySelector('[data-testid="retweet"]')?.textContent),
          likes: parseCount(a.querySelector('[data-testid="like"]')?.textContent),
          views: parseCount(a.querySelector('a[href*="/analytics"]')?.textContent),
        };
        const hasEngagement = Object.values(engagement).some((v) => v != null);
        return {
          platform: "twitter",
          kind: "post",
          externalId,
          url,
          author: author ? `@${author}` : null,
          title: null,
          body,
          publishedAt,
          publishedAtPrecision: publishedAt ? "exact" : "unknown",
          engagement: hasEngagement ? engagement : null,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).filter((i: any) => (i.body ?? "").length > 0);
    },
    args: [],
  });
  void term;
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export async function collectXThread(postUrl: string, tabId: number, postExternalId?: string): Promise<ExtensionItem[]> {
  await scrollPage(tabId, 3, 1500);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: (pageUrl: string, rootId: string | null): any[] => {
      const parseCount = (t: string | null | undefined): number | undefined => {
        if (!t) return undefined;
        const m = t.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
        if (!m) return undefined;
        let n = parseFloat(m[1]);
        const u = (m[2] ?? "").toUpperCase();
        if (u === "K") n *= 1e3;
        if (u === "M") n *= 1e6;
        if (u === "B") n *= 1e9;
        return Math.round(n);
      };
      const urlRootId = rootId ?? pageUrl.match(/\/status\/(\d+)/)?.[1] ?? null;
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(articles).map((a: any) => {
        const body = a.querySelector('[data-testid="tweetText"]')?.textContent ?? "";
        if (!body) return null;
        const authorEl = a.querySelector('[data-testid="User-Name"] a[href*="/"]');
        const author = authorEl?.getAttribute("href")?.replace("/", "") ?? "";
        const publishedAt = a.querySelector("time")?.getAttribute("datetime") ?? null;
        const statusLink = a.querySelector('a[href*="/status/"]');
        const articleUrl = statusLink ? `https://x.com${new URL(statusLink.href).pathname}` : pageUrl;
        const articleId = articleUrl.match(/\/status\/(\d+)/)?.[1] ?? null;
        const isRoot = articleId === urlRootId;
        const engagement = {
          replies: parseCount(a.querySelector('[data-testid="reply"]')?.textContent),
          reposts: parseCount(a.querySelector('[data-testid="retweet"]')?.textContent),
          likes: parseCount(a.querySelector('[data-testid="like"]')?.textContent),
          views: parseCount(a.querySelector('a[href*="/analytics"]')?.textContent),
        };
        const hasEngagement = Object.values(engagement).some((v) => v != null);
        return {
          platform: "twitter",
          kind: isRoot ? "post" : "comment",
          externalId: articleId,
          url: articleUrl,
          author: author ? `@${author}` : null,
          title: null,
          body,
          publishedAt,
          publishedAtPrecision: publishedAt ? "exact" : "unknown",
          parentExternalId: isRoot ? null : urlRootId,
          rootExternalId: urlRootId,
          engagement: hasEngagement ? engagement : null,
        };
      }).filter(Boolean);
    },
    args: [postUrl, postExternalId ?? null],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export async function collectXProfile(handle: string, tabId: number): Promise<ExtensionItem[]> {
  // A profile timeline is structurally a search-results page of posts
  const items = await collectX(handle, tabId);
  return items;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function collectThreads(term: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: (): any[] => {
      // threads.com no longer marks posts with role="article"; fall back to
      // the pressable post containers that wrap each post in feeds/search.
      let posts: Element[] = Array.from(document.querySelectorAll('div[role="article"], article'));
      if (posts.length === 0) {
        posts = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'))
          .filter((el) => !el.parentElement?.closest('div[data-pressable-container="true"]'));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(posts).slice(0, 20).map((p: any) => {
        const body = p.textContent?.trim() ?? "";
        const author = p.querySelector('a[href^="/@"]')?.getAttribute("href")?.replace("/@", "") ?? null;
        const postLinkEl = p.querySelector('a[href*="/post/"]');
        const postUrl = postLinkEl
          ? `https://www.threads.net${postLinkEl.getAttribute("href")}`
          : window.location.href;
        const externalId = postUrl.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
        const publishedAt = p.querySelector("time")?.getAttribute("datetime") ?? null;
        return {
          platform: "threads",
          kind: "post",
          externalId,
          url: postUrl,
          author,
          title: null,
          body,
          publishedAt,
          publishedAtPrecision: publishedAt ? "exact" : "unknown",
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).filter((i: any) => (i.body ?? "").length > 20);
    },
    args: [],
  });
  void term;
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export async function collectThreadsThread(postUrl: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId, 3, 1500);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: (pageUrl: string): any[] => {
      const rootExternalId = pageUrl.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
      let articles = Array.from(document.querySelectorAll('div[role="article"], article'));
      if (articles.length === 0) {
        articles = Array.from(document.querySelectorAll('div[data-pressable-container="true"]'))
          .filter((el) => !el.parentElement?.closest('div[data-pressable-container="true"]'));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = [];
      let rootFound = false;

      for (const el of articles) {
        const bodyEl = el.querySelector("[data-pressable-container]");
        const body = (bodyEl?.textContent ?? el.textContent ?? "").trim();
        if (body.length < 5) continue;

        const author = el.querySelector('a[href^="/@"]')?.getAttribute("href")?.replace("/@", "") ?? null;
        const rawHref = el.querySelector('a[href*="/post/"]')?.getAttribute("href") ?? "";
        // Normalise to threads.net regardless of whether the page loaded as threads.com
        const articleUrl = rawHref ? `https://www.threads.net${rawHref}` : pageUrl;
        const externalId = articleUrl.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
        const publishedAt = el.querySelector("time")?.getAttribute("datetime") ?? null;

        const isRoot = !rootFound && (externalId === rootExternalId || !rootFound);
        if (isRoot) rootFound = true;

        items.push({
          platform: "threads",
          kind: isRoot ? "post" : "comment",
          externalId,
          url: articleUrl,
          author,
          title: null,
          body,
          publishedAt,
          publishedAtPrecision: publishedAt ? "exact" : "unknown",
          parentExternalId: isRoot ? null : rootExternalId,
          rootExternalId,
        });
      }
      return items;
    },
    args: [postUrl],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

// ---------------------------------------------------------------------------
// Reddit — DOM scraping on real tabs only, never the JSON API
// ---------------------------------------------------------------------------

// Works on r/<sub>/new/, r/<sub>/hot/, and /search/?q= pages — anywhere the
// new UI renders <shreddit-post> elements.
export async function collectRedditListing(tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: (): any[] => {
      const posts = document.querySelectorAll("shreddit-post");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return Array.from(posts).slice(0, 20).map((p: any) => {
        const externalId = p.getAttribute("id") ?? null; // t3_xxx
        const permalink = p.getAttribute("permalink");
        const url = permalink ? `https://www.reddit.com${permalink}` : window.location.href;
        const publishedAt = p.getAttribute("created-timestamp") ?? null;
        const score = parseInt(p.getAttribute("score") ?? "", 10);
        const commentCount = parseInt(p.getAttribute("comment-count") ?? "", 10);
        const body = p.querySelector('[slot="text-body"]')?.textContent?.trim() ?? null;
        return {
          platform: "reddit",
          kind: "post",
          externalId,
          url,
          author: p.getAttribute("author") ?? null,
          title: p.getAttribute("post-title") ?? null,
          body,
          publishedAt,
          publishedAtPrecision: publishedAt ? "exact" : "unknown",
          engagement:
            isNaN(score) && isNaN(commentCount)
              ? null
              : {
                  upvotes: isNaN(score) ? undefined : score,
                  replies: isNaN(commentCount) ? undefined : commentCount,
                },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }).filter((i: any) => i.externalId || i.title);
    },
    args: [],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

// A post's comments page: the root post + its visible comment tree,
// with reddit's thingid/postid/depth preserved for real threading.
export async function collectRedditThread(postUrl: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId, 3, 1500);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: (pageUrl: string): any[] => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const items: any[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const postEl: any = document.querySelector("shreddit-post");
      const rawId = pageUrl.match(/comments\/([a-z0-9]+)\//i)?.[1];
      const rootExternalId = postEl?.getAttribute("id") ?? (rawId ? `t3_${rawId}` : null);

      if (postEl) {
        const publishedAt = postEl.getAttribute("created-timestamp") ?? null;
        const score = parseInt(postEl.getAttribute("score") ?? "", 10);
        const commentCount = parseInt(postEl.getAttribute("comment-count") ?? "", 10);
        items.push({
          platform: "reddit",
          kind: "post",
          externalId: rootExternalId,
          url: pageUrl,
          author: postEl.getAttribute("author") ?? null,
          title:
            postEl.getAttribute("post-title") ??
            (document.querySelector('h1[slot="title"], [slot="title"] h1, h1') as HTMLElement | null)?.textContent?.trim() ??
            null,
          body: document.querySelector('shreddit-post-text-body [slot="text-body"]')?.textContent?.trim() ?? null,
          publishedAt,
          publishedAtPrecision: publishedAt ? "exact" : "unknown",
          engagement:
            isNaN(score) && isNaN(commentCount)
              ? null
              : {
                  upvotes: isNaN(score) ? undefined : score,
                  replies: isNaN(commentCount) ? undefined : commentCount,
                },
        });
      }

      const commentEls = document.querySelectorAll("shreddit-comment");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const el of Array.from(commentEls) as any[]) {
        const thingId = el.getAttribute("thingid");
        const postId = el.getAttribute("postid");
        if (rootExternalId && postId && postId !== rootExternalId) continue;

        const body = el.querySelector('[slot="comment"]')?.textContent?.trim();
        if (!body) continue;

        const depth = parseInt(el.getAttribute("depth") ?? "0", 10);
        const parentId = el.getAttribute("parentid");
        const permalinkAttr = el.getAttribute("permalink");
        const publishedAt = el.querySelector('[slot="commentMeta"] time')?.getAttribute("datetime") ?? null;
        const score = parseInt(el.getAttribute("score") ?? "", 10);

        items.push({
          platform: "reddit",
          kind: "comment",
          externalId: thingId ?? null,
          url: permalinkAttr ? `https://www.reddit.com${permalinkAttr}` : pageUrl,
          author: el.getAttribute("author") ?? null,
          title: null,
          body,
          publishedAt,
          publishedAtPrecision: publishedAt ? "exact" : "unknown",
          parentExternalId: parentId ?? (rootExternalId && depth === 0 ? rootExternalId : null),
          rootExternalId,
          depth: isNaN(depth) ? null : depth,
          engagement: isNaN(score) ? null : { upvotes: score },
        });
      }

      return items;
    },
    args: [postUrl],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}
