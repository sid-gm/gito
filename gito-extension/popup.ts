interface Account {
  id: string;
  gitoUrl: string;
  apiKey: string;
  companyId: string;
  companyName: string;
  entities: { id: string; label: string }[];
  trackedThreads: Array<{ url: string; platform: string; externalId?: string | null }>;
  twitterAccounts: string[];
}

interface StorageData {
  accounts?: Account[];
  activeAccountId?: string;
}

interface SearchConfig {
  terms: string[];
  platforms: Array<"twitter" | "threads">;
  intervalMinutes: number;
  enabled: boolean;
}

interface PlatformStats {
  [platform: string]: { collected: number; errors: number };
}

interface LastRunPlatforms {
  at: string;
  stats: PlatformStats;
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

const PLATFORM_META: Record<string, { label: string; tag: string; color: string }> = {
  reddit: { label: "Reddit", tag: "r/", color: "#ff5722" },
  twitter: { label: "X", tag: "X", color: "#c9ccd1" },
  threads: { label: "Threads", tag: "@", color: "#a78bfa" },
  instagram: { label: "Instagram", tag: "IG", color: "#ec4899" },
};

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

async function getActiveAccount(): Promise<Account | null> {
  const data = (await chrome.storage.sync.get(["accounts", "activeAccountId"])) as StorageData;
  const accounts = data.accounts ?? [];
  return accounts.find((a) => a.id === data.activeAccountId) ?? accounts[0] ?? null;
}

async function getConfig(): Promise<SearchConfig> {
  const data = (await chrome.storage.sync.get(["autoCollect"])) as { autoCollect?: SearchConfig };
  return (
    data.autoCollect ?? { terms: [], platforms: ["twitter", "threads"], intervalMinutes: 60, enabled: false }
  );
}

// ── Header (next run) ─────────────────────────────────────────────────────────

async function renderHeader(connected: boolean, config?: SearchConfig) {
  if (!connected) {
    headerStatus.innerHTML = `<span class="offline-dot"></span>Offline`;
    return;
  }
  if (config?.enabled) {
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
  config: SearchConfig,
  lastRun: string | undefined,
  stats: PlatformStats | undefined
) {
  const degraded = stats
    ? Object.values(stats).filter((s) => s.errors > 0 || s.collected === 0).length
    : 0;

  if (!config.enabled) {
    statusDot.style.background = COLORS.idle;
    statusText.textContent = "Auto-collect off";
  } else if (config.terms.length === 0) {
    statusDot.style.background = COLORS.warn;
    statusText.textContent = "No keywords yet";
  } else if (degraded > 0) {
    statusDot.style.background = COLORS.warn;
    statusText.textContent = `Running · ${degraded} platform${degraded === 1 ? "" : "s"} degraded`;
  } else {
    statusDot.style.background = COLORS.pos;
    statusText.textContent = "Collecting on schedule";
  }
  statusMeta.textContent = lastRun ? `· ${formatRelativeTime(lastRun)}` : "";
}

// ── Platform health card ──────────────────────────────────────────────────────

type HealthState = "ok" | "degraded" | "blocked" | "paused" | "idle";

const HEALTH_META: Record<HealthState, { dot: string; word: string }> = {
  ok: { dot: COLORS.pos, word: "OK" },
  degraded: { dot: COLORS.warn, word: "Degraded" },
  blocked: { dot: COLORS.neg, word: "Blocked" },
  paused: { dot: "#7b8398", word: "Paused" },
  idle: { dot: COLORS.idle, word: "Idle" },
};

function platformRow(platform: string, state: HealthState, detail: string): HTMLElement {
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

function renderHealth(config: SearchConfig, last: LastRunPlatforms | undefined) {
  platformRows.innerHTML = "";
  healthHint.textContent = last ? `last run · ${formatRelativeTime(last.at)}` : "last run · —";

  for (const platform of ["reddit", "twitter", "threads", "instagram"]) {
    // Reddit and Instagram are manual-capture only until subreddit browsing returns.
    if (platform === "reddit" || platform === "instagram") {
      platformRows.appendChild(platformRow(platform, "paused", "Manual capture only"));
      continue;
    }
    if (!config.platforms.includes(platform as "twitter" | "threads")) {
      platformRows.appendChild(platformRow(platform, "paused", "Not in collector config"));
      continue;
    }
    const stats = last?.stats?.[platform];
    if (!stats) {
      platformRows.appendChild(platformRow(platform, "idle", "No runs yet"));
      continue;
    }
    if (stats.errors > 0) {
      platformRows.appendChild(
        platformRow(platform, "degraded", `${stats.errors} error${stats.errors === 1 ? "" : "s"} last run`)
      );
    } else if (stats.collected === 0) {
      platformRows.appendChild(platformRow(platform, "degraded", "0 items last run"));
    } else {
      platformRows.appendChild(platformRow(platform, "ok", `Last run OK · ${stats.collected} items`));
    }
  }

  // Blocked-state banner is reserved for the health-event pipeline (login wall /
  // 403 detection). Nothing sets it yet, so it stays hidden.
  blockedBanner.classList.remove("visible");
  blockedText.textContent = "";
}

// ── Quick-add keywords ────────────────────────────────────────────────────────

async function renderKeywords() {
  const config = await getConfig();
  kwChips.innerHTML = "";
  if (config.terms.length === 0) {
    kwChips.classList.remove("visible");
    return;
  }
  kwChips.classList.add("visible");
  config.terms.forEach((term, i) => {
    const chip = document.createElement("span");
    chip.className = "kw-chip";
    chip.appendChild(document.createTextNode(term));
    const remove = document.createElement("button");
    remove.textContent = "×";
    remove.addEventListener("click", async () => {
      const cfg = await getConfig();
      cfg.terms = cfg.terms.filter((_, j) => j !== i);
      await chrome.storage.sync.set({ autoCollect: cfg });
      await renderKeywords();
    });
    chip.appendChild(remove);
    kwChips.appendChild(chip);
  });
}

async function addKeyword() {
  const term = kwInput.value.trim();
  if (!term) return;
  const config = await getConfig();
  if (!config.terms.some((t) => t.toLowerCase() === term.toLowerCase())) {
    config.terms.push(term);
    await chrome.storage.sync.set({ autoCollect: config });
  }
  kwInput.value = "";
  await renderKeywords();
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
    inserted?: number;
    pendingSessions?: number;
    error?: string;
  };

  runNowBtn.disabled = false;
  runNowBtn.classList.remove("running");
  runNowBtn.textContent = "Run now";

  if (!response.ok) {
    statusDot.style.background = COLORS.warn;
    statusText.textContent = response.error ?? "Run failed";
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
      entities: { id: string; label: string }[];
      trackedThreads?: Array<{ url: string; platform: string; externalId?: string | null }>;
      twitterAccounts?: string[];
    };

    const account: Account = {
      id: ctx.companyId,
      gitoUrl: origin,
      apiKey,
      companyId: ctx.companyId,
      companyName: ctx.companyName,
      entities: ctx.entities,
      trackedThreads: ctx.trackedThreads ?? [],
      twitterAccounts: ctx.twitterAccounts ?? [],
    };

    // Single-account model: connecting replaces any previous account.
    await chrome.storage.sync.set({ accounts: [account], activeAccountId: account.id });

    // Auto-collect defaults on first connect; schedule editing lives on the site.
    const existing = (await chrome.storage.sync.get(["autoCollect"])) as { autoCollect?: SearchConfig };
    const config: SearchConfig = existing.autoCollect ?? {
      terms: [],
      platforms: ["twitter", "threads"],
      intervalMinutes: 60,
      enabled: true,
    };
    if (!existing.autoCollect) {
      await chrome.storage.sync.set({ autoCollect: config });
    }
    if (config.enabled) {
      await chrome.storage.local.set({ failureCount: 0 });
      chrome.alarms.create("gito-collect", { periodInMinutes: config.intervalMinutes });
    }

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
  await chrome.storage.sync.set({ accounts: [], activeAccountId: null });
  await loadState();
});

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadState() {
  const account = await getActiveAccount();
  footerVersion.textContent = `v${chrome.runtime.getManifest().version} · Chrome`;

  if (!account) {
    setupEl.style.display = "flex";
    configuredEl.style.display = "none";
    urlInput.value = "";
    keyInput.value = "";
    await renderHeader(false);
    return;
  }

  setupEl.style.display = "none";
  configuredEl.style.display = "flex";
  manageLink.href = `${account.gitoUrl}/analyst/sources`;

  const config = await getConfig();
  await renderHeader(true, config);

  const local = (await chrome.storage.local.get([
    "lastRun",
    "dailyCount",
    "lastRunPlatforms",
    todayKey(),
  ])) as {
    lastRun?: string;
    dailyCount?: { date: string; count: number };
    lastRunPlatforms?: LastRunPlatforms;
    [key: string]: unknown;
  };

  const today = new Date().toISOString().slice(0, 10);
  const autoCount = local.dailyCount?.date === today ? local.dailyCount.count : 0;
  const manualCount = (local[todayKey()] as number | undefined) ?? 0;
  itemsToday.textContent = String(autoCount + manualCount);

  renderStatus(config, local.lastRun, local.lastRunPlatforms?.stats);
  renderHealth(config, local.lastRunPlatforms);
  await renderKeywords();
}

loadState();
