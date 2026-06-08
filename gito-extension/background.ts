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

interface CollectResult {
  collected: number;
  inserted: number;
  errors: string[];
}

async function runAutoCollect(config: SearchConfig, account: Account, triggeredBy: "auto" | "manual"): Promise<CollectResult> {
  const runId: string = crypto.randomUUID();
  const ranAt = new Date().toISOString();
  const allItems: ExtensionItem[] = [];
  const errors: string[] = [];

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

        console.log(`[Gito auto-collect] opening tab: ${searchUrl}`);
        const tab = await chrome.tabs.create({ url: searchUrl, active: false });
        tabId = tab.id!;
        await waitForTabLoad(tabId, 8000);

        const items =
          platform === "twitter"
            ? await collectX(term, tabId)
            : platform === "threads"
            ? await collectThreads(term, tabId)
            : await collectReddit(term, tabId);

        console.log(`[Gito auto-collect] ${platform}/${term}: ${items.length} items`);
        allItems.push(...items);
        await chrome.tabs.remove(tabId);
        tabId = null;
      } catch (err) {
        const msg = `${platform}/${term}: ${String(err)}`;
        console.error(`[Gito auto-collect] ${msg}`);
        errors.push(msg);
        if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
      }
    }
  }

  const unique = dedupeByExternalId(allItems);
  console.log(`[Gito auto-collect] ${unique.length} unique items after dedup`);

  if (unique.length === 0) {
    await recordRun(account, { runId, ranAt, triggeredBy, config, collected: allItems.length, inserted: 0 });
    return { collected: allItems.length, inserted: 0, errors };
  }

  const res = await fetch(new URL("/api/items/extension-ingest", account.gitoUrl).href, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${account.apiKey}`,
    },
    body: JSON.stringify({ items: unique, collectRunId: runId }),
  });

  if (!res.ok) throw new Error(`Ingest API returned HTTP ${res.status}`);

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

  await recordRun(account, { runId, ranAt, triggeredBy, config, collected: allItems.length, inserted });
  return { collected: allItems.length, inserted, errors };
}

async function recordRun(
  account: Account,
  opts: { runId: string; ranAt: string; triggeredBy: "auto" | "manual"; config: SearchConfig; collected: number; inserted: number }
): Promise<void> {
  try {
    const res = await fetch(new URL("/api/extension-runs", account.gitoUrl).href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify({
        id: opts.runId,
        triggeredBy: opts.triggeredBy,
        ranAt: opts.ranAt,
        searchTerms: opts.config.terms,
        platforms: opts.config.platforms,
        itemsCollected: opts.collected,
        itemsInserted: opts.inserted,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error(`[Gito auto-collect] recordRun HTTP ${res.status}:`, text);
    }
  } catch (err) {
    console.error("[Gito auto-collect] failed to record run:", err);
  }
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

  try {
    await runAutoCollect(config, account, "auto");
  } catch (err) {
    console.error("[Gito auto-collect] run failed:", err);
    const localData = await chrome.storage.local.get(["failureCount"]) as { failureCount?: number };
    const newCount = (localData.failureCount ?? 0) + 1;
    await chrome.storage.local.set({ failureCount: newCount });
    if (newCount >= 3) {
      await chrome.alarms.clear("gito-collect");
      await chrome.storage.sync.set({ autoCollect: { ...config, enabled: false } });
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "RUN_COLLECT_NOW") {
    (async () => {
      const syncData = await chrome.storage.sync.get(["autoCollect", "accounts", "activeAccountId"]) as {
        autoCollect?: SearchConfig;
        accounts?: Account[];
        activeAccountId?: string;
      };
      const config = syncData.autoCollect;
      if (!config?.terms?.length) {
        sendResponse({ ok: false, error: "No search terms configured." });
        return;
      }
      const accounts = syncData.accounts ?? [];
      const account = accounts.find((a) => a.id === syncData.activeAccountId) ?? accounts[0] ?? null;
      if (!account) {
        sendResponse({ ok: false, error: "No account configured." });
        return;
      }
      try {
        const result = await runAutoCollect(config, account, "manual");
        sendResponse({ ok: true, ...result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

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
