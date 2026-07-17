// Popup — status surface. All config lives on the server; the popup holds only
// the connection (URL + API key), shows health, and offers Run now + quick-add.

interface Connection {
  gitoUrl: string;
  apiKey: string;
  companyId: string;
  companyName: string;
}

interface ServerSettings {
  intervalMinutes: number;
  enabled: boolean;
  pausedPlatforms: string[];
  maxThreadDrills: number;
  visionDisabledPlatforms: string[];
}

interface HealthRow {
  platform: string;
  state: "ok" | "degraded" | "blocked";
  since: string;
  lastOkAt: string | null;
}

interface KeywordRow {
  id: string;
  term: string;
  topicLabel: string | null;
}

interface PlatformStats {
  [platform: string]: { collected: number; errors: number; blocked?: boolean };
}

const headerStatus = document.getElementById("header-status")!;
const setupEl = document.getElementById("state-setup")!;
const configuredEl = document.getElementById("state-configured")!;
const urlInput = document.getElementById("input-url") as HTMLInputElement;
const keyInput = document.getElementById("input-key") as HTMLInputElement;
const saveBtn = document.getElementById("btn-save") as HTMLButtonElement;
const setupError = document.getElementById("setup-error")!;

const blockedBanner = document.getElementById("blocked-banner")!;
const blockedText = document.getElementById("blocked-text")!;
const statusDot = document.getElementById("status-dot")!;
const statusText = document.getElementById("status-text")!;
const statusMeta = document.getElementById("status-meta")!;
const itemsToday = document.getElementById("items-today")!;
const runNowBtn = document.getElementById("btn-run-now") as HTMLButtonElement;
const healthHint = document.getElementById("health-hint")!;
const platformRows = document.getElementById("platform-rows")!;
const kwInput = document.getElementById("kw-input") as HTMLInputElement;
const addKwBtn = document.getElementById("btn-add-kw") as HTMLButtonElement;
const kwChips = document.getElementById("kw-chips")!;
const manageLink = document.getElementById("manage-link") as HTMLAnchorElement;
const footerVersion = document.getElementById("footer-version")!;
const disconnectBtn = document.getElementById("btn-disconnect")!;

const COLORS = { pos: "#34d399", warn: "#f59e0b", neg: "#fb7185", idle: "#4b5568" };

const PLATFORM_META: Record<string, { label: string; tag: string; color: string; site: string }> = {
  twitter: { label: "X", tag: "X", color: "#c9ccd1", site: "x.com" },
  threads: { label: "Threads", tag: "@", color: "#a78bfa", site: "threads.com" },
  reddit: { label: "Reddit", tag: "r/", color: "#ff5722", site: "reddit.com" },
  instagram: { label: "Instagram", tag: "IG", color: "#ec4899", site: "instagram.com" },
  facebook: { label: "Facebook", tag: "f", color: "#60a5fa", site: "facebook.com" },
  linkedin: { label: "LinkedIn", tag: "in", color: "#38bdf8", site: "linkedin.com" },
};

const AUTOMATED_PLATFORMS = new Set(["twitter", "threads", "reddit"]);

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function todayKey(): string {
  return `count_${new Date().toISOString().slice(0, 10)}`;
}

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

// ── Header (next run) ─────────────────────────────────────────────────────────

async function renderHeader(connected: boolean, settings?: ServerSettings | null) {
  if (!connected) {
    headerStatus.innerHTML = `<span class="offline-dot"></span>Offline`;
    return;
  }
  if (settings?.enabled) {
    const alarm = await chrome.alarms.get("gito-collect");
    if (alarm) {
      const mins = Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 60000));
      headerStatus.innerHTML = `Next run <span class="mono">in ${mins}m</span>`;
      return;
    }
  }
  headerStatus.innerHTML = `Auto-collect <span class="mono">off</span>`;
}

// ── Status card ───────────────────────────────────────────────────────────────

function renderStatus(
  settings: ServerSettings | null,
  lastRun: string | undefined,
  health: HealthRow[],
  keywordCount: number
) {
  const blocked = health.filter((h) => h.state === "blocked").length;
  const degraded = health.filter((h) => h.state === "degraded").length;

  if (!settings?.enabled) {
    statusDot.style.background = COLORS.idle;
    statusText.textContent = "Collector disabled";
  } else if (keywordCount === 0) {
    statusDot.style.background = COLORS.warn;
    statusText.textContent = "No keywords yet";
  } else if (blocked > 0) {
    statusDot.style.background = COLORS.neg;
    statusText.textContent = `${blocked} platform${blocked === 1 ? "" : "s"} blocked`;
  } else if (degraded > 0) {
    statusDot.style.background = COLORS.warn;
    statusText.textContent = `Running · ${degraded} degraded`;
  } else {
    statusDot.style.background = COLORS.pos;
    statusText.textContent = "Collecting on schedule";
  }
  statusMeta.textContent = lastRun ? `· ${formatRelativeTime(lastRun)}` : "";
}

// ── Platform health card ──────────────────────────────────────────────────────

type RowState = "ok" | "degraded" | "blocked" | "paused" | "idle";

const HEALTH_META: Record<RowState, { dot: string; word: string }> = {
  ok: { dot: COLORS.pos, word: "OK" },
  degraded: { dot: COLORS.warn, word: "Degraded" },
  blocked: { dot: COLORS.neg, word: "Blocked" },
  paused: { dot: "#7b8398", word: "Paused" },
  idle: { dot: COLORS.idle, word: "Idle" },
};

function platformRow(platform: string, state: RowState, detail: string): HTMLElement {
  const pm = PLATFORM_META[platform];
  const hm = HEALTH_META[state];
  const row = document.createElement("div");
  row.className = `plat-row${state === "blocked" ? " blocked" : ""}`;

  const id = document.createElement("div");
  id.className = "plat-id";
  const tag = document.createElement("span");
  tag.className = "plat-tag";
  tag.style.background = pm.color + "22";
  tag.style.color = pm.color;
  tag.textContent = pm.tag;
  const texts = document.createElement("div");
  texts.style.minWidth = "0";
  const name = document.createElement("div");
  name.className = "plat-name";
  name.textContent = pm.label;
  const det = document.createElement("div");
  det.className = "plat-detail";
  det.textContent = detail;
  texts.appendChild(name);
  texts.appendChild(det);
  id.appendChild(tag);
  id.appendChild(texts);

  const status = document.createElement("span");
  status.className = "plat-status";
  status.style.color = hm.dot;
  const dot = document.createElement("span");
  dot.className = "plat-status-dot";
  dot.style.background = hm.dot;
  status.appendChild(dot);
  status.appendChild(document.createTextNode(hm.word));

  row.appendChild(id);
  row.appendChild(status);
  return row;
}

function renderHealth(
  settings: ServerSettings | null,
  health: HealthRow[],
  lastStats: { at: string; stats: PlatformStats } | undefined
) {
  platformRows.innerHTML = "";
  healthHint.textContent = lastStats ? `last run · ${formatRelativeTime(lastStats.at)}` : "last run · —";

  const healthByPlatform = new Map(health.map((h) => [h.platform, h]));
  const paused = new Set(settings?.pausedPlatforms ?? []);
  const blockedRows: string[] = [];

  for (const platform of Object.keys(PLATFORM_META)) {
    if (paused.has(platform)) {
      platformRows.appendChild(platformRow(platform, "paused", "Paused on server"));
      continue;
    }

    const h = healthByPlatform.get(platform);
    if (h?.state === "blocked") {
      const pm = PLATFORM_META[platform];
      platformRows.appendChild(platformRow(platform, "blocked", `Blocked since ${formatRelativeTime(h.since)}`));
      blockedRows.push(`<strong>${pm.label}</strong> is blocked — open ${pm.site} and log back in.`);
      continue;
    }
    if (h?.state === "degraded") {
      platformRows.appendChild(platformRow(platform, "degraded", `Degraded since ${formatRelativeTime(h.since)}`));
      continue;
    }
    if (h?.state === "ok") {
      const stats = lastStats?.stats?.[platform];
      const detail = stats?.collected
        ? `Last run OK · ${stats.collected} items`
        : h.lastOkAt
          ? `OK · last items ${formatRelativeTime(h.lastOkAt)}`
          : "OK";
      platformRows.appendChild(platformRow(platform, "ok", detail));
      continue;
    }
    platformRows.appendChild(
      platformRow(platform, "idle", AUTOMATED_PLATFORMS.has(platform) ? "No runs yet" : "Manual capture / tracked only")
    );
  }

  if (blockedRows.length > 0) {
    blockedText.innerHTML = blockedRows.join("<br>");
    blockedBanner.classList.add("visible");
  } else {
    blockedBanner.classList.remove("visible");
    blockedText.textContent = "";
  }
}

// ── Keywords (server-backed quick-add) ────────────────────────────────────────

function renderKeywords(conn: Connection, keywords: KeywordRow[]) {
  kwChips.innerHTML = "";
  if (keywords.length === 0) {
    kwChips.classList.remove("visible");
    return;
  }
  kwChips.classList.add("visible");
  for (const kw of keywords) {
    const chip = document.createElement("span");
    chip.className = "kw-chip";
    chip.title = kw.topicLabel ? `Topic: ${kw.topicLabel}` : "No topic — assign on the site";
    chip.appendChild(document.createTextNode(kw.term));
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      await api(conn, `/api/collect-keywords/${kw.id}?companyId=${conn.companyId}`, { method: "DELETE" }).catch(() => {});
      await loadState();
    });
    chip.appendChild(remove);
    kwChips.appendChild(chip);
  }
}

async function addKeyword() {
  const term = kwInput.value.trim();
  if (!term) return;
  const conn = await getConnection();
  if (!conn) return;
  addKwBtn.disabled = true;
  try {
    // Quick-adds land unassigned; topics are managed on the site
    const res = await api(conn, "/api/collect-keywords", {
      method: "POST",
      body: JSON.stringify({ term }),
    });
    if (res.ok || res.status === 409) kwInput.value = "";
  } finally {
    addKwBtn.disabled = false;
  }
  await loadState();
}

addKwBtn.addEventListener("click", addKeyword);
kwInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addKeyword();
});

// ── Run now ───────────────────────────────────────────────────────────────────

runNowBtn.addEventListener("click", async () => {
  runNowBtn.disabled = true;
  runNowBtn.classList.add("running");
  runNowBtn.textContent = "Running…";

  const response = (await chrome.runtime.sendMessage({ type: "RUN_COLLECT_NOW" })) as {
    ok: boolean;
    pendingSessions?: number;
    error?: string;
  };

  runNowBtn.disabled = false;
  runNowBtn.classList.remove("running");
  runNowBtn.textContent = "Run now";

  if (!response?.ok) {
    statusDot.style.background = COLORS.warn;
    statusText.textContent = response?.error ?? "Run failed";
    statusMeta.textContent = "";
    return;
  }
  await loadState();
});

// ── Setup / connect ───────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
  const rawUrl = urlInput.value.trim().replace(/\/$/, "");
  const apiKey = keyInput.value.trim();
  setupError.classList.remove("visible");

  if (!rawUrl || !apiKey) {
    setupError.textContent = "Both fields are required.";
    setupError.classList.add("visible");
    return;
  }

  let origin: string;
  try {
    origin = new URL(rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`).origin;
  } catch {
    setupError.textContent = "Enter a valid URL (e.g. https://usegito.com)";
    setupError.classList.add("visible");
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = "Connecting…";

  try {
    const res = await fetch(`${origin}/api/extension/context`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      setupError.textContent = res.status === 401 ? "Invalid API key." : "Could not connect to Gito.";
      setupError.classList.add("visible");
      return;
    }

    const ctx = (await res.json()) as {
      companyId: string;
      companyName: string;
      settings: ServerSettings;
    };

    const connection: Connection = {
      gitoUrl: origin,
      apiKey,
      companyId: ctx.companyId,
      companyName: ctx.companyName,
    };
    await chrome.storage.sync.set({ connection });
    await chrome.storage.local.set({ serverSettings: ctx.settings });

    // Schedule from server config — the popup never owns the interval
    chrome.alarms.create("gito-collect", {
      periodInMinutes: Math.max(10, ctx.settings.intervalMinutes ?? 30),
    });

    await loadState();
  } catch {
    setupError.textContent = "Network error — check the URL.";
    setupError.classList.add("visible");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save & connect";
  }
});

disconnectBtn.addEventListener("click", async () => {
  chrome.alarms.clear("gito-collect");
  chrome.alarms.clear("gito-collect-next");
  await chrome.storage.sync.remove(["connection"]);
  await chrome.storage.local.remove(["serverSettings", "gitoCollectQueue"]);
  await loadState();
});

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadState() {
  const conn = await getConnection();
  footerVersion.textContent = `v${chrome.runtime.getManifest().version} · Chrome`;

  if (!conn) {
    setupEl.style.display = "flex";
    configuredEl.style.display = "none";
    urlInput.value = "";
    keyInput.value = "";
    await renderHeader(false);
    return;
  }

  setupEl.style.display = "none";
  configuredEl.style.display = "flex";
  manageLink.href = `${conn.gitoUrl}/analyst/sources`;

  const local = (await chrome.storage.local.get([
    "lastRun",
    "dailyCount",
    "lastRunPlatforms",
    "serverSettings",
    todayKey(),
  ])) as {
    lastRun?: string;
    dailyCount?: { date: string; count: number };
    lastRunPlatforms?: { at: string; stats: PlatformStats };
    serverSettings?: ServerSettings;
    [key: string]: unknown;
  };

  const today = new Date().toISOString().slice(0, 10);
  const autoCount = local.dailyCount?.date === today ? local.dailyCount.count : 0;
  const manualCount = (local[todayKey()] as number | undefined) ?? 0;
  itemsToday.textContent = String(autoCount + manualCount);

  // Fresh server state: settings (via context), health, keywords
  let settings: ServerSettings | null = local.serverSettings ?? null;
  let health: HealthRow[] = [];
  let keywords: KeywordRow[] = [];

  try {
    const [ctxRes, healthRes, kwRes] = await Promise.all([
      api(conn, "/api/extension/context"),
      api(conn, "/api/extension/health"),
      api(conn, "/api/collect-keywords"),
    ]);
    if (ctxRes.ok) {
      const ctx = await ctxRes.json();
      settings = ctx.settings as ServerSettings;
      await chrome.storage.local.set({ serverSettings: settings });
    } else if (ctxRes.status === 401) {
      statusDot.style.background = COLORS.neg;
      statusText.textContent = "API key rejected — reconnect";
    }
    if (healthRes.ok) health = (await healthRes.json()) as HealthRow[];
    if (kwRes.ok) keywords = (await kwRes.json()) as KeywordRow[];
  } catch {
    // Offline — render from cached settings
  }

  await renderHeader(true, settings);
  renderStatus(settings, local.lastRun, health, keywords.length);
  renderHealth(settings, health, local.lastRunPlatforms);
  renderKeywords(conn, keywords);
}

loadState();
