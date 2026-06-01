const toggle = document.getElementById("toggle");
const status = document.getElementById("status");
const clearBtn = document.getElementById("clearBtn");
const sourceLangSelect = document.getElementById("sourceLangSelect");
const targetLangSelect = document.getElementById("targetLangSelect");
const hint = document.getElementById("hint");
const apiKeyInput  = document.getElementById("apiKey");
const modelSelect   = document.getElementById("modelSelect");
const customModel   = document.getElementById("customModel");

const SOURCE_LABELS = { ja: "JP", vi: "VI", en: "EN", zh: "ZH", ko: "KO" };
const TARGET_LABELS = { id: "ID", vi: "VI", en: "EN" };

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(msg) {
  const tab = await getActiveTab();
  if (!tab?.id) return;
  chrome.tabs.sendMessage(tab.id, msg);
}

function getLangs() {
  return { sourceLang: sourceLangSelect.value, targetLang: targetLangSelect.value };
}

function updateHint() {
  const s = SOURCE_LABELS[sourceLangSelect.value] || sourceLangSelect.value.toUpperCase();
  const t = TARGET_LABELS[targetLangSelect.value] || targetLangSelect.value.toUpperCase();
  hint.textContent = `Aktifkan lalu drag area speech bubble (${s} → ${t})`;
}

// restore saved state
chrome.storage.local.get(["active", "sourceLang", "targetLang", "openrouterKey", "model", "customModel"], (s) => {
  toggle.checked = !!s.active;
  sourceLangSelect.value = s.sourceLang || "vi";
  targetLangSelect.value = s.targetLang || "id";
  apiKeyInput.value  = s.openrouterKey || "";
  modelSelect.value  = s.model || "qwen/qwen2.5-vl-72b-instruct:free";
  customModel.value  = s.customModel || "";
  updateHint();
  if (s.active) status.textContent = "Aktif — drag area speech bubble";
});

apiKeyInput.addEventListener("change", () => {
  chrome.storage.local.set({ openrouterKey: apiKeyInput.value.trim() });
});

modelSelect.addEventListener("change", () => {
  chrome.storage.local.set({ model: modelSelect.value });
});

customModel.addEventListener("change", () => {
  chrome.storage.local.set({ customModel: customModel.value.trim() });
});

sourceLangSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ sourceLang: sourceLangSelect.value });
  updateHint();
  if (toggle.checked) sendToContent({ type: "TOGGLE", active: true, ...getLangs() });
});

targetLangSelect.addEventListener("change", async () => {
  await chrome.storage.local.set({ targetLang: targetLangSelect.value });
  updateHint();
  if (toggle.checked) sendToContent({ type: "TOGGLE", active: true, ...getLangs() });
});

toggle.addEventListener("change", async () => {
  const active = toggle.checked;
  await chrome.storage.local.set({ active });
  status.textContent = active ? "Aktif — drag area speech bubble" : "";
  sendToContent({ type: "TOGGLE", active, ...getLangs() });
});

clearBtn.addEventListener("click", () => {
  sendToContent({ type: "CLEAR" });
});
