let isActive    = false;
let sourceLang  = "vi";
let targetLang  = "id";
let selectionBox = null;
let stickyNote   = null;
let overlayContainer = null; // kept for removeOverlay compat

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

async function callVision(base64Image, mimeType, apiKey) {
  const targetName = LANG_NAMES[targetLang] || targetLang;
  const sourceName = LANG_NAMES[sourceLang] || sourceLang;
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
          { type: "text", text: `This is a manga speech bubble in ${sourceName}. Extract all text and translate it to ${targetName}. Reply with only the translated text, no explanations.` }
        ]
      }],
      temperature: 0.1,
      max_tokens: 300,
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

    const translated = await callVision(base64, mime, apiKey);

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
      startDrag(img, e);
    });

    // click juga perlu diblock — mousedown+mouseup = click, yang trigger navigasi
    img.addEventListener("click", (e) => {
      if (!isActive) return;
      e.preventDefault();
      e.stopPropagation();
    }, true); // capture phase biar lebih cepat dari handler site
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

    if (!isActive) {
      removeOverlay(); removeSelectionBox(); removeStickyNote();
      document.querySelectorAll("img[data-mt-attached]").forEach(img => img.style.cursor = "");
    } else {
      attachImageListeners();
      document.querySelectorAll("img[data-mt-attached]").forEach(img => img.style.cursor = "crosshair");
      showToast("Drag area speech bubble untuk menerjemahkan");
    }
  }
  if (msg.type === "CLEAR") { removeOverlay(); removeSelectionBox(); removeStickyNote(); }
}); } catch { /* context already invalidated */ }
