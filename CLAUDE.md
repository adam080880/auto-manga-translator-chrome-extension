# Manga Translator — CLAUDE.md

Chrome extension (Manifest V3) that translates manga speech bubbles using Vision LLM via OpenRouter. No build step, no bundler — plain JS files loaded directly by Chrome.

## File Structure

```
manifest.json   MV3 config: permissions, content_scripts, background
content.js      All UI logic — drag selection, crop, OpenRouter call, sticky note
background.js   Service worker — fetches cross-origin images as dataUrl (CORS bypass)
popup.html/js   Extension popup — API key, model picker, language selectors
styles.css      Selection box, sticky note, toast, loading indicator styles
lib/            Tesseract.js files (gitignored, legacy — not used in current flow)
download-deps.sh  Script to re-download lib/ if needed
```

## Architecture

```
User drag → content.js crops canvas region (2× upscale)
         → background.js fetches full image (CORS bypass via chrome.runtime.sendMessage)
         → content.js calls OpenRouter with base64 image + prompt
         → sticky note rendered next to selection box
```

Key design decisions:
- **Vision LLM over Tesseract** — manga fonts are stylized/italic; Tesseract accuracy is poor. One Vision LLM call handles OCR + translation simultaneously.
- **Background for image fetch** — content scripts can't fetch cross-origin images directly; the service worker has no CORS restriction.
- **WeakMap for image cache** — full image dataUrl is cached per `<img>` element to avoid re-fetching on each drag.
- **Capture-phase click listener** — prevents manga reader page navigation when clicking images while active.

## Common Tasks

### Add a new source/target language
- `popup.html` — add `<option>` to `#sourceLangSelect` or `#targetLangSelect`
- `content.js` — add entry to `LANG_NAMES` map

### Change the default model
- `content.js` — update `DEFAULT_MODEL` constant
- `popup.html` — add/reorder `<option>` in `#modelSelect`

### Change the OpenRouter prompt
- `content.js` — edit the `text` field inside `callVision()`

### Adjust selection box size / drag threshold
- `content.js` — `endDrag()`: minimum drag size is `w < 20 || h < 20`
- `styles.css` — `.mt-selection-box` for visual tweaks

### Add a new sticky note position (e.g. always below)
- `content.js` — `showStickyNote()`: extend the `left`/`arrowClass` if-else chain

## Development Workflow

No build step needed.

1. Edit files directly
2. Go to `chrome://extensions` → click reload icon on the extension
3. **Refresh the tab** you're testing on (content scripts don't hot-reload)
4. Open DevTools console on the tab to see errors

Common gotcha: "Extension context invalidated" in console = extension was reloaded but tab wasn't refreshed. Always F5 the tab after reloading the extension.

## API

**OpenRouter** (`https://openrouter.ai/api/v1/chat/completions`)
- Auth: `Authorization: Bearer <key>`
- Format: OpenAI-compatible chat completions
- Image passed as `image_url` with `data:<mime>;base64,<data>` URI
- Key stored in `chrome.storage.local` as `openrouterKey`
- Model stored as `model` (dropdown) or `customModel` (text input, takes priority)

## Permissions

| Permission | Why |
|---|---|
| `activeTab` | Access current tab's DOM |
| `scripting` | Inject content scripts dynamically if needed |
| `storage` | Persist API key, language prefs, model choice |
| `https://openrouter.ai/*` | Call the translation API |
| `*://*/*` | Fetch manga images from any domain (CORS bypass in background) |
