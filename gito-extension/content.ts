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

    const body = article?.querySelector('[data-testid="tweetText"]')?.textContent ?? selectedText;
    const authorEl = article?.querySelector('[data-testid="User-Name"] a') as HTMLAnchorElement | null;
    const author = authorEl?.textContent?.replace(/^@/, "") ?? undefined;
    const timeEl = article?.querySelector("time") as HTMLTimeElement | null;
    const publishedAt = timeEl?.getAttribute("datetime") ?? undefined;
    const statusLink = article?.querySelector('a[href*="/status/"]') as HTMLAnchorElement | null;
    const canonicalUrl = statusLink ? `https://x.com${new URL(statusLink.href).pathname}` : url;
    const externalId = canonicalUrl.match(/\/status\/(\d+)/)?.[1];

    return { url: canonicalUrl, title: body.slice(0, 200), body, author, platform: "twitter", subtype: "x_post", externalId, publishedAt };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "twitter", subtype: "x_post" };
  }
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
    const anchor = window.getSelection()?.anchorNode;
    let container: Element | null = null;
    if (anchor) {
      let node: Node | null = anchor instanceof Element ? anchor : anchor.parentElement;
      while (node && node !== document.body) {
        if (node instanceof Element && (node.tagName.toLowerCase() === "shreddit-post" || node.matches("[data-post-id]"))) { container = node; break; }
        node = node.parentElement;
      }
    }
    if (!container) container = document.querySelector("shreddit-post, [data-post-id]");
    const rawId = url.match(/comments\/([a-z0-9]+)\//i)?.[1] ?? container?.getAttribute("data-post-id");
    const externalId = rawId ? `t3_${rawId}` : undefined;
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "reddit", subtype: "reddit_post", externalId };
  } catch {
    return { url, title: selectedText.slice(0, 200), body: selectedText, platform: "reddit", subtype: "reddit_post" };
  }
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
    box-shadow:0 4px 12px rgba(0,0,0,0.15);pointer-events:none;
  `;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// ─── Entity picker panel ─────────────────────────────────────────────────────

let pickerEl: HTMLElement | null = null;

function removePickerPanel() {
  pickerEl?.remove();
  pickerEl = null;
}

function showPickerPanel(item: ExtensionItem, anchorRect: DOMRect, entities: Entity[]) {
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
    sendBtn.textContent = "Sending…";
    sendBtn.style.opacity = "0.6";
    sendBtn.style.cursor = "not-allowed";

    chrome.runtime.sendMessage({ type: "SEND_ITEM", payload: item, entityId }, (response) => {
      removePickerPanel();
      if (chrome.runtime.lastError || !response?.ok) {
        const msg = response?.error === "Not configured"
          ? "Configure Gito extension first"
          : "Failed to send — check API key";
        showToast(msg, "error");
      } else {
        showToast("✓ Sent to Gito", "success");
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

  chrome.runtime.sendMessage({ type: "GET_CONTEXT" }, (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      if (response?.error === "Not configured") {
        showToast("Configure Gito extension first", "error");
      } else {
        // No entities available, send directly
        showPickerPanel(item, anchorRect, []);
      }
      return;
    }
    showPickerPanel(item, anchorRect, response.entities ?? []);
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
