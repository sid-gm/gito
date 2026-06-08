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
  const data = await chrome.storage.sync.get(["accounts", "activeAccountId"]) as StorageData;
  const accounts = (data.accounts ?? []).filter((a) => a.id !== data.activeAccountId);
  const nextActive = accounts[0]?.id ?? null;
  await chrome.storage.sync.set({ accounts, activeAccountId: nextActive });
  await loadState();
});

loadState();
