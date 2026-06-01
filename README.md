# Manga Translator

A Chrome extension that lets you drag-select any manga speech bubble and instantly get a translated sticky note beside it. Uses Vision LLM (no OCR pipeline) for accurate results on stylized manga fonts. Free via OpenRouter.

![demo](https://i.imgur.com/placeholder.png)

---

## Fitur

- **Drag-to-select** — gambar area speech bubble bebas, bukan kotak statis
- **Vision LLM** — OCR + translate dalam 1 request, akurat untuk manga font stylized
- **Sticky note** — hasil terjemahan muncul di samping seleksi, gambar tetap keliatan
- **Multi bahasa sumber** — Jepang, Vietnam, English, China, Korea
- **Multi bahasa tujuan** — Indonesia, Vietnam, English
- **Custom model** — pilih dari dropdown atau ketik model ID OpenRouter sendiri
- **Zero install deps** — tidak perlu Node.js, webpack, dll

---

## Cara Install

### 1. Clone / Download

```bash
git clone https://github.com/username/manga-translator
cd manga-translator
```

### 2. Load ke Chrome

1. Buka `chrome://extensions`
2. Aktifkan **Developer mode** (toggle kanan atas)
3. Klik **Load unpacked** → pilih folder `manga-translator`

### 3. Setup API Key

1. Daftar gratis di [openrouter.ai](https://openrouter.ai)
2. Buat API key di [openrouter.ai/keys](https://openrouter.ai/keys)
3. Klik icon extension → paste key di field **OpenRouter API Key**

---

## Cara Pakai

1. Buka halaman manga (MangaDex, dll)
2. Klik icon extension → toggle **Aktifkan**
3. Kursor berubah jadi crosshair di atas gambar
4. **Klik & drag** area speech bubble yang mau ditranslate
5. Sticky note muncul di samping dengan hasil terjemahan
6. Klik **×** di sticky note untuk hapus, atau drag area baru

---

## Pilihan Model

Buka popup → field **Model**. Default: `Qwen2.5 VL 72B (free)`.

| Model | Kualitas | Catatan |
|-------|----------|---------|
| `qwen/qwen2.5-vl-72b-instruct:free` | ⭐⭐⭐⭐⭐ | Terbaik untuk manga Asia |
| `meta-llama/llama-4-scout:free` | ⭐⭐⭐⭐ | Stabil, cepat |
| `meta-llama/llama-4-maverick:free` | ⭐⭐⭐⭐ | Alternatif |
| `google/gemini-2.0-flash-exp:free` | ⭐⭐⭐⭐ | Bagus tapi kadang offline |
| `microsoft/phi-4-multimodal-instruct:free` | ⭐⭐⭐ | Ringan |

Semua model di atas **gratis** di OpenRouter (rate limit ~20 req/menit).

Browse model lain: [openrouter.ai/models?supported_parameters=vision](https://openrouter.ai/models?supported_parameters=vision)

Kalau model error `"no endpoints"` → model lagi offline, ganti ke model lain.

---

## Arsitektur

```
User drag area
      │
      ▼
content.js — crop region dari gambar (canvas 2×)
      │
      ▼
background.js — fetch gambar (bypass CORS)
      │
      ▼
OpenRouter API — Vision LLM (OCR + translate 1 request)
      │
      ▼
Sticky note muncul di samping seleksi
```

**Kenapa Vision LLM, bukan Tesseract?**
Tesseract ditraining dari dokumen print biasa — manga font yang stylized, italic ekstrem, dan bertumpuk di speech bubble hasilnya sering garbled. Vision LLM (Qwen, Llama, Gemini) jauh lebih akurat karena ditraining dari data yang jauh lebih beragam termasuk text-in-image.

---

## File Structure

```
manga-translator/
├── manifest.json       # Chrome extension config (MV3)
├── content.js          # UI logic: drag selection, sticky note, OpenRouter call
├── background.js       # Service worker: fetch gambar bypass CORS
├── popup.html/js       # Extension popup: settings
├── styles.css          # Overlay, sticky note, selection box styles
└── icons/              # Extension icons
```

---

## Limitasi

- Free model OpenRouter bisa offline sewaktu-waktu → ganti model lain
- Akurasi turun untuk font yang sangat decorative / teks miring ekstrem
- CORS: beberapa situs block fetch gambar dari extension → gambar tidak bisa diproses
- Rate limit free tier OpenRouter: ~20 request/menit

---

## License

MIT
