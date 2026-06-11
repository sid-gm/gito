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

interface Entity { id: string; label: string }

// ─── DOM extractors ──────────────────────────────────────────────────────────

function extractTweetFromArticle(article: Element, fallbackText = ""): ExtensionItem {
  const body = article.querySelector('[data-testid="tweetText"]')?.textContent ?? fallbackText;
  const authorEl = article.querySelector('[data-testid="User-Name"] a') as HTMLAnchorElement | null;
  const author = authorEl?.textContent?.replace(/^@/, "") ?? undefined;
  const timeEl = article.querySelector("time") as HTMLTimeElement | null;
  const publishedAt = timeEl?.getAttribute("datetime") ?? undefined;
  const statusLink = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
  const canonicalUrl = statusLink ? `https://x.com${new URL(statusLink.href).pathname}` : window.location.href;
  const externalId = canonicalUrl.match(/\/status\/(\d+)/)?.[1];
  return { url: canonicalUrl, title: body.slice(0, 200), body, author, platform: "twitter", subtype: "x_post", externalId, publishedAt };
}

function extractTweet(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const anchor = window.getSelection()?.anchorNode;
    let article: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && node.matches('article[data-testid="tweet"]')) { article = node; break; }
        node = node.parentElement;
      }
    }
    if (!article) article = document.querySelector('article[data-testid="tweet"]');
    if (!article) return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "twitter", subtype: "x_post" };

    return extractTweetFromArticle(article, selectedText);
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "twitter", subtype: "x_post" };
  }
}

function extractVisibleReplies(mainExternalId?: string): ExtensionItem[] {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  const replies: ExtensionItem[] = [];
  for (const article of articles) {
    const statusLink = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    const articleId = statusLink
      ? new URL(statusLink.href).pathname.match(/\/status\/(\d+)/)?.[1]
      : undefined;
    if (!articleId || articleId === mainExternalId) continue;
    const item = extractTweetFromArticle(article);
    item.subtype = "x_reply";
    replies.push(item);
  }
  return replies;
}

function extractThreadsPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const anchor = window.getSelection()?.anchorNode;
    let article: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && (node.matches("article") || node.matches('div[role="article"]'))) { article = node; break; }
        node = node.parentElement;
      }
    }
    if (!article) article = document.querySelector('article, div[role="article"]');
    const authorEl = article?.querySelector('a[href^="/@"]') as HTMLAnchorElement | null;
    const author = authorEl?.getAttribute("href")?.replace("/@", "") ?? undefined;
    const body = article?.querySelector("[data-pressable-container]")?.textContent ?? selectedText;
    const externalId = url.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1];
    return { url, title: body.slice(0, 200), body, author, platform: "threads", subtype: "threads_post", externalId };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "threads", subtype: "threads_post" };
  }
}

function extractRedditPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const rawId = url.match(/comments\/([a-z0-9]+)\//i)?.[1];
    const externalId = rawId ? `t3_${rawId}` : undefined;

    const postEl = document.querySelector("shreddit-post");
    const author = postEl?.getAttribute("author") ?? undefined;
    const publishedAt = postEl?.getAttribute("created-timestamp") ?? undefined;

    // Title from shreddit-post attribute or first h1 on page
    const postTitle = postEl?.getAttribute("post-title")
      ?? (document.querySelector('h1[slot="title"], [slot="title"] h1, h1') as HTMLElement | null)?.textContent?.trim()
      ?? selectedText.slice(0, 200);

    // Body from the slot-based text body (light DOM, accessible)
    const postBodyEl = document.querySelector('shreddit-post-text-body [slot="text-body"]');
    const postBody = postBodyEl?.textContent?.trim() ?? selectedText;

    return { url, title: postTitle, body: postBody, author, platform: "reddit", subtype: "reddit_post", externalId, publishedAt };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "reddit", subtype: "reddit_post" };
  }
}

function extractVisibleRedditComments(mainPostExternalId?: string): ExtensionItem[] {
  const commentEls = Array.from(document.querySelectorAll("shreddit-comment"));
  const comments: ExtensionItem[] = [];

  for (const el of commentEls) {
    const thingId = el.getAttribute("thingid");
    const postId = el.getAttribute("postid");

    // Skip comments that don't belong to this post
    if (mainPostExternalId && postId && postId !== mainPostExternalId) continue;

    const author = el.getAttribute("author") ?? undefined;
    const depth = parseInt(el.getAttribute("depth") ?? "0", 10);
    const permalinkAttr = el.getAttribute("permalink");
    const commentUrl = permalinkAttr ? `https://www.reddit.com${permalinkAttr}` : window.location.href;

    const commentTextEl = el.querySelector('[slot="comment"]');
    const body = commentTextEl?.textContent?.trim();
    if (!body) continue;

    const timeEl = el.querySelector('[slot="commentMeta"] time') as HTMLTimeElement | null;
    const publishedAt = timeEl?.getAttribute("datetime") ?? undefined;

    comments.push({
      url: commentUrl,
      title: body.slice(0, 200),
      body,
      author,
      platform: "reddit",
      subtype: depth === 0 ? "reddit_comment" : "reddit_reply",
      externalId: thingId ?? undefined,
      publishedAt,
    });
  }

  return comments;
}

function extractInstagramPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const anchor = window.getSelection()?.anchorNode;
    let article: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && node.matches("article")) { article = node; break; }
        node = node.parentElement;
      }
    }
    if (!article) article = document.querySelector("article");
    const author = (article?.querySelector("header a") as HTMLAnchorElement | null)?.textContent ?? undefined;
    const externalId = url.match(/\/p\/([A-Za-z0-9_-]+)\//)?.[1];
    return { url, title: selectedText.slice(0, 200), body: selectedText, author, platform: "instagram", subtype: "instagram_post", externalId };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "instagram", subtype: "instagram_post" };
  }
}

function extractFacebookExternalId(url: string): string | undefined {
  // Facebook post URLs come in several shapes; try the known ones in order.
  return url.match(/\/posts\/(pfbid[A-Za-z0-9]+|\d+)/)?.[1]
    ?? url.match(/story_fbid=(pfbid[A-Za-z0-9]+|\d+)/)?.[1]
    ?? url.match(/[?&]fbid=(\d+)/)?.[1]
    ?? url.match(/\/(?:videos|reel)\/(\d+)/)?.[1]
    ?? url.match(/\/share\/[pvr]\/([A-Za-z0-9]+)/)?.[1];
}

// Facebook only renders relative times ("21h", "55m", "3d") — approximate an ISO date.
function parseFacebookRelativeTime(text: string | null | undefined): string | undefined {
  const m = text?.trim().match(/^(\d+)\s*(s|m|h|d|w|y)$/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  const unitMs: Record<string, number> = {
    s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000, y: 31_536_000_000,
  };
  return new Date(Date.now() - n * unitMs[m[2].toLowerCase()]).toISOString();
}

function extractFacebookPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const externalId = extractFacebookExternalId(url);
    // data-ad-* attributes are Facebook's stable hooks; class names are atomic CSS and churn.
    const messageEl = document.querySelector(
      'div[data-ad-preview="message"], div[data-ad-rendering-role="story_message"]'
    );
    const body = messageEl?.textContent?.trim() || selectedText;
    const postRoot = messageEl?.closest('div[role="article"]') ?? messageEl?.closest("div[aria-posinset]") ?? document;
    const authorEl = postRoot.querySelector(
      '[data-ad-rendering-role="profile_name"], h2 a, h3 a'
    ) as HTMLElement | null;
    const author = authorEl?.textContent?.trim() || undefined;
    return { url, title: body.slice(0, 200), body, author, platform: "facebook", subtype: "facebook_post", externalId };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "facebook", subtype: "facebook_post" };
  }
}

function extractVisibleFacebookComments(): ExtensionItem[] {
  const articles = Array.from(document.querySelectorAll('div[role="article"][aria-label]'));
  const comments: ExtensionItem[] = [];

  for (const article of articles) {
    // Comments/replies carry aria-label "Comment by <name>" / "Reply by <name>" (English UI);
    // the main post uses aria-labelledby, so it never matches here.
    const aria = article.getAttribute("aria-label") ?? "";
    const m = aria.match(/^(comment|reply) by (.+)$/i);
    if (!m) continue;
    const subtype = m[1].toLowerCase() === "reply" ? "facebook_reply" : "facebook_comment";
    const author = m[2].replace(/\s+\d+\s+\w+\s+ago$/i, "").trim() || undefined;

    // Replies are nested articles inside their parent comment — only take text
    // blocks that belong directly to this article, not to a nested one.
    const body = Array.from(article.querySelectorAll('div[dir="auto"]'))
      .filter((el) => el.closest('div[role="article"]') === article)
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    if (!body) continue;

    let externalId: string | undefined;
    let commentUrl = window.location.href;
    let publishedAt: string | undefined;
    const permalink = Array.from(article.querySelectorAll('a[href*="comment_id"]'))
      .find((a) => (a as HTMLAnchorElement).closest('div[role="article"]') === article) as HTMLAnchorElement | undefined;
    if (permalink) {
      try {
        const parsed = new URL(permalink.href, window.location.origin);
        externalId = parsed.searchParams.get("reply_comment_id") ?? parsed.searchParams.get("comment_id") ?? undefined;
        commentUrl = parsed.href;
        publishedAt = parseFacebookRelativeTime(permalink.textContent);
      } catch { /* keep fallbacks */ }
    }

    comments.push({
      url: commentUrl,
      title: body.slice(0, 200),
      body,
      author,
      platform: "facebook",
      subtype,
      externalId,
      publishedAt,
    });
  }

  return comments;
}

function extractItem(selectedText: string): ExtensionItem {
  const url = window.location.href;
  if (/x\.com|twitter\.com/.test(url)) return extractTweet(selectedText);
  if (/threads\.(net|com)/.test(url)) return extractThreadsPost(selectedText);
  if (/reddit\.com/.test(url)) return extractRedditPost(selectedText);
  if (/instagram\.com/.test(url)) return extractInstagramPost(selectedText);
  if (/facebook\.com/.test(url)) return extractFacebookPost(selectedText);
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
    box-shadow:0 4px 12px rgba(0,0,0,0.15);pointer-events:none;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ─── Runtime guard ───────────────────────────────────────────────────────────

function runtimeOk(): boolean {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

// ─── Entity picker panel ─────────────────────────────────────────────────────

let pickerEl: HTMLElement | null = null;

function removePickerPanel() {
  pickerEl?.remove();
  pickerEl = null;
}

function showPickerPanel(item: ExtensionItem, anchorRect: DOMRect, entities: Entity[], replies?: ExtensionItem[]) {
  removePickerPanel();

  const panel = document.createElement("div");
  panel.style.cssText = `
    position:fixed;
    top:${Math.max(8, anchorRect.top - 130)}px;
    left:${Math.min(window.innerWidth - 224, anchorRect.left + anchorRect.width / 2 - 110)}px;
    z-index:2147483647;
    width:220px;
    background:#fff;
    border:1px solid #d4cfc6;
    border-radius:10px;
    box-shadow:0 8px 24px rgba(0,0,0,0.15);
    font-family:system-ui,sans-serif;
    font-size:13px;
    overflow:hidden;
  `;

  // Header
  const header = document.createElement("div");
  header.style.cssText = `
    padding:9px 12px 8px;
    border-bottom:1px solid #e8e4dc;
    display:flex;align-items:center;justify-content:space-between;
  `;
  const title = document.createElement("span");
  title.style.cssText = "font-weight:600;font-size:12px;color:#1a1a1a;";
  title.textContent = "Send to Gito";
  const closeBtn = document.createElement("button");
  closeBtn.textContent = "✕";
  closeBtn.style.cssText = `
    background:none;border:none;cursor:pointer;color:#888;
    font-size:12px;padding:0;line-height:1;
  `;
  closeBtn.addEventListener("click", removePickerPanel);
  header.appendChild(title);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement("div");
  body.style.cssText = "padding:10px 12px;";

  // Entity selector
  const label = document.createElement("div");
  label.style.cssText = "font-size:11px;font-weight:500;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;";
  label.textContent = "Entity";

  const select = document.createElement("select");
  select.style.cssText = `
    width:100%;padding:5px 8px;
    border:1px solid #d4cfc6;border-radius:5px;
    font-size:12px;background:#faf9f6;color:#1a1a1a;
    margin-bottom:10px;outline:none;cursor:pointer;
  `;
  const noEntityOpt = document.createElement("option");
  noEntityOpt.value = "";
  noEntityOpt.textContent = "— No entity —";
  select.appendChild(noEntityOpt);
  for (const ent of entities) {
    const opt = document.createElement("option");
    opt.value = ent.id;
    opt.textContent = ent.label;
    select.appendChild(opt);
  }

  // Preview of what's being sent
  const preview = document.createElement("div");
  preview.style.cssText = `
    font-size:11px;color:#888;margin-bottom:10px;
    padding:5px 7px;background:#faf9f6;border-radius:4px;
    border:1px solid #e8e4dc;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
  `;
  preview.textContent = item.title ?? item.body ?? item.url;
  preview.title = item.title ?? item.body ?? item.url;

  // Replies/comments checkbox
  let includeRepliesCheckbox: HTMLInputElement | null = null;
  if (replies && replies.length > 0) {
    const repliesRow = document.createElement("label");
    repliesRow.style.cssText = `
      display:flex;align-items:center;gap:6px;
      margin-bottom:10px;cursor:pointer;
      font-size:12px;color:#444;
    `;
    includeRepliesCheckbox = document.createElement("input");
    includeRepliesCheckbox.type = "checkbox";
    includeRepliesCheckbox.checked = true;
    includeRepliesCheckbox.style.cssText = "cursor:pointer;accent-color:#1a1a1a;";
    const repliesLabel = document.createElement("span");
    const usesComments = item.platform === "reddit" || item.platform === "facebook";
    const noun = usesComments ? "comment" : "repl";
    repliesLabel.textContent = `Include ${replies.length} ${noun}${replies.length === 1 ? (usesComments ? "" : "y") : (usesComments ? "s" : "ies")}`;
    repliesRow.appendChild(includeRepliesCheckbox);
    repliesRow.appendChild(repliesLabel);
    body.appendChild(repliesRow);
  }

  // Send button
  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send";
  sendBtn.style.cssText = `
    width:100%;padding:7px;border:none;border-radius:6px;
    background:#1a1a1a;color:#faf9f6;
    font-size:13px;font-weight:500;cursor:pointer;
  `;

  sendBtn.addEventListener("click", async () => {
    const entityId = select.value || undefined;
    const replyItems = (includeRepliesCheckbox?.checked && replies?.length) ? replies : undefined;
    sendBtn.textContent = "Sending…";
    sendBtn.style.opacity = "0.6";
    sendBtn.style.cursor = "not-allowed";

    chrome.runtime.sendMessage({ type: "SEND_ITEM", payload: item, replies: replyItems, entityId }, (response) => {
      removePickerPanel();
      if (chrome.runtime.lastError || !response?.ok) {
        const msg = response?.error === "Not configured"
          ? "Configure Gito extension first"
          : "Failed to send — check API key";
        showToast(msg, "error");
      } else {
        const total = 1 + (replyItems?.length ?? 0);
        showToast(total > 1 ? `✓ Sent ${total} items to Gito` : "✓ Sent to Gito", "success");
      }
    });
  });

  body.appendChild(label);
  body.appendChild(select);
  body.appendChild(preview);
  body.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(body);
  document.body.appendChild(panel);
  pickerEl = panel;

  // Close on outside click
  setTimeout(() => {
    document.addEventListener("mousedown", onOutsideClick, { once: false });
  }, 50);
}

function onOutsideClick(e: MouseEvent) {
  if (pickerEl && !pickerEl.contains(e.target as Node)) {
    removePickerPanel();
    document.removeEventListener("mousedown", onOutsideClick);
  }
}

// ─── Show picker (fetches entities via background) ────────────────────────────

async function initiateCapture(selectedText: string, anchorRect: DOMRect) {
  const item = extractItem(selectedText);

  const isTwitterThread = /x\.com|twitter\.com/.test(window.location.href) && /\/status\/\d+/.test(window.location.href);
  const isRedditThread = /reddit\.com/.test(window.location.href) && /\/comments\//.test(window.location.href);
  const isFacebookPage = /facebook\.com/.test(window.location.href);
  const replies = isTwitterThread
    ? extractVisibleReplies(item.externalId)
    : isRedditThread
    ? extractVisibleRedditComments(item.externalId)
    : isFacebookPage
    ? extractVisibleFacebookComments()
    : undefined;

  chrome.runtime.sendMessage({ type: "GET_CONTEXT" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      if (response?.error === "Not configured") {
        showToast("Configure Gito extension first", "error");
      } else {
        showPickerPanel(item, anchorRect, [], replies);
      }
      return;
    }
    showPickerPanel(item, anchorRect, response.entities ?? [], replies);
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
    top:${rect.top - 36}px;
    left:${rect.left + rect.width / 2}px;
    transform:translateX(-50%);
    z-index:2147483646;
    background:#1a1a1a;color:#faf9f6;
    border:none;border-radius:20px;padding:5px 12px;
    font-family:system-ui,sans-serif;font-size:12px;font-weight:500;
    cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.25);white-space:nowrap;
  `;

  btn.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const text = selection.toString().trim();
    const rect = range.getBoundingClientRect();
    removeFloatingBtn();
    initiateCapture(text, rect);
  });

  document.body.appendChild(btn);
  floatingBtn = btn;
  hideTimeout = setTimeout(removeFloatingBtn, 3000);
}

document.addEventListener("mouseup", (e) => {
  if (floatingBtn && floatingBtn.contains(e.target as Node)) return;
  if (pickerEl && pickerEl.contains(e.target as Node)) return;

  const selection = window.getSelection();
  if (!selection || selection.toString().trim().length < 20) {
    removeFloatingBtn();
    return;
  }
  showFloatingBtn(selection);
});

document.addEventListener("scroll", () => {
  removeFloatingBtn();
  removePickerPanel();
}, { passive: true });

// ─── Context menu entry point ────────────────────────────────────────────────

(window as any).__gitoSendSelection = () => {
  const selection = window.getSelection();
  if (!selection || selection.toString().trim().length === 0) {
    showToast("No text selected", "error");
    return;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  initiateCapture(selection.toString().trim(), rect);
};

// Listen for account switch from popup
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "ACCOUNT_CHANGED") {
    removePickerPanel();
    removeFloatingBtn();
  }
});
