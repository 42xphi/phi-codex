#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$ROOT/../.." && pwd)"
BUILD_DIR="$ROOT/build"
DIST_DIR="$ROOT/dist"
ICON_PNG="$BUILD_DIR/pi-icon-1024.png"
ASSET_ICON="$ROOT/assets/icon.png"
ICONSET_DIR="$BUILD_DIR/Pi.iconset"
ICON_ICNS="$BUILD_DIR/Pi.icns"
BIN_OUT="$BUILD_DIR/Pi"
APP_OUT="$DIST_DIR/Pi.app"
SERVER_ROOT="$REPO_ROOT/server"
SERVER_STAGE="$BUILD_DIR/server"

mkdir -p "$BUILD_DIR" "$DIST_DIR"

echo "[1/6] Preparing icon..."
if [[ -f "$ASSET_ICON" ]]; then
  /usr/bin/sips -z 1024 1024 "$ASSET_ICON" --out "$ICON_PNG" >/dev/null
else
  python3 "$ROOT/scripts/generate_icon.py" "$ICON_PNG"
fi

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

function mk_icon() {
  local size="$1"
  local out="$2"
  /usr/bin/sips -z "$size" "$size" "$ICON_PNG" --out "$out" >/dev/null
}

mk_icon 16 "$ICONSET_DIR/icon_16x16.png"
mk_icon 32 "$ICONSET_DIR/icon_16x16@2x.png"
mk_icon 32 "$ICONSET_DIR/icon_32x32.png"
mk_icon 64 "$ICONSET_DIR/icon_32x32@2x.png"
mk_icon 128 "$ICONSET_DIR/icon_128x128.png"
mk_icon 256 "$ICONSET_DIR/icon_128x128@2x.png"
mk_icon 256 "$ICONSET_DIR/icon_256x256.png"
mk_icon 512 "$ICONSET_DIR/icon_256x256@2x.png"
mk_icon 512 "$ICONSET_DIR/icon_512x512.png"
cp "$ICON_PNG" "$ICONSET_DIR/icon_512x512@2x.png"

/usr/bin/iconutil -c icns "$ICONSET_DIR" -o "$ICON_ICNS"

echo "[2/6] Preparing embedded Codex server..."
rm -rf "$SERVER_STAGE"
mkdir -p "$SERVER_STAGE"

if [[ ! -d "$SERVER_ROOT/node_modules" ]]; then
  echo " - Installing server dependencies..."
  npm --prefix "$SERVER_ROOT" install
fi

echo " - Building server dist..."
npm --prefix "$SERVER_ROOT" run build

echo " - Installing production deps (embedded)..."
cp "$SERVER_ROOT/package.json" "$SERVER_ROOT/package-lock.json" "$SERVER_STAGE/"
npm --prefix "$SERVER_STAGE" ci --omit=dev
cp -R "$SERVER_ROOT/dist" "$SERVER_STAGE/dist"

echo "[3/6] Building app binary..."
/usr/bin/xcrun swiftc \
  -parse-as-library \
  -O \
  -o "$BIN_OUT" \
  "$ROOT/src/PiMacBridge.swift" \
  -framework SwiftUI \
  -framework AppKit \
  -framework Network \
  -framework OSAKit \
  -framework ApplicationServices \
  -lsqlite3

echo "[4/6] Packaging .app..."
rm -rf "$APP_OUT"
mkdir -p "$APP_OUT/Contents/MacOS" "$APP_OUT/Contents/Resources"
cp "$BIN_OUT" "$APP_OUT/Contents/MacOS/Pi"
cp "$ICON_ICNS" "$APP_OUT/Contents/Resources/Pi.icns"
/usr/bin/ditto "$SERVER_STAGE" "$APP_OUT/Contents/Resources/server"

cat > "$APP_OUT/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Pi</string>
  <key>CFBundleExecutable</key>
  <string>Pi</string>
  <key>CFBundleIdentifier</key>
  <string>pe.phi.pi</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Pi</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.2.0</string>
  <key>CFBundleVersion</key>
  <string>2</string>
  <key>LSMinimumSystemVersion</key>
  <string>13.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>CFBundleIconFile</key>
  <string>Pi.icns</string>
  <key>LSMultipleInstancesProhibited</key>
  <true/>
  <key>NSAppleEventsUsageDescription</key>
  <string>Pi needs Automation permission to control apps on your behalf.</string>
  <key>NSHumanReadableCopyright</key>
  <string></string>
</dict>
</plist>
PLIST

IDENTITY="${PI_CODESIGN_IDENTITY:-}"
if [[ -z "$IDENTITY" ]]; then
  IDENTITY="$(security find-identity -v -p codesigning 2>/dev/null | awk -F'\"' '/\"/ {print $2; exit}')"
fi

if [[ -n "$IDENTITY" ]]; then
  echo "[5/6] Codesigning (identity: $IDENTITY)..."
  /usr/bin/codesign -s "$IDENTITY" --force --deep "$APP_OUT" >/dev/null
else
  echo "[5/6] Codesigning (ad-hoc)..."
  /usr/bin/codesign -s - --force --deep "$APP_OUT" >/dev/null
fi

echo "Built: $APP_OUT"

echo "[6/6] Installing to Applications (best-effort)..."
INSTALL_DIR="/Applications"
if [[ ! -w "$INSTALL_DIR" ]]; then
  INSTALL_DIR="$HOME/Applications"
  mkdir -p "$INSTALL_DIR"
fi
INSTALL_APP="$INSTALL_DIR/Pi.app"
if /usr/bin/ditto "$APP_OUT" "$INSTALL_APP" 2>/dev/null; then
  echo "Installed: $INSTALL_APP"
else
  echo "Install skipped (no permission). Built app remains at: $APP_OUT"
fi
