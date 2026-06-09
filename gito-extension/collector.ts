export interface ExtensionItem {
  url: string;
  title: string;
  body: string | null;
  author: string;
  publishedAt: string | null;
  platform: "twitter" | "threads" | "reddit";
  subtype: string;
  externalId: string | null;
  parentExternalId?: string | null;
  rootExternalId?: string | null;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function scrollPage(tabId: number, steps = 3, delayMs = 1500): Promise<void> {
  for (let i = 0; i < steps; i++) {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => { window.scrollBy(0, 700); },
      args: [],
    });
    await delay(delayMs);
  }
}

export async function collectX(term: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (searchTerm: string): any[] => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      return Array.from(articles).slice(0, 20).map((a: any) => {
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
          platform: "twitter",
          subtype: "x_post",
          externalId: externalIdMatch ? externalIdMatch[1] : null,
        };
      }).filter((i: any) => i.body.length > 0);
    },
    args: [term],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export async function collectThreads(term: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (): any[] => {
      const posts = document.querySelectorAll('div[role="article"], article');
      return Array.from(posts).slice(0, 20).map((p: any) => {
        const body = p.textContent?.trim() ?? "";
        const authorEl = p.querySelector('a[href^="/@"]');
        const author = authorEl?.getAttribute("href")?.replace("/@", "") ?? "";
        const postLinkEl = p.querySelector('a[href*="/post/"]');
        const postUrl = postLinkEl
          ? `https://www.threads.net${postLinkEl.getAttribute("href")}`
          : window.location.href;
        const externalIdMatch = postUrl.match(/\/post\/([A-Za-z0-9_-]+)/);
        return {
          url: postUrl,
          title: body.slice(0, 200),
          body,
          author,
          publishedAt: null,
          platform: "threads",
          subtype: "threads_post",
          externalId: externalIdMatch ? externalIdMatch[1] : null,
        };
      }).filter((i: any) => i.body.length > 20);
    },
    args: [],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export async function collectReddit(term: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (): any[] => {
      // New Reddit interface uses shreddit-post custom elements
      const shredditPosts = document.querySelectorAll("shreddit-post");
      if (shredditPosts.length > 0) {
        return Array.from(shredditPosts).slice(0, 20).map((p: any) => {
          const title = p.getAttribute("post-title") ?? "";
          const author = p.getAttribute("author") ?? "";
          const permalink = p.getAttribute("permalink") ?? "";
          const createdAt = p.getAttribute("created-timestamp") ?? null;
          const postId = permalink.match(/comments\/([a-z0-9]+)\//)?.[1] ?? null;
          const url = permalink ? `https://www.reddit.com${permalink}` : window.location.href;
          // Body text lives inside the post element for text posts
          const bodyEl = p.querySelector("[slot='text-body'], .md");
          const body = bodyEl?.textContent?.trim() || null;
          return {
            url,
            title,
            body,
            author,
            publishedAt: createdAt,
            platform: "reddit",
            subtype: "reddit_post",
            externalId: postId,
          };
        }).filter((i: any) => i.title.length > 0);
      }

      // Fallback: old Reddit layout
      const posts = document.querySelectorAll('[data-testid="post-container"]');
      return Array.from(posts).slice(0, 20).map((p: any) => {
        const titleEl = p.querySelector('h3, [data-click-id="text"] h3');
        const title = titleEl?.textContent?.trim() ?? "";
        const authorEl = p.querySelector('a[href*="/user/"]');
        const author = authorEl?.textContent?.trim().replace("u/", "") ?? "";
        const linkEl = p.querySelector('a[data-click-id="body"]');
        const href = linkEl?.getAttribute("href") ?? "";
        const url = href.startsWith("http") ? href : `https://www.reddit.com${href}`;
        const postId = url.match(/comments\/([a-z0-9]+)\//)?.[1] ?? null;
        const timeEl = p.querySelector("time");
        const publishedAt = timeEl?.getAttribute("datetime") ?? null;
        return {
          url,
          title,
          body: null,
          author,
          publishedAt,
          platform: "reddit",
          subtype: "reddit_post",
          externalId: postId,
        };
      }).filter((i: any) => i.title.length > 0);
    },
    args: [],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export async function collectXThread(postUrl: string, tabId: number, postExternalId?: string): Promise<ExtensionItem[]> {
  await scrollPage(tabId, 3, 1500);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (pageUrl: string, rootId: string | null): any[] => {
      // Derive root ID from URL if not passed in
      const urlRootId = rootId ?? pageUrl.match(/\/status\/(\d+)/)?.[1] ?? null;
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      return Array.from(articles).map((a: any) => {
        const body = a.querySelector('[data-testid="tweetText"]')?.textContent ?? "";
        if (!body) return null;
        const authorEl = a.querySelector('[data-testid="User-Name"] a[href*="/"]');
        const author = authorEl?.getAttribute("href")?.replace("/", "") ?? "";
        const timeEl = a.querySelector("time");
        const publishedAt = timeEl?.getAttribute("datetime") ?? null;
        const statusLink = a.querySelector('a[href*="/status/"]');
        const articleUrl = statusLink
          ? `https://x.com${new URL(statusLink.href).pathname}`
          : pageUrl;
        const articleId = articleUrl.match(/\/status\/(\d+)/)?.[1] ?? null;
        const isRoot = articleId === urlRootId;
        return {
          url: articleUrl,
          title: body.slice(0, 200),
          body,
          author: `@${author}`,
          publishedAt,
          platform: "twitter",
          subtype: isRoot ? "x_post" : "x_reply",
          externalId: articleId,
          parentExternalId: isRoot ? null : urlRootId,
          rootExternalId: urlRootId,
        };
      }).filter(Boolean);
    },
    args: [postUrl, postExternalId ?? null],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export async function collectThreadsThread(postUrl: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId, 3, 1500);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (pageUrl: string): any[] => {
      const rootExternalId = pageUrl.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
      const articles = Array.from(document.querySelectorAll('div[role="article"], article'));
      const items: any[] = [];
      let rootFound = false;

      for (const el of articles) {
        // Body: prefer the pressable content container, fallback to full text
        const bodyEl = (el as Element).querySelector("[data-pressable-container]");
        const body = (bodyEl?.textContent ?? (el as Element).textContent ?? "").trim();
        if (body.length < 5) continue;

        const authorEl = (el as Element).querySelector('a[href^="/@"]');
        const author = authorEl?.getAttribute("href")?.replace("/@", "") ?? "";

        const postLinkEl = (el as Element).querySelector('a[href*="/post/"]');
        const rawHref = postLinkEl?.getAttribute("href") ?? "";
        // Normalise to threads.net regardless of whether the page loaded as threads.com
        const articleUrl = rawHref
          ? `https://www.threads.net${rawHref}`
          : pageUrl;
        const externalId = articleUrl.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? null;

        const isRoot = !rootFound && (externalId === rootExternalId || !rootFound);
        if (isRoot) rootFound = true;

        items.push({
          url: articleUrl,
          title: body.slice(0, 200),
          body,
          author,
          publishedAt: null,
          platform: "threads",
          subtype: isRoot ? "threads_post" : "threads_reply",
          externalId,
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

export async function collectXProfile(handle: string, tabId: number): Promise<ExtensionItem[]> {
  await scrollPage(tabId);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (): any[] => {
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      return Array.from(articles).map((a: any) => {
        const body = a.querySelector('[data-testid="tweetText"]')?.textContent ?? "";
        if (!body) return null;
        const authorEl = a.querySelector('[data-testid="User-Name"] a[href*="/"]');
        const author = authorEl?.getAttribute("href")?.replace("/", "") ?? "";
        const timeEl = a.querySelector("time");
        const publishedAt = timeEl?.getAttribute("datetime") ?? null;
        const statusLink = a.querySelector('a[href*="/status/"]');
        const url = statusLink
          ? `https://x.com${new URL(statusLink.href).pathname}`
          : window.location.href;
        const externalIdMatch = url.match(/\/status\/(\d+)/);
        return {
          url,
          title: (body as string).slice(0, 200),
          body,
          author: `@${author}`,
          publishedAt,
          platform: "twitter",
          subtype: "x_post",
          externalId: externalIdMatch ? externalIdMatch[1] : null,
        };
      }).filter(Boolean);
    },
    args: [],
  });
  return (results[0]?.result ?? []) as ExtensionItem[];
}

export function dedupeByExternalId(items: ExtensionItem[]): ExtensionItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const key = i.externalId
      ? `${i.platform}:${i.externalId}`
      : `${i.platform}:${i.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
