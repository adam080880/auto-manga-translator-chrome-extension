let isActive    = false;
let sourceLang  = "vi";
let targetLang  = "id";
let mode        = "drag"; // "drag" | "full"
let selectionBox = null;
let stickyNote   = null;
let cornerPanel  = null;
let overlayContainer = null;

// Drag state
let isDragging = false;
let dragStart  = null;
let dragImg    = null;

function isContextValid() {
  try { return !!chrome.runtime?.id; } catch { return false; }
}

// ── OpenRouter Vision API ──────────────────────────────────────────────────

const LANG_NAMES = {
  id: "Indonesian", vi: "Vietnamese", en: "English",
  ja: "Japanese",  zh: "Chinese",    ko: "Korean",
};

// Free vision models on OpenRouter (user can change in popup)
const DEFAULT_MODEL = "qwen/qwen2.5-vl-72b-instruct:free";

function buildPrompt(fullPage = false) {
  const src = LANG_NAMES[sourceLang] || sourceLang;
  const tgt = LANG_NAMES[targetLang] || targetLang;
  if (fullPage) {
    return `This is a manga page in ${src}. Manga is read right-to-left, top-to-bottom. Find every speech bubble and text box, order them in correct manga reading order (right column before left, top before bottom), then translate each one to ${tgt}. Return a numbered list — one translation per line, e.g. "1. text here". No extra commentary.`;
  }
  return `This is a manga speech bubble in ${src}. Extract all text and translate it to ${tgt}. Reply with only the translated text, no explanations.`;
}

async function callVision(base64Image, mimeType, apiKey, prompt) {
  const model = (await getSetting("customModel")) || (await getSetting("model")) || DEFAULT_MODEL;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "HTTP-Referer": location.origin,
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: "text", text: prompt }
        ]
      }],
      temperature: 0.1,
      max_tokens: 800,
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err.error?.message || `OpenRouter error ${res.status}`;
    // "no endpoints" = model lagi offline, saranin ganti model
    if (msg.includes("No endpoints") || msg.includes("no endpoints")) {
      throw new Error("Model offline — coba ganti model lain di popup");
    }
    throw new Error(msg);
  }

  const json = await res.json();
  return json.choices?.[0]?.message?.content?.trim() || "";
}

// ── Fetch + cache image data ───────────────────────────────────────────────

const imageDataCache = new WeakMap();

async function getImageData(img) {
  if (imageDataCache.has(img)) return imageDataCache.get(img);
  return new Promise((resolve, reject) => {
    if (!isContextValid()) return reject(new Error("Extension di-reload — refresh halaman (F5)"));
    try {
      chrome.runtime.sendMessage({ type: "FETCH_IMAGE", src: img.src }, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res || res.error) return reject(new Error(res?.error || "No response"));
        imageDataCache.set(img, res.dataUrl);
        resolve(res.dataUrl);
      });
    } catch { reject(new Error("Extension di-reload — refresh halaman (F5)")); }
  });
}

// For full page: get dataUrl and split to base64+mime
async function getImageBase64(img) {
  const dataUrl = await getImageData(img);
  return { base64: dataUrl.split(",")[1], mime: "image/png" };
}

// ── Crop region from dataUrl ───────────────────────────────────────────────

async function cropRegion(dataUrl, srcX, srcY, srcW, srcH) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width  = srcW * scale;
      canvas.height = srcH * scale;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, srcX, srcY, srcW, srcH, 0, 0, canvas.width, canvas.height);
      // Return both full dataUrl and split parts
      const full = canvas.toDataURL("image/png");
      resolve({
        dataUrl: full,
        base64:  full.split(",")[1],
        mime:    "image/png",
      });
    };
    image.src = dataUrl;
  });
}

// ── Drag selection ─────────────────────────────────────────────────────────

function startDrag(img, e) {
  isDragging = true;
  dragStart  = { x: e.clientX, y: e.clientY };
  dragImg    = img;
  removeStickyNote();
  removeSelectionBox();

  selectionBox = document.createElement("div");
  selectionBox.className = "mt-selection-box";
  document.body.appendChild(selectionBox);
  updateDragBox(e.clientX, e.clientY);
}

function updateDragBox(endX, endY) {
  if (!selectionBox || !dragStart) return;
  selectionBox.style.left   = Math.min(dragStart.x, endX) + "px";
  selectionBox.style.top    = Math.min(dragStart.y, endY) + "px";
  selectionBox.style.width  = Math.abs(endX - dragStart.x) + "px";
  selectionBox.style.height = Math.abs(endY - dragStart.y) + "px";
}

function endDrag(endX, endY) {
  isDragging = false;
  const w = Math.abs(endX - dragStart.x);
  const h = Math.abs(endY - dragStart.y);
  const x = Math.min(dragStart.x, endX);
  const y = Math.min(dragStart.y, endY);
  dragStart = null;

  if (w < 20 || h < 20) { removeSelectionBox(); dragImg = null; return; }

  selectionBox?.classList.add("selected");
  processSelection(dragImg, x, y, w, h);
  dragImg = null;
}

document.addEventListener("mousemove", (e) => { if (isDragging) updateDragBox(e.clientX, e.clientY); });
document.addEventListener("mouseup",   (e) => { if (isDragging) endDrag(e.clientX, e.clientY); });

// ── OCR + translate via Gemini ─────────────────────────────────────────────

async function processSelection(img, clientX, clientY, selW, selH) {
  removeStickyNote();
  const indicator = showIndicator(clientX + selW / 2, clientY + selH / 2);

  try {
    const apiKey = await getApiKey();
    if (!apiKey) {
      showToast("Masukkan Gemini API key di popup dulu");
      removeSelectionBox();
      return;
    }

    const fullDataUrl = await getImageData(img);
    const rect = img.getBoundingClientRect();

    const dispX = Math.max(0, clientX - rect.left);
    const dispY = Math.max(0, clientY - rect.top);
    const dispW = Math.min(selW, rect.width  - dispX);
    const dispH = Math.min(selH, rect.height - dispY);

    if (dispW < 10 || dispH < 10) { showToast("Area terlalu kecil"); return; }

    const sx = img.naturalWidth  / rect.width;
    const sy = img.naturalHeight / rect.height;
    const { base64, mime } = await cropRegion(
      fullDataUrl, dispX * sx, dispY * sy, dispW * sx, dispH * sy
    );

    const translated = await callVision(base64, mime, apiKey, buildPrompt(false));

    if (!translated) { showToast("Tidak ada teks di area ini"); removeSelectionBox(); return; }

    showStickyNote(translated, clientX, clientY, selW, selH);

  } catch (err) {
    removeSelectionBox();
    showToast("Error: " + err.message);
  } finally {
    indicator.remove();
  }
}

function getSetting(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (s) => resolve(s[key] || "")));
}

async function getApiKey() {
  return getSetting("openrouterKey");
}

// ── Draggable panels ───────────────────────────────────────────────────────

function makeDraggable(el, handle) {
  let startX, startY, startLeft, startTop;

  handle.style.cursor = "grab";

  handle.addEventListener("mousedown", (e) => {
    e.preventDefault();
    e.stopPropagation();

    // Convert right/bottom positioning to left/top so we can move freely
    const rect = el.getBoundingClientRect();
    el.style.left   = rect.left + "px";
    el.style.top    = rect.top  + "px";
    el.style.right  = "auto";
    el.style.bottom = "auto";

    startX    = e.clientX;
    startY    = e.clientY;
    startLeft = rect.left;
    startTop  = rect.top;
    handle.style.cursor = "grabbing";

    const onMove = (e) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      // Clamp to viewport
      const maxLeft = window.innerWidth  - el.offsetWidth;
      const maxTop  = window.innerHeight - el.offsetHeight;
      el.style.left = Math.max(0, Math.min(startLeft + dx, maxLeft)) + "px";
      el.style.top  = Math.max(0, Math.min(startTop  + dy, maxTop))  + "px";
    };

    const onUp = () => {
      handle.style.cursor = "grab";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}

// ── Full Page mode ─────────────────────────────────────────────────────────

async function processFullImage(img) {
  removeCornerPanel();
  const rect = img.getBoundingClientRect();
  const indicator = showIndicator(rect.left + rect.width / 2, rect.top + rect.height / 2);

  try {
    const apiKey = await getApiKey();
    if (!apiKey) { showToast("Masukkan OpenRouter API key di popup dulu"); return; }

    const { base64, mime } = await getImageBase64(img);
    const result = await callVision(base64, mime, apiKey, buildPrompt(true));

    if (!result) { showToast("Tidak ada teks yang terdeteksi"); return; }

    showCornerPanel(result, img);
  } catch (err) {
    showToast("Error: " + err.message);
  } finally {
    indicator.remove();
  }
}

// getImageData for full page returns base64 directly
async function getFullImageData(img) {
  const dataUrl = await getImageData(img);
  return { base64: dataUrl.split(",")[1], mime: "image/png" };
}

// ── Corner panel ───────────────────────────────────────────────────────────

function showCornerPanel(text, img) {
  removeCornerPanel();

  const rect = img.getBoundingClientRect();
  const panel = document.createElement("div");
  panel.className = "mt-corner-panel";
  panel.style.cssText = `
    position: fixed;
    right: ${window.innerWidth - rect.right + 8}px;
    bottom: ${window.innerHeight - rect.bottom + 8}px;
    width: 260px;
    max-height: ${Math.min(rect.height * 0.7, 400)}px;
  `;

  const header = document.createElement("div");
  header.className = "mt-corner-header";

  const title = document.createElement("span");
  title.textContent = "Translation";

  const close = document.createElement("button");
  close.className = "mt-sticky-close";
  close.textContent = "×";
  close.style.position = "static";
  close.addEventListener("click", removeCornerPanel);

  header.appendChild(title);
  header.appendChild(close);

  const body = document.createElement("div");
  body.className = "mt-corner-body";

  // Parse numbered list from LLM output
  const lines = text.split("\n").filter(l => l.trim());
  lines.forEach((line) => {
    const p = document.createElement("p");
    p.className = "mt-corner-line";
    p.textContent = line.trim();
    body.appendChild(p);
  });

  panel.appendChild(header);
  panel.appendChild(body);
  document.body.appendChild(panel);
  cornerPanel = panel;

  makeDraggable(panel, header);
}

function removeCornerPanel() {
  cornerPanel?.remove();
  cornerPanel = null;
}

// ── Sticky note ────────────────────────────────────────────────────────────

function showStickyNote(text, selX, selY, selW, selH) {
  removeStickyNote();

  const note = document.createElement("div");
  note.className = "mt-sticky";

  const close = document.createElement("button");
  close.className = "mt-sticky-close";
  close.textContent = "×";
  close.addEventListener("click", () => { removeStickyNote(); removeSelectionBox(); });

  const body = document.createElement("div");
  body.className = "mt-sticky-body";
  body.textContent = text;

  note.appendChild(close);
  note.appendChild(body);
  document.body.appendChild(note);
  stickyNote = note;

  const NOTE_W = 240;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left, arrowClass;

  if (selX + selW + 14 + NOTE_W <= vw) {
    left = selX + selW + 14;
    arrowClass = "arrow-left";
  } else if (selX - NOTE_W - 14 >= 0) {
    left = selX - NOTE_W - 14;
    arrowClass = "arrow-right";
  } else {
    left = Math.max(8, Math.min(selX, vw - NOTE_W - 8));
    arrowClass = "arrow-top";
  }

  note.classList.add(arrowClass);
  note.style.left = left + "px";
  note.style.top  = Math.max(8, Math.min(selY, vh - 160)) + "px";

  makeDraggable(note, note);
}

function removeStickyNote() {
  stickyNote?.remove();
  stickyNote = null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function removeSelectionBox() {
  selectionBox?.remove();
  selectionBox = null;
}

function removeOverlay() {
  overlayContainer?.remove();
  overlayContainer = null;
  document.querySelectorAll(".mt-loading").forEach((el) => el.remove());
}

function showIndicator(x, y) {
  const el = document.createElement("div");
  el.className = "mt-loading";
  el.style.cssText = `position:fixed;left:${x}px;top:${y}px;transform:translate(-50%,-50%);z-index:9999999;`;
  el.textContent = "Menerjemahkan...";
  document.body.appendChild(el);
  return el;
}

function showToast(msg) {
  const el = document.createElement("div");
  el.className = "mt-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Image listeners ────────────────────────────────────────────────────────

function isMangaImage(img) {
  return img.naturalWidth >= 200 && img.naturalHeight >= 200 &&
         img.complete && img.src && !img.src.startsWith("data:");
}

function attachImageListeners() {
  document.querySelectorAll("img").forEach((img) => {
    if (img.dataset.mtAttached) return;
    img.dataset.mtAttached = "1";
    img.addEventListener("mousedown", (e) => {
      if (!isActive || !isMangaImage(img)) return;
      e.preventDefault();
      e.stopPropagation();
      if (mode === "drag") startDrag(img, e);
    });

    img.addEventListener("click", (e) => {
      if (!isActive) return;
      e.preventDefault();
      e.stopPropagation();
      if (mode === "full" && isMangaImage(img)) processFullImage(img);
    }, true);

    img.style.cursor = isActive ? "crosshair" : "";
  });
}

const imgObserver = new MutationObserver(() => {
  if (!isContextValid()) { imgObserver.disconnect(); return; }
  if (isActive) attachImageListeners();
});
imgObserver.observe(document.body, { childList: true, subtree: true });

// ── Messages from popup ────────────────────────────────────────────────────

try { chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "TOGGLE") {
    isActive = msg.active;
    if (msg.sourceLang) sourceLang = msg.sourceLang;
    if (msg.targetLang) targetLang = msg.targetLang;
    if (msg.mode) mode = msg.mode;

    if (!isActive) {
      removeOverlay(); removeSelectionBox(); removeStickyNote(); removeCornerPanel();
      document.querySelectorAll("img[data-mt-attached]").forEach(img => img.style.cursor = "");
    } else {
      attachImageListeners();
      document.querySelectorAll("img[data-mt-attached]").forEach(img => img.style.cursor = "crosshair");
      showToast(mode === "drag" ? "Drag area speech bubble untuk menerjemahkan" : "Klik gambar untuk translate seluruh halaman");
    }
  }
  if (msg.type === "CLEAR") { removeOverlay(); removeSelectionBox(); removeStickyNote(); removeCornerPanel(); }
}); } catch { /* context already invalidated */ }
