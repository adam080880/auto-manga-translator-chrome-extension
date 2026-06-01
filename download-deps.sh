#!/usr/bin/env bash
# Download Tesseract.js v5 files into lib/
# Run once before loading the extension: bash download-deps.sh

set -e

LIB="$(dirname "$0")/lib"
mkdir -p "$LIB"

BASE="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist"

echo "Downloading tesseract.min.js..."
curl -L "$BASE/tesseract.min.js" -o "$LIB/tesseract.min.js"

echo "Downloading worker.min.js..."
curl -L "$BASE/worker.min.js" -o "$LIB/worker.min.js"
# WASM dan language data diload otomatis dari CDN saat runtime

echo ""
echo "Done! File lib/ siap. Sekarang load extension di chrome://extensions"
