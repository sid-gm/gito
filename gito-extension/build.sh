#!/usr/bin/env bash
set -e

rm -rf dist
mkdir -p dist/icons

# Compile TypeScript with esbuild
./node_modules/.bin/esbuild popup.ts content.ts background.ts \
  --bundle \
  --outdir=dist \
  --target=chrome120 \
  --platform=browser

# Copy static assets
cp manifest.json dist/
cp popup.html dist/
cp -r icons/* dist/icons/ 2>/dev/null || true

echo "✓ Build complete → dist/"
