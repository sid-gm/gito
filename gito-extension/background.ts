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
    func: () => (window as any).__gitoSendSelection?.(),
  });
});

function todayKey(): string {
  return `count_${new Date().toISOString().slice(0, 10)}`;
}

async function incrementDailyCount() {
  const key = todayKey();
  const local = await chrome.storage.local.get([key]);
  const current = (local[key] as number) ?? 0;
  await chrome.storage.local.set({ [key]: current + 1 });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "SEND_ITEM") return;

  (async () => {
    const { gitoUrl, apiKey } = await chrome.storage.sync.get(["gitoUrl", "apiKey"]);
    if (!gitoUrl || !apiKey) {
      sendResponse({ ok: false, error: "Not configured" });
      return;
    }

    try {
      const res = await fetch(`${gitoUrl}/api/items/extension-ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ items: [msg.payload] }),
      });
      const data = await res.json();
      sendResponse({ ok: res.ok, data });
      if (res.ok) await incrementDailyCount();
    } catch (err) {
      sendResponse({ ok: false, error: String(err) });
    }
  })();

  return true; // keep channel open for async response
});
