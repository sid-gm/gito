interface ExtensionItem {
  url: string;
  title?: string;
  body?: string;
  author?: string;
  platform: string;
  subtype?: string;
  externalId?: string;
  publishedAt?: string;
}

// ─── DOM extractors ──────────────────────────────────────────────────────────

function extractTweet(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let article: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && node.matches('article[data-testid="tweet"]')) {
          article = node;
          break;
        }
        node = node.parentElement;
      }
    }
    if (!article) article = document.querySelector('article[data-testid="tweet"]');

    const body = article?.querySelector('[data-testid="tweetText"]')?.textContent ?? selectedText;
    const authorEl = article?.querySelector('[data-testid="User-Name"] a') as HTMLAnchorElement | null;
    const author = authorEl?.textContent?.replace(/^@/, "") ?? undefined;
    const timeEl = article?.querySelector("time") as HTMLTimeElement | null;
    const publishedAt = timeEl?.getAttribute("datetime") ?? undefined;
    const statusLink = article?.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    const canonicalUrl = statusLink ? `https://x.com${new URL(statusLink.href).pathname}` : url;
    const idMatch = canonicalUrl.match(/\/status\/(\d+)/);
    const externalId = idMatch?.[1];

    return { url: canonicalUrl, title: body.slice(0, 200), body, author, platform: "twitter", subtype: "x_post", externalId, publishedAt };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "twitter", subtype: "x_post" };
  }
}

function extractThreadsPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let article: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && (node.matches("article") || node.matches('div[role="article"]'))) {
          article = node;
          break;
        }
        node = node.parentElement;
      }
    }
    if (!article) article = document.querySelector('article, div[role="article"]');

    const authorEl = article?.querySelector('a[href^="/@"]') as HTMLAnchorElement | null;
    const author = authorEl?.getAttribute("href")?.replace("/@", "") ?? undefined;
    const body = article?.querySelector("[data-pressable-container]")?.textContent ?? selectedText;
    const idMatch = url.match(/\/post\/([A-Za-z0-9_-]+)/);
    const externalId = idMatch?.[1];

    return { url, title: body.slice(0, 200), body, author, platform: "threads", subtype: "threads_post", externalId };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "threads", subtype: "threads_post" };
  }
}

function extractRedditPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let container: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && (node.tagName.toLowerCase() === "shreddit-post" || node.matches("[data-post-id]"))) {
          container = node;
          break;
        }
        node = node.parentElement;
      }
    }
    if (!container) container = document.querySelector("shreddit-post, [data-post-id]");

    const idMatch = url.match(/comments\/([a-z0-9]+)\//i);
    const rawId = idMatch?.[1] ?? container?.getAttribute("data-post-id");
    const externalId = rawId ? `t3_${rawId}` : undefined;

    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "reddit", subtype: "reddit_post", externalId };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "reddit", subtype: "reddit_post" };
  }
}

function extractInstagramPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const sel = window.getSelection();
    const anchor = sel?.anchorNode;
    let article: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && node.matches("article")) {
          article = node;
          break;
        }
        node = node.parentElement;
      }
    }
    if (!article) article = document.querySelector("article");

    const authorEl = article?.querySelector("header a") as HTMLAnchorElement | null;
    const author = authorEl?.textContent ?? undefined;
    const idMatch = url.match(/\/p\/([A-Za-z0-9_-]+)\//);
    const externalId = idMatch?.[1];

    return { url, title: selectedText.slice(0, 200), body: selectedText, author, platform: "instagram", subtype: "instagram_post", externalId };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "instagram", subtype: "instagram_post" };
  }
}

function extractItem(selectedText: string): ExtensionItem {
  const url = window.location.href;
  if (/x\.com|twitter\.com/.test(url)) return extractTweet(selectedText);
  if (/threads\.net/.test(url)) return extractThreadsPost(selectedText);
  if (/reddit\.com/.test(url)) return extractRedditPost(selectedText);
  if (/instagram\.com/.test(url)) return extractInstagramPost(selectedText);
  return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "manual" };
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function showToast(text: string, type: "success" | "error") {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.cssText = `
    position:fixed;bottom:24px;right:24px;z-index:2147483647;
    background:${type === "success" ? "#16a34a" : "#dc2626"};
    color:#fff;padding:10px 16px;border-radius:8px;
    font-family:system-ui,sans-serif;font-size:13px;
    box-shadow:0 4px 12px rgba(0,0,0,0.15);
    pointer-events:none;
    transition:opacity 0.2s;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ─── Send ────────────────────────────────────────────────────────────────────

async function extractAndSend(selectedText: string) {
  const item = extractItem(selectedText);
  chrome.runtime.sendMessage({ type: "SEND_ITEM", payload: item }, (response) => {
    if (chrome.runtime.lastError) {
      showToast("Failed to send — extension error", "error");
      return;
    }
    if (!response?.ok) {
      const msg = response?.error === "Not configured"
        ? "Configure Gito extension first"
        : "Failed to send — check API key";
      showToast(msg, "error");
    } else {
      showToast("✓ Sent to Gito", "success");
    }
  });
}

// ─── Floating button ─────────────────────────────────────────────────────────

let floatingBtn: HTMLElement | null = null;
let hideTimeout: ReturnType<typeof setTimeout> | null = null;

function removeFloatingBtn() {
  floatingBtn?.remove();
  floatingBtn = null;
  if (hideTimeout) clearTimeout(hideTimeout);
}

function showFloatingBtn(selection: Selection) {
  removeFloatingBtn();

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) return;

  const btn = document.createElement("button");
  btn.textContent = "→ Gito";
  btn.style.cssText = `
    position:fixed;
    top:${rect.top + window.scrollY - 36}px;
    left:${rect.left + rect.width / 2}px;
    transform:translateX(-50%);
    z-index:2147483646;
    background:#1a1a1a;
    color:#faf9f6;
    border:none;
    border-radius:20px;
    padding:5px 12px;
    font-family:system-ui,sans-serif;
    font-size:12px;
    font-weight:500;
    cursor:pointer;
    box-shadow:0 2px 8px rgba(0,0,0,0.25);
    white-space:nowrap;
  `;

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = selection.toString().trim();
    removeFloatingBtn();
    extractAndSend(text);
  });

  document.body.appendChild(btn);
  floatingBtn = btn;

  hideTimeout = setTimeout(removeFloatingBtn, 3000);
}

document.addEventListener("mouseup", (e) => {
  if (floatingBtn && floatingBtn.contains(e.target as Node)) return;

  const selection = window.getSelection();
  if (!selection || selection.toString().trim().length < 20) {
    removeFloatingBtn();
    return;
  }
  showFloatingBtn(selection);
});

document.addEventListener("scroll", removeFloatingBtn, { passive: true });
document.addEventListener("mousedown", (e) => {
  if (floatingBtn && !floatingBtn.contains(e.target as Node)) {
    removeFloatingBtn();
  }
});

// ─── Context menu entry point ────────────────────────────────────────────────

(window as any).__gitoSendSelection = () => {
  const selection = window.getSelection();
  if (!selection || selection.toString().trim().length === 0) {
    showToast("No text selected", "error");
    return;
  }
  extractAndSend(selection.toString().trim());
};
