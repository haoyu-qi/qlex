#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "$ROOT/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
TMP_WORK="$(mktemp -d)"
trap 'rm -rf "$TMP_WORK"' EXIT

TEMPLATE_APP="${QLEX_TEMPLATE_APP:-}"
if [[ -z "$TEMPLATE_APP" ]]; then
  for cand in "/Applications/QLEX.app" "$HOME/Downloads/QLEX.app" "$ROOT/dist/QLEX.app"; do
    if [[ -d "$cand" ]]; then
      TEMPLATE_APP="$cand"
      break
    fi
  done
fi
if [[ -z "$TEMPLATE_APP" ]]; then
  LATEST_ZIP="$(ls -t "$WORKSPACE_ROOT/installers"/QLEX-*-macOS-arm64.zip 2>/dev/null | head -n 1 || true)"
  if [[ -n "$LATEST_ZIP" && -f "$LATEST_ZIP" ]]; then
    ditto -x -k "$LATEST_ZIP" "$TMP_WORK/unzipped"
    if [[ -d "$TMP_WORK/unzipped/QLEX.app" ]]; then
      TEMPLATE_APP="$TMP_WORK/unzipped/QLEX.app"
    fi
  fi
fi
KOFFI_SRC="${QLEX_KOFFI_SRC:-}"
if [[ -z "$KOFFI_SRC" ]]; then
  for cand in \
    "/Applications/Token Monitor.app/Contents/Resources/app.asar.unpacked/node_modules/koffi" \
    "/Applications/QLEX.app/Contents/Resources/app.asar.unpacked/node_modules/koffi" \
    "$ROOT/dist/QLEX.app/Contents/Resources/app.asar.unpacked/node_modules/koffi" \
    "${TEMPLATE_APP}/Contents/Resources/app.asar.unpacked/node_modules/koffi"; do
    if [[ -n "$cand" && -d "$cand" ]]; then
      KOFFI_SRC="$cand"
      break
    fi
  done
fi
NODE_FORGE_SRC="${QLEX_NODE_FORGE_SRC:-}"

OUT_DIR="$ROOT/dist"
STAGE_DIR="$OUT_DIR/stage-app"
APP_OUT="$OUT_DIR/QLEX.app"
INSTALLERS_DIR="$WORKSPACE_ROOT/installers"
ZIP_OUT="$INSTALLERS_DIR/QLEX-${VERSION}-macOS-arm64.zip"
PKG_OUT="$INSTALLERS_DIR/QLEX-${VERSION}-macOS-arm64.pkg"

if [[ -z "$TEMPLATE_APP" || ! -d "$TEMPLATE_APP" ]]; then
  echo "Error: template QLEX.app not found (checked /Applications/QLEX.app, ~/Downloads/QLEX.app, dist/QLEX.app, installers/*.zip)" >&2
  exit 1
fi
if [[ -z "$KOFFI_SRC" || ! -d "$KOFFI_SRC" ]]; then
  echo "Error: koffi prebuilt addon not found" >&2
  exit 1
fi

if [[ "$TEMPLATE_APP" == "$APP_OUT" ]]; then
  ditto "$APP_OUT" "$TMP_WORK/template-QLEX.app"
  TEMPLATE_APP="$TMP_WORK/template-QLEX.app"
fi
if [[ "$KOFFI_SRC" == "$APP_OUT"* ]]; then
  cp -R "$KOFFI_SRC" "$TMP_WORK/koffi"
  KOFFI_SRC="$TMP_WORK/koffi"
fi

rm -rf "$STAGE_DIR" "$APP_OUT"
mkdir -p "$STAGE_DIR/node_modules" "$OUT_DIR" "$INSTALLERS_DIR"

# Build embedded Tailscale tsnet Go SDK sidecar if Go is available and binary missing
TSNET_BIN="$ROOT/desktop/bin/qlex-tsnet-darwin-arm64"
if [[ ! -f "$TSNET_BIN" && -d "$ROOT/tsnet-sidecar" ]] && command -v go >/dev/null 2>&1; then
  mkdir -p "$ROOT/desktop/bin"
  (cd "$ROOT/tsnet-sidecar" && CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o "$TSNET_BIN" .)
fi

# Copy application source
cp "$ROOT/package.json" "$STAGE_DIR/package.json"
cp -R "$ROOT/desktop" "$STAGE_DIR/desktop"
cp -R "$ROOT/docs" "$STAGE_DIR/docs"

# Copy node-forge from existing app.asar or explicit path
if [[ -n "$NODE_FORGE_SRC" && -d "$NODE_FORGE_SRC" ]]; then
  cp -R "$NODE_FORGE_SRC" "$STAGE_DIR/node_modules/node-forge"
else
  npx --yes @electron/asar extract "$TEMPLATE_APP/Contents/Resources/app.asar" "$TMP_WORK/old-app"
  cp -R "$TMP_WORK/old-app/node_modules/node-forge" "$STAGE_DIR/node_modules/node-forge"
fi

# Copy koffi (arm64 native N-API addon for macOS NSGlassEffectView & NSVisualEffectView maskImage)
cp -R "$KOFFI_SRC" "$STAGE_DIR/node_modules/koffi"

# Copy Electron app template
ditto "$TEMPLATE_APP" "$APP_OUT"
rm -rf "$APP_OUT/Contents/Resources/app.asar" "$APP_OUT/Contents/Resources/app.asar.unpacked"
if [[ -f "$ROOT/docs/assets/brand/icon.icns" ]]; then
  cp "$ROOT/docs/assets/brand/icon.icns" "$APP_OUT/Contents/Resources/icon.icns"
fi

# Pack app.asar with koffi & embedded tsnet binary unpacked so native binaries execute cleanly
npx --yes @electron/asar pack "$STAGE_DIR" "$APP_OUT/Contents/Resources/app.asar" --unpack="{**/node_modules/koffi/**,**/desktop/bin/**}"

# Compute exact asar header SHA-256 for ElectronAsarIntegrity and update Info.plist
ASAR_HASH="$(node -e "
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const raw = asar.getRawHeader(process.argv[1]);
console.log(crypto.createHash('sha256').update(raw.headerString).digest('hex'));
" "$APP_OUT/Contents/Resources/app.asar" 2>/dev/null || node -e "
const fs = require('node:fs');
const crypto = require('node:crypto');
const buf = fs.readFileSync(process.argv[1]);
// Chromium pickle: uint32 payloadSize (4) + uint32 headerSize (4) + uint32 unknown (4) + uint32 stringLen (4)
const strLen = buf.readUInt32LE(12);
const headerStr = buf.subarray(16, 16 + strLen).toString('utf8');
console.log(crypto.createHash('sha256').update(headerStr).digest('hex'));
" "$APP_OUT/Contents/Resources/app.asar")"

PLIST="$APP_OUT/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:'Resources/app.asar':hash $ASAR_HASH" "$PLIST"

# Ad-hoc sign so macOS arm64 executes cleanly without code signature error
codesign --force --deep --sign - "$APP_OUT"
codesign --verify --deep --strict "$APP_OUT"

# Create ZIP archive
rm -f "$ZIP_OUT"
ditto -c -k --sequesterRsrc --keepParent "$APP_OUT" "$ZIP_OUT"

# Create macOS .pkg installer (installs to /Applications/QLEX.app)
rm -f "$PKG_OUT"
pkgbuild \
  --component "$APP_OUT" \
  --install-location "/Applications" \
  --identifier "app.qlex.desktop" \
  --version "$VERSION" \
  "$PKG_OUT"

# Cleanup staging
rm -rf "$STAGE_DIR"

echo "Built QLEX $VERSION successfully:"
echo "  APP: $APP_OUT"
echo "  ZIP: $ZIP_OUT"
echo "  PKG: $PKG_OUT"
echo "  ASAR SHA256: $ASAR_HASH"
