interface Account {
  id: string;
  gitoUrl: string;
  apiKey: string;
  companyId: string;
  companyName: string;
  entities: { id: string; label: string }[];
}

interface StorageData {
  accounts?: Account[];
  activeAccountId?: string;
}

interface SearchConfig {
  terms: string[];
  platforms: Array<"twitter" | "threads" | "reddit">;
  intervalMinutes: number;
  enabled: boolean;
}

const setupEl = document.getElementById("state-setup")!;
const configuredEl = document.getElementById("state-configured")!;
const urlInput = document.getElementById("input-url") as HTMLInputElement;
const keyInput = document.getElementById("input-key") as HTMLInputElement;
const saveBtn = document.getElementById("btn-save") as HTMLButtonElement;
const disconnectBtn = document.getElementById("btn-disconnect")!;
const addAccountBtn = document.getElementById("btn-add-account")!;
const companySelect = document.getElementById("company-select") as HTMLSelectElement;
const dailyCount = document.getElementById("daily-count")!;
const entityList = document.getElementById("entity-list")!;
const setupError = document.getElementById("setup-error")!;

// Auto-collect elements
const runNowBtn = document.getElementById("btn-run-now") as HTMLButtonElement;
const viewRunsBtn = document.getElementById("btn-view-runs") as HTMLAnchorElement;
const acTerms = document.getElementById("ac-terms") as HTMLInputElement;
const acX = document.getElementById("ac-x") as HTMLInputElement;
const acThreads = document.getElementById("ac-threads") as HTMLInputElement;
const acReddit = document.getElementById("ac-reddit") as HTMLInputElement;
const acInterval = document.getElementById("ac-interval") as HTMLSelectElement;
const acEnabled = document.getElementById("ac-enabled") as HTMLInputElement;
const acStatus = document.getElementById("ac-status")!;
const acError = document.getElementById("ac-error")!;

function readAutoCollectForm(): SearchConfig {
  const terms = acTerms.value
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  const platforms: Array<"twitter" | "threads" | "reddit"> = [];
  if (acX.checked) platforms.push("twitter");
  if (acThreads.checked) platforms.push("threads");
  if (acReddit.checked) platforms.push("reddit");
  return {
    terms,
    platforms,
    intervalMinutes: parseInt(acInterval.value, 10),
    enabled: acEnabled.checked,
  };
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 min ago";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
}

async function loadAutoCollect() {
  const syncData = await chrome.storage.sync.get(["autoCollect"]) as { autoCollect?: SearchConfig };
  const config: SearchConfig = syncData.autoCollect ?? {
    terms: [],
    platforms: ["twitter", "threads", "reddit"],
    intervalMinutes: 60,
    enabled: false,
  };

  acTerms.value = config.terms.join(", ");
  acX.checked = config.platforms.includes("twitter");
  acThreads.checked = config.platforms.includes("threads");
  acReddit.checked = config.platforms.includes("reddit");
  acInterval.value = String(config.intervalMinutes);
  acEnabled.checked = config.enabled;

  const localData = await chrome.storage.local.get(["lastRun", "lastInserted", "failureCount"]) as {
    lastRun?: string;
    lastInserted?: number;
    failureCount?: number;
  };

  const failureCount = localData.failureCount ?? 0;
  if (failureCount >= 3) {
    acError.textContent = "Auto-collect paused — 3 consecutive errors. Fix connection and re-enable.";
    acError.style.display = "block";
  } else {
    acError.style.display = "none";
  }

  const statusParts: string[] = [];
  if (localData.lastRun) {
    statusParts.push(`Last run: ${formatRelativeTime(localData.lastRun)} · ${localData.lastInserted ?? 0} new items`);
  }
  if (config.enabled) {
    const alarm = await chrome.alarms.get("gito-collect");
    if (alarm) {
      const minsUntil = Math.max(0, Math.round((alarm.scheduledTime - Date.now()) / 60000));
      statusParts.push(`Next run: in ${minsUntil} min`);
    }
  }
  acStatus.textContent = statusParts.join(" · ");
}

acTerms.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoCollect: readAutoCollectForm() });
});
acX.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoCollect: readAutoCollectForm() });
});
acThreads.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoCollect: readAutoCollectForm() });
});
acReddit.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoCollect: readAutoCollectForm() });
});
acInterval.addEventListener("change", async () => {
  await chrome.storage.sync.set({ autoCollect: readAutoCollectForm() });
});

runNowBtn.addEventListener("click", async () => {
  runNowBtn.disabled = true;
  runNowBtn.textContent = "Running…";
  acStatus.textContent = "";

  const response = await chrome.runtime.sendMessage({ type: "RUN_COLLECT_NOW" }) as {
    ok: boolean;
    collected?: number;
    inserted?: number;
    errors?: string[];
    error?: string;
  };

  runNowBtn.disabled = false;
  runNowBtn.textContent = "Run now";

  if (!response.ok) {
    acError.textContent = response.error ?? "Collection failed.";
    acError.style.display = "block";
  } else {
    acError.style.display = "none";
    const parts: string[] = [];
    parts.push(`${response.inserted ?? 0} new items inserted`);
    if ((response.collected ?? 0) > (response.inserted ?? 0)) {
      parts.push(`${response.collected} collected`);
    }
    if (response.errors?.length) {
      parts.push(`${response.errors.length} error(s)`);
    }
    acStatus.textContent = parts.join(" · ");
    await loadAutoCollect();
  }
});

acEnabled.addEventListener("change", async () => {
  const config = readAutoCollectForm();
  if (config.enabled) {
    await chrome.storage.local.set({ failureCount: 0 });
    chrome.alarms.create("gito-collect", { periodInMinutes: config.intervalMinutes });
  } else {
    chrome.alarms.clear("gito-collect");
  }
  await chrome.storage.sync.set({ autoCollect: config });
  await loadAutoCollect();
});

function todayKey(): string {
  return `count_${new Date().toISOString().slice(0, 10)}`;
}

async function loadState() {
  const data = await chrome.storage.sync.get(["accounts", "activeAccountId"]) as StorageData;
  const accounts = data.accounts ?? [];
  const activeId = data.activeAccountId;
  const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null;

  // Populate company switcher
  companySelect.innerHTML = "";
  if (accounts.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Gito";
    companySelect.appendChild(opt);
    companySelect.disabled = true;
  } else {
    for (const acc of accounts) {
      const opt = document.createElement("option");
      opt.value = acc.id;
      opt.textContent = acc.companyName;
      if (acc.id === active?.id) opt.selected = true;
      companySelect.appendChild(opt);
    }
    companySelect.disabled = accounts.length < 2;
  }

  if (active) {
    setupEl.style.display = "none";
    configuredEl.style.display = "block";

    const local = await chrome.storage.local.get([todayKey()]);
    dailyCount.textContent = String((local as Record<string, number>)[todayKey()] ?? 0);

    entityList.innerHTML = "";
    if (active.entities.length === 0) {
      const el = document.createElement("span");
      el.className = "entity-empty";
      el.textContent = "No tracked entities";
      entityList.appendChild(el);
    } else {
      for (const ent of active.entities) {
        const chip = document.createElement("span");
        chip.className = "entity-chip";
        chip.textContent = ent.label;
        entityList.appendChild(chip);
      }
    }

    viewRunsBtn.href = "https://usegito.com/analyst/extension-runs";
    await loadAutoCollect();
  } else {
    setupEl.style.display = "block";
    configuredEl.style.display = "none";
    urlInput.value = "";
    keyInput.value = "";
  }
}

companySelect.addEventListener("change", async () => {
  await chrome.storage.sync.set({ activeAccountId: companySelect.value });
  // Notify content scripts in all tabs
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: "ACCOUNT_CHANGED" }).catch(() => {});
    }
  }
  await loadState();
});

addAccountBtn.addEventListener("click", () => {
  setupEl.style.display = "block";
  configuredEl.style.display = "none";
  urlInput.value = "";
  keyInput.value = "";
  setupError.textContent = "";
  urlInput.focus();
});

saveBtn.addEventListener("click", async () => {
  const rawUrl = urlInput.value.trim().replace(/\/$/, "");
  const apiKey = keyInput.value.trim();
  setupError.textContent = "";

  if (!rawUrl || !apiKey) {
    setupError.textContent = "Both fields are required.";
    return;
  }

  let origin: string;
  try {
    origin = new URL(rawUrl).origin;
  } catch {
    setupError.textContent = "Enter a valid URL (e.g. https://your-gito.vercel.app)";
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
      return;
    }

    const ctx = await res.json() as { companyId: string; companyName: string; entities: { id: string; label: string }[] };

    const data = await chrome.storage.sync.get(["accounts", "activeAccountId"]) as StorageData;
    const accounts = data.accounts ?? [];

    // Replace existing account for this companyId if present, else add
    const newAccount: Account = {
      id: ctx.companyId,
      gitoUrl: origin,
      apiKey,
      companyId: ctx.companyId,
      companyName: ctx.companyName,
      entities: ctx.entities,
    };

    const existing = accounts.findIndex((a) => a.companyId === ctx.companyId);
    if (existing >= 0) {
      accounts[existing] = newAccount;
    } else {
      accounts.push(newAccount);
    }

    await chrome.storage.sync.set({ accounts, activeAccountId: ctx.companyId });
    await loadState();
  } catch {
    setupError.textContent = "Network error — check the URL.";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save & Connect";
  }
});

disconnectBtn.addEventListener("click", async () => {
  chrome.alarms.clear("gito-collect");
  const data = await chrome.storage.sync.get(["accounts", "activeAccountId"]) as StorageData;
  const accounts = (data.accounts ?? []).filter((a) => a.id !== data.activeAccountId);
  const nextActive = accounts[0]?.id ?? null;
  await chrome.storage.sync.set({ accounts, activeAccountId: nextActive });
  await loadState();
});

loadState();
