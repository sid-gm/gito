const setupEl = document.getElementById("state-setup")!;
const configuredEl = document.getElementById("state-configured")!;
const urlInput = document.getElementById("input-url") as HTMLInputElement;
const keyInput = document.getElementById("input-key") as HTMLInputElement;
const saveBtn = document.getElementById("btn-save")!;
const disconnectBtn = document.getElementById("btn-disconnect")!;
const displayUrl = document.getElementById("display-url")!;
const displayKey = document.getElementById("display-key")!;
const dailyCount = document.getElementById("daily-count")!;
const setupError = document.getElementById("setup-error")!;

function todayKey(): string {
  return `count_${new Date().toISOString().slice(0, 10)}`;
}

async function loadState() {
  const { gitoUrl, apiKey } = await chrome.storage.sync.get(["gitoUrl", "apiKey"]);

  if (gitoUrl && apiKey) {
    setupEl.style.display = "none";
    configuredEl.style.display = "block";

    try {
      const domain = new URL(gitoUrl).hostname;
      displayUrl.textContent = domain;
    } catch {
      displayUrl.textContent = gitoUrl;
    }

    const masked = apiKey.slice(0, 5) + "•".repeat(Math.min(16, apiKey.length - 5));
    displayKey.textContent = masked;

    const local = await chrome.storage.local.get([todayKey()]);
    dailyCount.textContent = String(local[todayKey()] ?? 0);
  } else {
    setupEl.style.display = "block";
    configuredEl.style.display = "none";
  }
}

saveBtn.addEventListener("click", async () => {
  const gitoUrl = urlInput.value.trim().replace(/\/$/, "");
  const apiKey = keyInput.value.trim();

  setupError.textContent = "";

  if (!gitoUrl || !apiKey) {
    setupError.textContent = "Both fields are required.";
    return;
  }

  try {
    new URL(gitoUrl);
  } catch {
    setupError.textContent = "Enter a valid URL (e.g. https://your-gito.vercel.app)";
    return;
  }

  await chrome.storage.sync.set({ gitoUrl, apiKey });
  await loadState();
});

disconnectBtn.addEventListener("click", async () => {
  await chrome.storage.sync.remove(["gitoUrl", "apiKey"]);
  urlInput.value = "";
  keyInput.value = "";
  await loadState();
});

loadState();
