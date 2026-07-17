// Background service worker — protocol v2.
// The extension is a stateless worker: it holds only URL + API key, pulls a
// fresh config snapshot at the start of every run, and reports its own health.

import {
  collectX,
  collectXThread,
  collectXProfile,
  collectThreads,
  collectThreadsThread,
  collectRedditListing,
  collectRedditThread,
  detectPageHealth,
  dedupeItems,
  waitForTabLoad,
  ExtensionItem,
  PageHealth,
} from "./collector";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Connection {
  gitoUrl: string;
  apiKey: string;
  companyId: string;
  companyName: string;
}

interface ServerContext {
  companyId: string;
  companyName: string;
  topics: Array<{ id: string; label: string }>;
  keywords: Array<{ id: string; term: string; platforms: string[]; topicId: string | null }>;
  redditSubreddits: Array<{ subredditName: string; sorts: string[]; keywordFilters: string[] }>;
  profiles: Array<{ platform: string; username: string }>;
  trackedThreads: Array<{ url: string; platform: string; externalId?: string | null; topicId?: string | null }>;
  settings: {
    intervalMinutes: number;
    enabled: boolean;
    pausedPlatforms: string[];
    maxThreadDrills: number;
    visionDisabledPlatforms: string[];
  };
}

type CollectorPlatform = "twitter" | "threads" | "reddit";

type Session =
  | { type: "keyword"; platform: CollectorPlatform; term: string; topicId: string | null }
  | { type: "subreddit"; name: string; sort: "new" | "hot"; keywordFilters: string[] }
  | { type: "thread"; platform: CollectorPlatform; url: string; externalId?: string | null; topicId?: string | null }
  | { type: "profile"; platform: "twitter" | "threads"; username: string };

interface PlatformTally {
  collected: number;
  errors: number;
  blocked?: boolean;
}

interface RunState {
  runId: string;
  triggeredBy: "auto" | "manual";
  startedAt: string;
  totalCollected: number;
  totalInserted: number;
  maxThreadDrills: number;
  pausedPlatforms: string[]; // grows when a platform blocks mid-run
  perPlatform: Record<string, PlatformTally>;
}

interface StoredQueue {
  sessions: Session[];
  state: RunState;
}

const QUEUE_KEY = "gitoCollectQueue";
const MAX_SESSIONS_PER_RUN = 40;
const TAB_LOAD_TIMEOUT = 8000;

// ---------------------------------------------------------------------------
// Connection + API client
// ---------------------------------------------------------------------------

async function getConnection(): Promise<Connection | null> {
  const data = (await chrome.storage.sync.get(["connection"])) as { connection?: Connection };
  return data.connection ?? null;
}

async function api(conn: Connection, path: string, init?: RequestInit): Promise<Response> {
  return fetch(new URL(path, conn.gitoUrl).href, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${conn.apiKey}`,
      ...(init?.headers ?? {}),
    },
  });
}

async function fetchContext(conn: Connection): Promise<ServerContext> {
  const res = await api(conn, "/api/extension/context");
  if (!res.ok) throw new Error(`context HTTP ${res.status}`);
  return (await res.json()) as ServerContext;
}

async function runStart(conn: Connection, runId: string, triggeredBy: "auto" | "manual"): Promise<void> {
  const res = await api(conn, "/api/extension-runs", {
    method: "POST",
    body: JSON.stringify({ action: "start", id: runId, triggeredBy }),
  });
  if (!res.ok) throw new Error(`run start HTTP ${res.status}`);
}

async function runEvent(
  conn: Connection,
  runId: string,
  event: {
    platform: string;
    sourceKind?: string | null;
    sourceRef?: string | null;
    status: "ok" | "zero_results" | "http_403" | "logged_out" | "checkpoint" | "vision_fallback" | "error";
    detail?: string | null;
    itemsCount?: number;
  }
): Promise<void> {
  await api(conn, "/api/extension-runs", {
    method: "POST",
    body: JSON.stringify({ action: "event", runId, ...event }),
  }).catch((err) => console.error("[Gito] run event failed:", err));
}

async function runFinalize(conn: Connection, state: RunState): Promise<void> {
  await api(conn, "/api/extension-runs", {
    method: "POST",
    body: JSON.stringify({
      action: "finalize",
      runId: state.runId,
      itemsCollected: state.totalCollected,
      itemsInserted: state.totalInserted,
    }),
  }).catch((err) => console.error("[Gito] finalize failed:", err));
}

// The extension never talks to Telegram directly — it posts health events and
// the server's state machine decides whether to alert.
async function postHealth(
  conn: Connection,
  platform: string,
  status: "ok" | "zero_results" | "http_403" | "logged_out" | "checkpoint" | "error",
  detail?: string
): Promise<void> {
  await api(conn, "/api/extension/health", {
    method: "POST",
    body: JSON.stringify({ platform, status, detail: detail ?? null }),
  }).catch((err) => console.error("[Gito] health post failed:", err));
}

async function ingestBatch(
  conn: Connection,
  items: ExtensionItem[],
  runId?: string
): Promise<{ inserted: number; updated: number; error?: string }> {
  if (items.length === 0) return { inserted: 0, updated: 0 };
  const unique = dedupeItems(items);
  try {
    const res = await api(conn, "/api/items/extension-ingest", {
      method: "POST",
      body: JSON.stringify({ items: unique, ...(runId ? { collectRunId: runId } : {}) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { inserted: 0, updated: 0, error: `Ingest HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    const data = await res.json();
    return { inserted: data.inserted ?? 0, updated: data.updated ?? 0 };
  } catch (err) {
    return { inserted: 0, updated: 0, error: `Ingest error: ${String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Session execution
// ---------------------------------------------------------------------------

function sessionPlatform(s: Session): string {
  switch (s.type) {
    case "keyword": return s.platform;
    case "subreddit": return "reddit";
    case "thread": return s.platform;
    case "profile": return s.platform;
  }
}

function sessionUrl(s: Session): string {
  switch (s.type) {
    case "keyword":
      if (s.platform === "twitter") return `https://x.com/search?q=${encodeURIComponent(s.term)}&f=live`;
      if (s.platform === "threads") return `https://www.threads.com/search?q=${encodeURIComponent(s.term)}&serp_type=default&filter=recent`;
      return `https://www.reddit.com/search/?q=${encodeURIComponent(s.term)}&sort=new`;
    case "subreddit":
      return `https://www.reddit.com/r/${s.name}/${s.sort}/`;
    case "thread":
      return s.url;
    case "profile":
      return s.platform === "twitter" ? `https://x.com/${s.username}` : `https://www.threads.com/@${s.username}`;
  }
}

function sessionSource(s: Session): { sourceKind: ExtensionItem["sourceKind"]; sourceRef: string } {
  switch (s.type) {
    case "keyword": return { sourceKind: "keyword_search", sourceRef: s.term };
    case "subreddit": return { sourceKind: s.sort === "hot" ? "subreddit_hot" : "subreddit_new", sourceRef: s.name };
    case "thread": return { sourceKind: "tracked_thread", sourceRef: s.url };
    case "profile": return { sourceKind: "profile", sourceRef: s.username };
  }
}

async function collectForSession(s: Session, tabId: number): Promise<ExtensionItem[]> {
  switch (s.type) {
    case "keyword":
      if (s.platform === "twitter") return collectX(s.term, tabId);
      if (s.platform === "threads") return collectThreads(s.term, tabId);
      return collectRedditListing(tabId);
    case "subreddit": {
      const items = await collectRedditListing(tabId);
      if (s.keywordFilters.length === 0) return items;
      const filters = s.keywordFilters.map((f) => f.toLowerCase());
      return items.filter((i) =>
        filters.some((f) => (i.title ?? "").toLowerCase().includes(f) || (i.body ?? "").toLowerCase().includes(f))
      );
    }
    case "thread":
      if (s.platform === "twitter") return collectXThread(s.url, tabId, s.externalId ?? undefined);
      if (s.platform === "threads") return collectThreadsThread(s.url, tabId);
      return collectRedditThread(s.url, tabId);
    case "profile":
      return s.platform === "twitter" ? collectXProfile(s.username, tabId) : collectThreads(s.username, tabId);
  }
}

function threadCollectorFor(platform: CollectorPlatform) {
  if (platform === "twitter") return collectXThread;
  if (platform === "threads") return (url: string, tabId: number) => collectThreadsThread(url, tabId);
  return (url: string, tabId: number) => collectRedditThread(url, tabId);
}

interface SessionResult {
  collected: number;
  inserted: number;
  blockedPlatform?: string;
}

async function runSession(conn: Connection, session: Session, state: RunState): Promise<SessionResult> {
  const platform = sessionPlatform(session);
  const { sourceKind, sourceRef } = sessionSource(session);
  const topicId = session.type === "keyword" || session.type === "thread" ? session.topicId ?? null : null;

  if (state.pausedPlatforms.includes(platform)) {
    return { collected: 0, inserted: 0 };
  }

  let tabId: number | null = null;
  let collected = 0;
  let inserted = 0;

  const stamp = (items: ExtensionItem[]): ExtensionItem[] =>
    items.map((i) => ({ ...i, sourceKind, sourceRef, ...(topicId ? { topicId } : {}) }));

  try {
    const tab = await chrome.tabs.create({ url: sessionUrl(session), active: false });
    tabId = tab.id!;
    await waitForTabLoad(tabId, TAB_LOAD_TIMEOUT);

    // Health first: a login wall or 403 pauses THAT platform, alerts, and the
    // rest of the run keeps going (no more silent 3-strikes-disable-everything).
    const health: PageHealth = await detectPageHealth(tabId, platform).catch(() => "ok");
    if (health !== "ok") {
      console.warn(`[Gito] ${platform} page unhealthy: ${health}`);
      await runEvent(conn, state.runId, { platform, sourceKind, sourceRef, status: health, itemsCount: 0 });
      await postHealth(conn, platform, health);
      state.pausedPlatforms.push(platform);
      const tally = state.perPlatform[platform] ?? (state.perPlatform[platform] = { collected: 0, errors: 0 });
      tally.blocked = true;
      return { collected: 0, inserted: 0, blockedPlatform: platform };
    }

    const items = stamp(await collectForSession(session, tabId));
    collected += items.length;

    if (items.length > 0) {
      const r = await ingestBatch(conn, items, state.runId);
      if (r.error) console.error(`[Gito] ${r.error}`);
      inserted += r.inserted;
    }

    // Drill into individual posts for their comment trees (listing sessions only)
    if ((session.type === "keyword" || session.type === "subreddit") && state.maxThreadDrills > 0) {
      const drillPlatform = platform as CollectorPlatform;
      const collectThread = threadCollectorFor(drillPlatform);
      const posts = items
        .filter((i) => i.kind === "post" && i.url)
        .filter((v, idx, arr) => arr.findIndex((x) => x.url === v.url) === idx)
        .slice(0, state.maxThreadDrills);

      for (const post of posts) {
        let drillTabId: number | null = null;
        try {
          const drillTab = await chrome.tabs.create({ url: post.url!, active: false });
          drillTabId = drillTab.id!;
          await waitForTabLoad(drillTabId, TAB_LOAD_TIMEOUT);
          const threadItems = stamp(await collectThread(post.url!, drillTabId, post.externalId ?? undefined));
          await chrome.tabs.remove(drillTabId);
          drillTabId = null;

          collected += threadItems.length;
          if (threadItems.length > 0) {
            const r = await ingestBatch(conn, threadItems, state.runId);
            if (r.error) console.error(`[Gito] ${r.error}`);
            inserted += r.inserted;
          }
        } catch (err) {
          console.error(`[Gito] drill ${post.url}:`, err);
          if (drillTabId !== null) chrome.tabs.remove(drillTabId).catch(() => {});
        }
      }
    }

    await chrome.tabs.remove(tabId);
    tabId = null;

    await runEvent(conn, state.runId, {
      platform,
      sourceKind,
      sourceRef,
      status: collected === 0 ? "zero_results" : "ok",
      itemsCount: collected,
    });
  } catch (err) {
    console.error(`[Gito] session ${sourceKind}/${sourceRef}:`, err);
    if (tabId !== null) chrome.tabs.remove(tabId).catch(() => {});
    await runEvent(conn, state.runId, {
      platform,
      sourceKind,
      sourceRef,
      status: "error",
      detail: String(err).slice(0, 300),
      itemsCount: collected,
    });
    await postHealth(conn, platform, "error", String(err).slice(0, 200));
    const tally = state.perPlatform[platform] ?? (state.perPlatform[platform] = { collected: 0, errors: 0 });
    tally.errors += 1;
  }

  const tally = state.perPlatform[platform] ?? (state.perPlatform[platform] = { collected: 0, errors: 0 });
  tally.collected += collected;

  return { collected, inserted };
}

// ---------------------------------------------------------------------------
// Run lifecycle
// ---------------------------------------------------------------------------

function buildSessions(ctx: ServerContext): Session[] {
  const paused = new Set(ctx.settings.pausedPlatforms);
  const sessions: Session[] = [];

  for (const kw of ctx.keywords) {
    for (const p of kw.platforms) {
      if (p !== "twitter" && p !== "threads" && p !== "reddit") continue;
      if (paused.has(p)) continue;
      sessions.push({ type: "keyword", platform: p, term: kw.term, topicId: kw.topicId });
    }
  }

  if (!paused.has("reddit")) {
    for (const sub of ctx.redditSubreddits) {
      for (const sort of sub.sorts) {
        if (sort !== "new" && sort !== "hot") continue;
        sessions.push({ type: "subreddit", name: sub.subredditName, sort, keywordFilters: sub.keywordFilters ?? [] });
      }
    }
  }

  for (const t of ctx.trackedThreads) {
    if (t.platform !== "twitter" && t.platform !== "threads" && t.platform !== "reddit") continue; // no collectors yet for the rest
    if (paused.has(t.platform)) continue;
    sessions.push({ type: "thread", platform: t.platform, url: t.url, externalId: t.externalId, topicId: t.topicId });
  }

  // Profile timelines — collectors exist for twitter + threads only.
  const seenProfiles = new Set<string>();
  for (const p of ctx.profiles ?? []) {
    if (p.platform !== "twitter" && p.platform !== "threads") continue;
    if (paused.has(p.platform)) continue;
    const key = `${p.platform}:${p.username.toLowerCase()}`;
    if (seenProfiles.has(key)) continue;
    seenProfiles.add(key);
    sessions.push({ type: "profile", platform: p.platform, username: p.username });
  }

  if (sessions.length > MAX_SESSIONS_PER_RUN) {
    console.warn(`[Gito] capping run at ${MAX_SESSIONS_PER_RUN} sessions (${sessions.length} configured)`);
    return sessions.slice(0, MAX_SESSIONS_PER_RUN);
  }
  return sessions;
}

async function startRun(triggeredBy: "auto" | "manual"): Promise<{ ok: boolean; error?: string; pendingSessions?: number }> {
  const conn = await getConnection();
  if (!conn) return { ok: false, error: "Not configured" };

  let ctx: ServerContext;
  try {
    ctx = await fetchContext(conn);
  } catch (err) {
    console.error("[Gito] context fetch failed:", err);
    return { ok: false, error: `Could not load config: ${String(err)}` };
  }

  // Keep the schedule in sync with server config on every run
  await chrome.storage.local.set({ serverSettings: ctx.settings });
  chrome.alarms.create("gito-collect", { periodInMinutes: Math.max(10, ctx.settings.intervalMinutes) });

  if (!ctx.settings.enabled && triggeredBy === "auto") {
    console.log("[Gito] collector disabled on server — skipping run");
    return { ok: true, pendingSessions: 0 };
  }

  const sessions = buildSessions(ctx);
  if (sessions.length === 0) {
    return { ok: false, error: "Nothing to collect — add keywords or subreddits on the site." };
  }

  const state: RunState = {
    runId: crypto.randomUUID(),
    triggeredBy,
    startedAt: new Date().toISOString(),
    totalCollected: 0,
    totalInserted: 0,
    maxThreadDrills: ctx.settings.maxThreadDrills ?? 5,
    pausedPlatforms: [...ctx.settings.pausedPlatforms],
    perPlatform: {},
  };

  try {
    await runStart(conn, state.runId, triggeredBy);
  } catch (err) {
    return { ok: false, error: `Could not start run: ${String(err)}` };
  }

  const [first, ...remaining] = sessions;
  await chrome.storage.local.set({ [QUEUE_KEY]: { sessions: remaining, state } as StoredQueue });
  await processSession(first, state, remaining, conn);

  return { ok: true, pendingSessions: remaining.length };
}

async function processSession(session: Session, state: RunState, remaining: Session[], conn: Connection): Promise<void> {
  const result = await runSession(conn, session, state);

  const updated: RunState = {
    ...state,
    totalCollected: state.totalCollected + result.collected,
    totalInserted: state.totalInserted + result.inserted,
  };

  // Drop queued sessions for a platform that just blocked
  const stillQueued = result.blockedPlatform
    ? remaining.filter((s) => sessionPlatform(s) !== result.blockedPlatform)
    : remaining;

  if (stillQueued.length > 0) {
    await chrome.storage.local.set({ [QUEUE_KEY]: { sessions: stillQueued, state: updated } as StoredQueue });
    // Chrome clamps delayInMinutes to a minimum of 0.5 (30s) — our pacing gap
    chrome.alarms.create("gito-collect-next", { delayInMinutes: 0.5 });
  } else {
    await chrome.storage.local.remove([QUEUE_KEY]);
    await finalizeRun(updated, conn);
  }
}

async function finalizeRun(state: RunState, conn: Connection): Promise<void> {
  console.log(`[Gito] run complete — ${state.totalInserted} inserted / ${state.totalCollected} collected`);

  // Platform health rollup: ok where we got items; zero_results is the soft
  // "0 items across every session on a platform" signal.
  for (const [platform, tally] of Object.entries(state.perPlatform)) {
    if (tally.blocked) continue; // already reported at block time
    if (tally.collected > 0) {
      await postHealth(conn, platform, "ok");
    } else if (tally.errors === 0) {
      await postHealth(conn, platform, "zero_results", "0 items across all sessions this run");
    }
  }

  await runFinalize(conn, state);

  const today = new Date().toISOString().slice(0, 10);
  const stats = (await chrome.storage.local.get(["dailyCount"])) as {
    dailyCount?: { date: string; count: number };
  };
  await chrome.storage.local.set({
    lastRun: new Date().toISOString(),
    lastInserted: state.totalInserted,
    lastRunPlatforms: { at: state.startedAt, stats: state.perPlatform },
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
}

async function continueQueue(): Promise<void> {
  const conn = await getConnection();
  if (!conn) {
    await chrome.storage.local.remove([QUEUE_KEY]);
    return;
  }
  const data = (await chrome.storage.local.get([QUEUE_KEY])) as { [key: string]: StoredQueue };
  const queued = data[QUEUE_KEY];
  if (!queued || queued.sessions.length === 0) {
    await chrome.storage.local.remove([QUEUE_KEY]);
    return;
  }
  const [current, ...remaining] = queued.sessions;
  await processSession(current, queued.state, remaining, conn);
}

async function ensureAlarm(): Promise<void> {
  const conn = await getConnection();
  if (!conn) return;
  const existing = await chrome.alarms.get("gito-collect");
  if (existing) return;
  const local = (await chrome.storage.local.get(["serverSettings"])) as {
    serverSettings?: ServerContext["settings"];
  };
  const interval = Math.max(10, local.serverSettings?.intervalMinutes ?? 30);
  chrome.alarms.create("gito-collect", { periodInMinutes: interval });
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
  ensureAlarm();
});

chrome.runtime.onStartup?.addListener(() => {
  ensureAlarm();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "send-to-gito" || !tab?.id) return;
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    func: () => (window as any).__gitoSendSelection?.(),
  });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "gito-collect") {
    try {
      await startRun("auto");
    } catch (err) {
      console.error("[Gito] run failed:", err);
    }
    return;
  }
  if (alarm.name === "gito-collect-next") {
    try {
      await continueQueue();
    } catch (err) {
      console.error("[Gito] session failed:", err);
    }
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "RUN_COLLECT_NOW") {
    (async () => {
      try {
        sendResponse(await startRun("manual"));
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  // Topic list for the capture picker — always fetched fresh from the server
  if (msg.type === "GET_CONTEXT") {
    (async () => {
      const conn = await getConnection();
      if (!conn) {
        sendResponse({ ok: false, error: "Not configured" });
        return;
      }
      try {
        const ctx = await fetchContext(conn);
        sendResponse({ ok: true, topics: ctx.topics, companyName: ctx.companyName });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  if (msg.type === "SEND_ITEM") {
    (async () => {
      const conn = await getConnection();
      if (!conn) {
        sendResponse({ ok: false, error: "Not configured" });
        return;
      }

      const topicId: string | undefined = msg.topicId || undefined;
      const allItems = ([msg.payload, ...(msg.replies ?? [])] as ExtensionItem[]).map((i) => ({
        ...i,
        ...(topicId ? { topicId } : {}),
      }));

      const result = await ingestBatch(conn, allItems);
      if (result.error) {
        sendResponse({ ok: false, error: result.error });
        return;
      }
      sendResponse({ ok: true, data: result });

      const key = `count_${new Date().toISOString().slice(0, 10)}`;
      const local = (await chrome.storage.local.get([key])) as Record<string, number>;
      await chrome.storage.local.set({ [key]: (local[key] ?? 0) + result.inserted + result.updated });
    })();
    return true;
  }
});
