import {
  collectX,
  collectThreads,
  collectReddit,
  collectXThread,
  collectThreadsThread,
  collectXProfile,
  dedupeByExternalId,
  waitForTabLoad,
  ExtensionItem,
} from "./collector";

interface TrackedThread {
  url: string;
  platform: string;
  externalId?: string | null;
}

interface Account {
  id: string;
  gitoUrl: string;
  apiKey: string;
  companyId: string;
  companyName: string;
  entities: { id: string; label: string }[];
  trackedThreads: TrackedThread[];
  twitterAccounts: string[];
  redditSubreddits: Array<{ subredditName: string; keywordFilters: string[] }>;
}

interface SearchConfig {
  terms: string[];
  platforms: Array<"twitter" | "threads" | "reddit">;
  intervalMinutes: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Queue types — persisted in chrome.storage.local between SW invocations
// ---------------------------------------------------------------------------

type QueueEntry =
  | { type: "keyword"; term: string; platforms?: Array<"twitter" | "threads" | "reddit"> }
  | { type: "reddit_subreddit"; subredditName: string; keywordFilters: string[] }
  | { type: "tracked" };            // processes all tracked threads + Twitter profiles

interface ActiveRunState {
  runId: string;
  ranAt: string;
  triggeredBy: "auto" | "manual";
  platforms: Array<"twitter" | "threads" | "reddit">;
  terms: string[];
  totalCollected: number;
  totalInserted: number;
  errors: string[];
}

interface StoredQueue {
  entries: QueueEntry[];
  state: ActiveRunState;
}

const QUEUE_KEY = "gitoCollectQueue";
const MAX_THREAD_DRILLS = 5;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getActiveAccount(): Promise<Account | null> {
  const data = await chrome.storage.sync.get(["accounts", "activeAccountId"]) as {
    accounts?: Account[];
    activeAccountId?: string;
  };
  const accounts = data.accounts ?? [];
  return accounts.find((a) => a.id === data.activeAccountId) ?? accounts[0] ?? null;
}

function todayKey(): string {
  return `count_${new Date().toISOString().slice(0, 10)}`;
}

async function incrementDailyCount() {
  const key = todayKey();
  const local = await chrome.storage.local.get([key]) as Record<string, number>;
  await chrome.storage.local.set({ [key]: (local[key] ?? 0) + 1 });
}

// Send a batch of items to the ingest API immediately.
async function ingestBatch(
  items: ExtensionItem[],
  account: Account,
  runId: string,
): Promise<{ inserted: number; error?: string }> {
  if (items.length === 0) return { inserted: 0 };
  const unique = dedupeByExternalId(items);
  try {
    const res = await fetch(new URL("/api/items/extension-ingest", account.gitoUrl).href, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${account.apiKey}`,
      },
      body: JSON.stringify({ items: unique, collectRunId: runId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { inserted: 0, error: `Ingest failed: HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return { inserted: data.inserted ?? 0 };
  } catch (err) {
    return { inserted: 0, error: `Ingest error: ${String(err)}` };
  }
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
      console.error(`[Gito] recordRun HTTP ${res.status}:`, text);
    }
  } catch (err) {
    console.error("[Gito] failed to record run:", err);
  }
}

// ---------------------------------------------------------------------------
// Per-entry processors
// ---------------------------------------------------------------------------

interface SessionResult {
  collected: number;
  inserted: number;
  errors: string[];
}

function buildRedditSubredditUrl(subredditName: string, keywordFilters: string[]): string {
  if (subredditName === "all") {
    const q = keywordFilters.join(" OR ");
    return `https://www.reddit.com/search/?q=${encodeURIComponent(q)}&sort=new`;
  }
  if (keywordFilters.length === 0) {
    return `https://www.reddit.com/r/${subredditName}/new/`;
  }
  const q = keywordFilters.join(" OR ");
  return `https://www.reddit.com/r/${subredditName}/search/?q=${encodeURIComponent(q)}&restrict_sr=1&sort=new`;
}

async function processRedditSubredditEntry(
  entry: { subredditName: string; keywordFilters: string[] },
  state: ActiveRunState,
  account: Account,
): Promise<SessionResult> {
  const searchUrl = buildRedditSubredditUrl(entry.subredditName, entry.keywordFilters);
  let collected = 0;
  let inserted = 0;
  const errors: string[] = [];
  let tabId: number | null = null;

  try {
    console.log(`[Gito] opening tab: ${searchUrl}`);
    const tab = await chrome.tabs.create({ url: searchUrl, active: false });
    tabId = tab.id!;
    await waitForTabLoad(tabId, 8000);
    const searchItems = await collectReddit(`r/${entry.subredditName}`, tabId);
    console.log(`[Gito] reddit/r/${entry.subredditName}: ${searchItems.length} items`);
    await chrome.tabs.remove(tabId);
    tabId = null;

    if (searchItems.length > 0) {
      collected += searchItems.length;
      const { inserted: n, error } = await ingestBatch(searchItems, account, state.runId);
      if (error) { errors.push(error); console.error(`[Gito] ${error}`); }
      inserted += n;
    }
  } catch (err) {
    const msg = `reddit/r/${entry.subredditName}: ${String(err)}`;
    console.error(`[Gito] ${msg}`);
    errors.push(msg);
    if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
  }

  return { collected, inserted, errors };
}

async function processKeywordEntry(
  term: string,
  state: ActiveRunState,
  account: Account,
  platformsOverride?: Array<"twitter" | "threads" | "reddit">,
): Promise<SessionResult> {
  let collected = 0;
  let inserted = 0;
  const errors: string[] = [];

  for (const platform of (platformsOverride ?? state.platforms)) {
    let tabId: number | null = null;
    let searchItems: ExtensionItem[] = [];
    try {
      const searchUrl =
        platform === "twitter"
          ? `https://x.com/search?q=${encodeURIComponent(term)}&f=live`
          : platform === "threads"
          ? `https://www.threads.com/search?q=${encodeURIComponent(term)}&serp_type=default&filter=recent`
          : `https://www.reddit.com/search/?q=${encodeURIComponent(term)}&sort=new`;

      console.log(`[Gito] opening tab: ${searchUrl}`);
      const tab = await chrome.tabs.create({ url: searchUrl, active: false });
      tabId = tab.id!;
      await waitForTabLoad(tabId, 8000);

      searchItems =
        platform === "twitter"
          ? await collectX(term, tabId)
          : platform === "threads"
          ? await collectThreads(term, tabId)
          : await collectReddit(term, tabId);

      console.log(`[Gito] ${platform}/${term}: ${searchItems.length} items`);
      await chrome.tabs.remove(tabId);
      tabId = null;
    } catch (err) {
      const msg = `${platform}/${term}: ${String(err)}`;
      console.error(`[Gito] ${msg}`);
      errors.push(msg);
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
      searchItems = [];
    }

    if (searchItems.length > 0) {
      collected += searchItems.length;
      const { inserted: n, error } = await ingestBatch(searchItems, account, state.runId);
      if (error) { errors.push(error); console.error(`[Gito] ${error}`); }
      inserted += n;
    }

    // Drill into individual thread pages (capped to keep this session short).
    if (platform === "twitter" || platform === "threads") {
      const postUrls = searchItems
        .filter((i) => i.subtype === "x_post" || i.subtype === "threads_post")
        .map((i) => ({ url: i.url, externalId: i.externalId }))
        .filter((v, idx, arr) => arr.findIndex((x) => x.url === v.url) === idx)
        .slice(0, MAX_THREAD_DRILLS);

      for (const post of postUrls) {
        let threadTabId: number | null = null;
        try {
          console.log(`[Gito] drilling into thread: ${post.url}`);
          const threadTab = await chrome.tabs.create({ url: post.url, active: false });
          threadTabId = threadTab.id!;
          await waitForTabLoad(threadTabId, 8000);
          const threadItems = platform === "twitter"
            ? await collectXThread(post.url, threadTabId, post.externalId ?? undefined)
            : await collectThreadsThread(post.url, threadTabId);
          console.log(`[Gito] thread ${post.url}: ${threadItems.length} items`);
          await chrome.tabs.remove(threadTabId);
          threadTabId = null;

          if (threadItems.length > 0) {
            collected += threadItems.length;
            const { inserted: n, error } = await ingestBatch(threadItems, account, state.runId);
            if (error) { errors.push(error); console.error(`[Gito] ${error}`); }
            inserted += n;
          }
        } catch (err) {
          const msg = `${platform} thread ${post.url}: ${String(err)}`;
          console.error(`[Gito] ${msg}`);
          errors.push(msg);
          if (threadTabId !== null) chrome.tabs.remove(threadTabId).catch(() => {});
        }
      }
    }
  }

  return { collected, inserted, errors };
}

async function processTrackedEntry(
  state: ActiveRunState,
  account: Account,
): Promise<SessionResult> {
  let collected = 0;
  let inserted = 0;
  const errors: string[] = [];

  for (const thread of (account.trackedThreads ?? [])) {
    if (thread.platform !== "twitter" && thread.platform !== "threads") continue;
    let tabId: number | null = null;
    try {
      console.log(`[Gito] tracked thread: ${thread.url}`);
      const tab = await chrome.tabs.create({ url: thread.url, active: false });
      tabId = tab.id!;
      await waitForTabLoad(tabId, 8000);
      const threadItems = thread.platform === "twitter"
        ? await collectXThread(thread.url, tabId, thread.externalId ?? undefined)
        : await collectThreadsThread(thread.url, tabId);
      console.log(`[Gito] tracked thread ${thread.url}: ${threadItems.length} items`);
      await chrome.tabs.remove(tabId);
      tabId = null;

      if (threadItems.length > 0) {
        collected += threadItems.length;
        const { inserted: n, error } = await ingestBatch(threadItems, account, state.runId);
        if (error) { errors.push(error); console.error(`[Gito] ${error}`); }
        inserted += n;
      }
    } catch (err) {
      const msg = `tracked thread ${thread.url}: ${String(err)}`;
      console.error(`[Gito] ${msg}`);
      errors.push(msg);
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  for (const handle of (account.twitterAccounts ?? [])) {
    let tabId: number | null = null;
    try {
      const profileUrl = `https://x.com/${handle}`;
      console.log(`[Gito] twitter profile: @${handle}`);
      const tab = await chrome.tabs.create({ url: profileUrl, active: false });
      tabId = tab.id!;
      await waitForTabLoad(tabId, 8000);
      const profileItems = await collectXProfile(handle, tabId);
      console.log(`[Gito] @${handle}: ${profileItems.length} items`);
      await chrome.tabs.remove(tabId);
      tabId = null;

      if (profileItems.length > 0) {
        collected += profileItems.length;
        const { inserted: n, error } = await ingestBatch(profileItems, account, state.runId);
        if (error) { errors.push(error); console.error(`[Gito] ${error}`); }
        inserted += n;
      }
    } catch (err) {
      const msg = `twitter profile @${handle}: ${String(err)}`;
      console.error(`[Gito] ${msg}`);
      errors.push(msg);
      if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
    }
  }

  return { collected, inserted, errors };
}

// ---------------------------------------------------------------------------
// Queue engine
// ---------------------------------------------------------------------------

// Kick off a new run. Writes the full queue to storage, then processes the
// first entry immediately in the current SW invocation.
async function startCollectRun(
  config: SearchConfig,
  account: Account,
  triggeredBy: "auto" | "manual",
): Promise<SessionResult> {
  const configuredSubreddits = account.redditSubreddits ?? [];
  const hasSubreddits = configuredSubreddits.length > 0 && config.platforms.includes("reddit");
  const keywordPlatforms = hasSubreddits
    ? config.platforms.filter((p) => p !== "reddit")
    : config.platforms;

  const entries: QueueEntry[] = [];
  if (keywordPlatforms.length > 0) {
    for (const term of config.terms) {
      entries.push(hasSubreddits
        ? { type: "keyword", term, platforms: keywordPlatforms }
        : { type: "keyword", term });
    }
  }
  if (hasSubreddits) {
    for (const sub of configuredSubreddits) {
      entries.push({ type: "reddit_subreddit", subredditName: sub.subredditName, keywordFilters: sub.keywordFilters });
    }
  }
  entries.push({ type: "tracked" });

  const state: ActiveRunState = {
    runId: crypto.randomUUID(),
    ranAt: new Date().toISOString(),
    triggeredBy,
    platforms: config.platforms,
    terms: config.terms,
    totalCollected: 0,
    totalInserted: 0,
    errors: [],
  };

  // Create the run record immediately so the FK constraint is satisfied for all
  // incremental ingest calls that reference this runId.
  await recordRun(account, {
    runId: state.runId,
    ranAt: state.ranAt,
    triggeredBy,
    config: { terms: config.terms, platforms: config.platforms, intervalMinutes: 0, enabled: true },
    collected: 0,
    inserted: 0,
  });

  // Write the full queue (minus the first entry, which we're about to process).
  const [first, ...remaining] = entries;
  await chrome.storage.local.set({ [QUEUE_KEY]: { entries: remaining, state } as StoredQueue });

  // Process the first entry now, in this SW invocation.
  return processEntry(first, state, account, remaining);
}

// Process one queue entry, then either schedule the next alarm or finalise.
async function processEntry(
  entry: QueueEntry,
  state: ActiveRunState,
  account: Account,
  remaining: QueueEntry[],
): Promise<SessionResult> {
  const result = entry.type === "keyword"
    ? await processKeywordEntry(entry.term, state, account, entry.platforms)
    : entry.type === "reddit_subreddit"
    ? await processRedditSubredditEntry(entry, state, account)
    : await processTrackedEntry(state, account);

  const updatedState: ActiveRunState = {
    ...state,
    totalCollected: state.totalCollected + result.collected,
    totalInserted: state.totalInserted + result.inserted,
    errors: [...state.errors, ...result.errors],
  };

  if (remaining.length > 0) {
    // Persist updated state + remaining queue, then hand off to the next alarm.
    await chrome.storage.local.set({ [QUEUE_KEY]: { entries: remaining, state: updatedState } as StoredQueue });
    const label = remaining[0].type === "keyword"
      ? `"${remaining[0].term}"`
      : remaining[0].type === "reddit_subreddit"
      ? `r/${remaining[0].subredditName}`
      : "tracked threads";
    console.log(`[Gito] session done — scheduling next session (${label}) in 30s`);
    // Chrome clamps delayInMinutes to a minimum of 0.5 (30 seconds).
    chrome.alarms.create("gito-collect-next", { delayInMinutes: 0.5 });
  } else {
    // All sessions complete — finalise.
    await chrome.storage.local.remove([QUEUE_KEY]);
    await finaliseRun(updatedState, account);
  }

  return result;
}

// Called when the "gito-collect-next" alarm fires to continue the queue.
async function continueQueue(account: Account): Promise<void> {
  const data = await chrome.storage.local.get([QUEUE_KEY]) as { [key: string]: StoredQueue };
  const queued = data[QUEUE_KEY];

  if (!queued || queued.entries.length === 0) {
    await chrome.storage.local.remove([QUEUE_KEY]);
    return;
  }

  const [current, ...remaining] = queued.entries;
  await processEntry(current, queued.state, account, remaining);
}

async function finaliseRun(state: ActiveRunState, account: Account): Promise<void> {
  console.log(`[Gito] run complete — ${state.totalInserted} inserted across ${state.terms.length} keywords`);

  const today = new Date().toISOString().slice(0, 10);
  const stats = await chrome.storage.local.get(["dailyCount"]) as {
    dailyCount?: { date: string; count: number };
  };
  await chrome.storage.local.set({
    lastRun: new Date().toISOString(),
    lastInserted: state.totalInserted,
    failureCount: 0,
    dailyCount:
      stats.dailyCount?.date === today
        ? { date: today, count: stats.dailyCount.count + state.totalInserted }
        : { date: today, count: state.totalInserted },
  });

  if (state.totalInserted > 0) {
    chrome.action.setBadgeText({ text: String(state.totalInserted) });
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
    setTimeout(() => chrome.action.setBadgeText({ text: "" }), 30000);
  }

  await recordRun(account, {
    runId: state.runId,
    ranAt: state.ranAt,
    triggeredBy: state.triggeredBy,
    config: { terms: state.terms, platforms: state.platforms, intervalMinutes: 0, enabled: true },
    collected: state.totalCollected,
    inserted: state.totalInserted,
  });
}

// ---------------------------------------------------------------------------
// Chrome event listeners
// ---------------------------------------------------------------------------

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

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Scheduled periodic collect — starts a fresh run for the full config.
  if (alarm.name === "gito-collect") {
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
      await startCollectRun(config, account, "auto");
    } catch (err) {
      console.error("[Gito] run failed:", err);
      const localData = await chrome.storage.local.get(["failureCount"]) as { failureCount?: number };
      const newCount = (localData.failureCount ?? 0) + 1;
      await chrome.storage.local.set({ failureCount: newCount });
      if (newCount >= 3) {
        await chrome.alarms.clear("gito-collect");
        await chrome.storage.sync.set({ autoCollect: { ...config, enabled: false } });
      }
    }
    return;
  }

  // Inter-session alarm — continues an in-progress queue.
  if (alarm.name === "gito-collect-next") {
    const account = await getActiveAccount();
    if (!account) {
      await chrome.storage.local.remove([QUEUE_KEY]);
      return;
    }
    try {
      await continueQueue(account);
    } catch (err) {
      console.error("[Gito] session failed:", err);
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
        // Process first keyword now, remaining sessions continue via alarms.
        // totalSessions = number of keywords + 1 for tracked/profiles.
        const totalSessions = config.terms.length + 1;
        const firstResult = await startCollectRun(config, account, "manual");
        sendResponse({
          ok: true,
          collected: firstResult.collected,
          inserted: firstResult.inserted,
          errors: firstResult.errors,
          // Let the popup know more sessions are running in the background.
          pendingSessions: totalSessions - 1,
        });
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
