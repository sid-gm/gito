import {
  collectX,
  collectThreads,
  collectReddit,
  dedupeByExternalId,
  waitForTabLoad,
  ExtensionItem,
} from "./collector";

interface Account {
  id: string;
  gitoUrl: string;
  apiKey: string;
  companyId: string;
  companyName: string;
  entities: { id: string; label: string }[];
}

interface SearchConfig {
  terms: string[];
  platforms: Array<"twitter" | "threads" | "reddit">;
  intervalMinutes: number;
  enabled: boolean;
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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "gito-collect") return;

  const syncData = await chrome.storage.sync.get(["autoCollect", "accounts", "activeAccountId"]) as {
    autoCollect?: SearchConfig;
    accounts?: Account[];
    activeAccountId?: string;
  };

  const config = syncData.autoCollect;
  if (!config?.enabled || !config.terms?.length) return;

  const accounts = syncData.accounts ?? [];
  const account = accounts.find((a) => a.id === syncData.activeAccountId) ?? accounts[0] ?? null;
  if (!account) return;

  const allItems: ExtensionItem[] = [];
  let collectionFailed = false;

  for (const term of config.terms) {
    for (const platform of config.platforms) {
      let tabId: number | null = null;
      try {
        const searchUrl =
          platform === "twitter"
            ? `https://x.com/search?q=${encodeURIComponent(term)}&f=live`
            : platform === "threads"
            ? `https://www.threads.net/search?q=${encodeURIComponent(term)}&serp_type=default`
            : `https://www.reddit.com/search/?q=${encodeURIComponent(term)}&sort=new`;

        const tab = await chrome.tabs.create({ url: searchUrl, active: false });
        tabId = tab.id!;
        await waitForTabLoad(tabId, 8000);

        const items =
          platform === "twitter"
            ? await collectX(term, tabId)
            : platform === "threads"
            ? await collectThreads(term, tabId)
            : await collectReddit(term, tabId);

        allItems.push(...items);
        await chrome.tabs.remove(tabId);
        tabId = null;
      } catch (err) {
        console.error(`[Gito auto-collect] ${platform}/${term}:`, err);
        collectionFailed = true;
        if (tabId !== null) {
          chrome.tabs.remove(tabId).catch(() => {});
        }
      }
    }
  }

  if (allItems.length === 0 && collectionFailed) {
    const localData = await chrome.storage.local.get(["failureCount"]) as { failureCount?: number };
    const newCount = (localData.failureCount ?? 0) + 1;
    await chrome.storage.local.set({ failureCount: newCount });

    if (newCount >= 3) {
      await chrome.alarms.clear("gito-collect");
      await chrome.storage.sync.set({
        autoCollect: { ...config, enabled: false },
      });
    }
    return;
  }

  const unique = dedupeByExternalId(allItems);
  if (unique.length === 0) return;

  try {
    const res = await fetch(
      new URL("/api/items/extension-ingest", account.gitoUrl).href,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${account.apiKey}`,
        },
        body: JSON.stringify({ items: unique }),
      }
    );

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const inserted: number = data.inserted ?? 0;

    const today = new Date().toISOString().slice(0, 10);
    const stats = await chrome.storage.local.get(["dailyCount"]) as {
      dailyCount?: { date: string; count: number };
    };
    await chrome.storage.local.set({
      lastRun: new Date().toISOString(),
      lastInserted: inserted,
      failureCount: 0,
      dailyCount:
        stats.dailyCount?.date === today
          ? { date: today, count: stats.dailyCount.count + inserted }
          : { date: today, count: inserted },
    });

    if (inserted > 0) {
      chrome.action.setBadgeText({ text: String(inserted) });
      chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
      setTimeout(() => chrome.action.setBadgeText({ text: "" }), 30000);
    }
  } catch (err) {
    console.error("[Gito auto-collect] ingest POST failed:", err);
    const localData = await chrome.storage.local.get(["failureCount"]) as { failureCount?: number };
    const newCount = (localData.failureCount ?? 0) + 1;
    await chrome.storage.local.set({ failureCount: newCount });

    if (newCount >= 3) {
      await chrome.alarms.clear("gito-collect");
      await chrome.storage.sync.set({
        autoCollect: { ...config, enabled: false },
      });
    }
  }
});

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

      const allItems = [msg.payload, ...(msg.replies ?? [])];
      const body: Record<string, unknown> = { items: allItems };
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
