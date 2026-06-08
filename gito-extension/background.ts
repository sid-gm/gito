interface Account {
  id: string;
  gitoUrl: string;
  apiKey: string;
  companyId: string;
  companyName: string;
  entities: { id: string; label: string }[];
}

async function getActiveAccount(): Promise<Account | null> {
  const data = await chrome.storage.sync.get(["accounts", "activeAccountId"]) as {
    accounts?: Account[];
    activeAccountId?: string;
  };
  const accounts = data.accounts ?? [];
  return accounts.find((a) => a.id === data.activeAccountId) ?? accounts[0] ?? null;
}

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
  const local = await chrome.storage.local.get([key]) as Record<string, number>;
  await chrome.storage.local.set({ [key]: (local[key] ?? 0) + 1 });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_CONTEXT") {
    (async () => {
      const account = await getActiveAccount();
      if (!account) {
        sendResponse({ ok: false, error: "Not configured" });
        return;
      }
      sendResponse({ ok: true, entities: account.entities, companyName: account.companyName });
    })();
    return true;
  }

  if (msg.type === "SEND_ITEM") {
    (async () => {
      const account = await getActiveAccount();
      if (!account) {
        sendResponse({ ok: false, error: "Not configured" });
        return;
      }

      const body: Record<string, unknown> = { items: [msg.payload] };
      if (msg.entityId) body.entityId = msg.entityId;

      try {
        const endpoint = new URL("/api/items/extension-ingest", account.gitoUrl).href;
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${account.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        sendResponse({ ok: res.ok, data });
        if (res.ok) await incrementDailyCount();
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }
});
