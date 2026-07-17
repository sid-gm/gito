// In-page manual capture — floating "→ Gito" button, context menu, topic
// picker, include-comments checkbox. Items are sent in protocol-v2 shape
// (kind post/comment, sourceKind manual, honest timestamps).

interface Engagement {
  likes?: number;
  replies?: number;
  reposts?: number;
  upvotes?: number;
  views?: number;
}

interface ExtensionItem {
  platform: string;
  kind: "post" | "comment";
  externalId?: string | null;
  url?: string | null;
  author?: string | null;
  title?: string | null;
  body?: string | null;
  publishedAt?: string | null;
  publishedAtPrecision?: "exact" | "approx" | "unknown";
  parentExternalId?: string | null;
  rootExternalId?: string | null;
  depth?: number | null;
  sourceKind: "manual";
  engagement?: Engagement | null;
}

interface Topic { id: string; label: string }

function parseCount(t: string | null | undefined): number | undefined {
  if (!t) return undefined;
  const m = t.trim().replace(/,/g, "").match(/^([\d.]+)\s*([KMB])?$/i);
  if (!m) return undefined;
  let n = parseFloat(m[1]);
  const u = (m[2] ?? "").toUpperCase();
  if (u === "K") n *= 1e3;
  if (u === "M") n *= 1e6;
  if (u === "B") n *= 1e9;
  return Math.round(n);
}

// ─── DOM extractors ──────────────────────────────────────────────────────────

function extractTweetFromArticle(article: Element, fallbackText = ""): ExtensionItem {
  const body = article.querySelector('[data-testid="tweetText"]')?.textContent ?? fallbackText;
  const authorEl = article.querySelector('[data-testid="User-Name"] a') as HTMLAnchorElement | null;
  const author = authorEl?.textContent?.replace(/^@/, "") ?? null;
  const publishedAt = article.querySelector("time")?.getAttribute("datetime") ?? null;
  const statusLink = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
  const canonicalUrl = statusLink ? `https://x.com${new URL(statusLink.href).pathname}` : window.location.href;
  const externalId = canonicalUrl.match(/\/status\/(\d+)/)?.[1] ?? null;
  const engagement: Engagement = {
    replies: parseCount(article.querySelector('[data-testid="reply"]')?.textContent),
    reposts: parseCount(article.querySelector('[data-testid="retweet"]')?.textContent),
    likes: parseCount(article.querySelector('[data-testid="like"]')?.textContent),
    views: parseCount(article.querySelector('a[href*="/analytics"]')?.textContent),
  };
  const hasEngagement = Object.values(engagement).some((v) => v != null);
  return {
    platform: "twitter",
    kind: "post",
    externalId,
    url: canonicalUrl,
    author: author ? `@${author.trim()}` : null,
    title: null,
    body,
    publishedAt,
    publishedAtPrecision: publishedAt ? "exact" : "unknown",
    sourceKind: "manual",
    engagement: hasEngagement ? engagement : null,
  };
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
    if (!article) {
      return { platform: "twitter", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
    }
    return extractTweetFromArticle(article, selectedText);
  } catch {
    return { platform: "twitter", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
  }
}

function extractVisibleReplies(mainExternalId?: string | null): ExtensionItem[] {
  const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"]'));
  const replies: ExtensionItem[] = [];
  for (const article of articles) {
    const statusLink = article.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    const articleId = statusLink
      ? new URL(statusLink.href).pathname.match(/\/status\/(\d+)/)?.[1]
      : undefined;
    if (!articleId || articleId === mainExternalId) continue;
    const item = extractTweetFromArticle(article);
    item.kind = "comment";
    item.parentExternalId = mainExternalId ?? null;
    item.rootExternalId = mainExternalId ?? null;
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
    const author = (article?.querySelector('a[href^="/@"]') as HTMLAnchorElement | null)?.getAttribute("href")?.replace("/@", "") ?? null;
    const body = article?.querySelector("[data-pressable-container]")?.textContent ?? selectedText;
    const externalId = url.match(/\/post\/([A-Za-z0-9_-]+)/)?.[1] ?? null;
    const publishedAt = article?.querySelector("time")?.getAttribute("datetime") ?? null;
    return {
      platform: "threads", kind: "post", externalId, url, author, body,
      publishedAt, publishedAtPrecision: publishedAt ? "exact" : "unknown", sourceKind: "manual",
    };
  } catch {
    return { platform: "threads", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
  }
}

function extractRedditPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const rawId = url.match(/comments\/([a-z0-9]+)\//i)?.[1];
    const postEl = document.querySelector("shreddit-post");
    const externalId = postEl?.getAttribute("id") ?? (rawId ? `t3_${rawId}` : null);
    const author = postEl?.getAttribute("author") ?? null;
    const publishedAt = postEl?.getAttribute("created-timestamp") ?? null;
    const score = parseInt(postEl?.getAttribute("score") ?? "", 10);
    const commentCount = parseInt(postEl?.getAttribute("comment-count") ?? "", 10);

    const title = postEl?.getAttribute("post-title")
      ?? (document.querySelector('h1[slot="title"], [slot="title"] h1, h1') as HTMLElement | null)?.textContent?.trim()
      ?? null;
    const body = document.querySelector('shreddit-post-text-body [slot="text-body"]')?.textContent?.trim() ?? selectedText;

    return {
      platform: "reddit", kind: "post", externalId, url, author, title, body,
      publishedAt, publishedAtPrecision: publishedAt ? "exact" : "unknown", sourceKind: "manual",
      engagement:
        isNaN(score) && isNaN(commentCount)
          ? null
          : { upvotes: isNaN(score) ? undefined : score, replies: isNaN(commentCount) ? undefined : commentCount },
    };
  } catch {
    return { platform: "reddit", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
  }
}

function extractVisibleRedditComments(mainPostExternalId?: string | null): ExtensionItem[] {
  const commentEls = Array.from(document.querySelectorAll("shreddit-comment"));
  const comments: ExtensionItem[] = [];

  for (const el of commentEls) {
    const thingId = el.getAttribute("thingid");
    const postId = el.getAttribute("postid");
    if (mainPostExternalId && postId && postId !== mainPostExternalId) continue;

    const body = el.querySelector('[slot="comment"]')?.textContent?.trim();
    if (!body) continue;

    const author = el.getAttribute("author") ?? null;
    const depth = parseInt(el.getAttribute("depth") ?? "0", 10);
    const parentId = el.getAttribute("parentid");
    const permalinkAttr = el.getAttribute("permalink");
    const publishedAt = (el.querySelector('[slot="commentMeta"] time') as HTMLTimeElement | null)?.getAttribute("datetime") ?? null;
    const score = parseInt(el.getAttribute("score") ?? "", 10);

    comments.push({
      platform: "reddit",
      kind: "comment",
      externalId: thingId ?? null,
      url: permalinkAttr ? `https://www.reddit.com${permalinkAttr}` : window.location.href,
      author,
      body,
      publishedAt,
      publishedAtPrecision: publishedAt ? "exact" : "unknown",
      parentExternalId: parentId ?? mainPostExternalId ?? null,
      rootExternalId: mainPostExternalId ?? postId ?? null,
      depth: isNaN(depth) ? null : depth,
      sourceKind: "manual",
      engagement: isNaN(score) ? null : { upvotes: score },
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
    const author = (article?.querySelector("header a") as HTMLAnchorElement | null)?.textContent ?? null;
    const externalId = url.match(/\/p\/([A-Za-z0-9_-]+)\//)?.[1] ?? null;
    return { platform: "instagram", kind: "post", externalId, url, author, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
  } catch {
    return { platform: "instagram", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
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
    const externalId = extractFacebookExternalId(url) ?? null;
    // data-ad-* attributes are Facebook's stable hooks; class names are atomic CSS and churn.
    const messageEl = document.querySelector(
      'div[data-ad-preview="message"], div[data-ad-rendering-role="story_message"]'
    );
    const body = messageEl?.textContent?.trim() || selectedText;
    const postRoot = messageEl?.closest('div[role="article"]') ?? messageEl?.closest("div[aria-posinset]") ?? document;
    const authorEl = postRoot.querySelector(
      '[data-ad-rendering-role="profile_name"], h2 a, h3 a'
    ) as HTMLElement | null;
    const author = authorEl?.textContent?.trim() || null;
    return { platform: "facebook", kind: "post", externalId, url, author, body, publishedAtPrecision: "unknown", sourceKind: "manual" };
  } catch {
    return { platform: "facebook", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
  }
}

function extractVisibleFacebookComments(postUrl: string, postExternalId?: string | null): ExtensionItem[] {
  const articles = Array.from(document.querySelectorAll('div[role="article"][aria-label]'));
  const comments: ExtensionItem[] = [];

  for (const article of articles) {
    // Comments/replies carry aria-label "Comment by <name>" / "Reply by <name>" (English UI);
    // the main post uses aria-labelledby, so it never matches here.
    const aria = article.getAttribute("aria-label") ?? "";
    const m = aria.match(/^(comment|reply) by (.+)$/i);
    if (!m) continue;
    const author = m[2].replace(/\s+\d+\s+\w+\s+ago$/i, "").trim() || null;

    // Replies are nested articles inside their parent comment — only take text
    // blocks that belong directly to this article, not to a nested one.
    const body = Array.from(article.querySelectorAll('div[dir="auto"]'))
      .filter((el) => el.closest('div[role="article"]') === article)
      .map((el) => el.textContent?.trim() ?? "")
      .filter(Boolean)
      .join("\n");
    if (!body) continue;

    let externalId: string | null = null;
    let publishedAt: string | undefined;
    const permalink = Array.from(article.querySelectorAll('a[href*="comment_id"]'))
      .find((a) => (a as HTMLAnchorElement).closest('div[role="article"]') === article) as HTMLAnchorElement | undefined;
    if (permalink) {
      try {
        // The comment_id anchor often points at the commenter's profile, not a
        // real permalink — use it only for the ID and relative timestamp, and
        // always link the comment back to the post itself.
        const parsed = new URL(permalink.href, window.location.origin);
        externalId = parsed.searchParams.get("reply_comment_id") ?? parsed.searchParams.get("comment_id") ?? null;
        publishedAt = parseFacebookRelativeTime(permalink.textContent);
      } catch { /* keep fallbacks */ }
    }

    comments.push({
      platform: "facebook",
      kind: "comment",
      externalId,
      url: postUrl,
      author,
      body,
      publishedAt: publishedAt ?? null,
      publishedAtPrecision: publishedAt ? "approx" : "unknown",
      parentExternalId: postExternalId ?? null,
      rootExternalId: postExternalId ?? null,
      sourceKind: "manual",
    });
  }

  return comments;
}

function extractLinkedInPost(selectedText: string): ExtensionItem {
  const url = window.location.href;
  try {
    const externalId = url.match(/urn:li:activity:(\d+)/)?.[1]
      ?? url.match(/activity-(\d+)/)?.[1]
      ?? null;
    const postEl = document.querySelector('div[data-urn*="activity"], article');
    const author = (postEl?.querySelector('.update-components-actor__title span[aria-hidden="true"], .update-components-actor__name') as HTMLElement | null)
      ?.textContent?.trim() ?? null;
    const body = (postEl?.querySelector('.update-components-text, .feed-shared-inline-show-more-text') as HTMLElement | null)
      ?.textContent?.trim() || selectedText;
    return { platform: "linkedin", kind: "post", externalId, url, author, body, publishedAtPrecision: "unknown", sourceKind: "manual" };
  } catch {
    return { platform: "linkedin", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
  }
}

function extractItem(selectedText: string): ExtensionItem {
  const url = window.location.href;
  if (/x\.com|twitter\.com/.test(url)) return extractTweet(selectedText);
  if (/threads\.(net|com)/.test(url)) return extractThreadsPost(selectedText);
  if (/reddit\.com/.test(url)) return extractRedditPost(selectedText);
  if (/instagram\.com/.test(url)) return extractInstagramPost(selectedText);
  if (/facebook\.com/.test(url)) return extractFacebookPost(selectedText);
  if (/linkedin\.com/.test(url)) return extractLinkedInPost(selectedText);
  return { platform: "manual", kind: "post", url, body: selectedText, publishedAtPrecision: "unknown", sourceKind: "manual" };
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

// ─── Topic picker panel ──────────────────────────────────────────────────────

let pickerEl: HTMLElement | null = null;

function removePickerPanel() {
  pickerEl?.remove();
  pickerEl = null;
}

function showPickerPanel(item: ExtensionItem, anchorRect: DOMRect, topics: Topic[], replies?: ExtensionItem[]) {
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

  // Topic selector
  const label = document.createElement("div");
  label.style.cssText = "font-size:11px;font-weight:500;color:#666;text-transform:uppercase;letter-spacing:0.04em;margin-bottom:5px;";
  label.textContent = "Topic";

  const select = document.createElement("select");
  select.style.cssText = `
    width:100%;padding:5px 8px;
    border:1px solid #d4cfc6;border-radius:5px;
    font-size:12px;background:#faf9f6;color:#1a1a1a;
    margin-bottom:10px;outline:none;cursor:pointer;
  `;
  const noTopicOpt = document.createElement("option");
  noTopicOpt.value = "";
  noTopicOpt.textContent = "— No topic —";
  select.appendChild(noTopicOpt);
  for (const topic of topics) {
    const opt = document.createElement("option");
    opt.value = topic.id;
    opt.textContent = topic.label;
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
  const previewText = item.title ?? item.body ?? item.url ?? "";
  preview.textContent = previewText;
  preview.title = previewText;

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
    const topicId = select.value || undefined;
    const replyItems = (includeRepliesCheckbox?.checked && replies?.length) ? replies : undefined;
    sendBtn.textContent = "Sending…";
    sendBtn.style.opacity = "0.6";
    sendBtn.style.cursor = "not-allowed";

    chrome.runtime.sendMessage({ type: "SEND_ITEM", payload: item, replies: replyItems, topicId }, (response) => {
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

// ─── Show picker (fetches topics via background) ─────────────────────────────

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
    ? extractVisibleFacebookComments(item.url ?? window.location.href, item.externalId)
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
    showPickerPanel(item, anchorRect, response.topics ?? [], replies);
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
