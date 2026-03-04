#!/usr/bin/env bash
# Build the chris-calendar Swift binary and create the macOS app bundle.
# Requires: macOS with Command Line Tools installed.
# Usage: bash scripts/build-calendar-helper.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SWIFT_SRC="$PROJECT_DIR/src/swift/chris-calendar.swift"

INSTALL_DIR="$HOME/.chris-assistant"
BIN_DIR="$INSTALL_DIR/bin"
APP_DIR="$INSTALL_DIR/ChrisCalendar.app/Contents"

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Skipping: chris-calendar only builds on macOS" >&2
  exit 0
fi

if ! command -v swiftc &>/dev/null; then
  echo "Error: swiftc not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

# Find the best SDK
SDK=""
for candidate in /Library/Developer/CommandLineTools/SDKs/MacOSX*.sdk; do
  [[ -d "$candidate" && ! -L "$candidate" ]] && SDK="$candidate"
done

if [[ -z "$SDK" ]]; then
  echo "Error: No macOS SDK found in /Library/Developer/CommandLineTools/SDKs/" >&2
  exit 1
fi

echo "Using SDK: $SDK"

# ---------------------------------------------------------------------------
# Compile
# ---------------------------------------------------------------------------

mkdir -p "$BIN_DIR" "$APP_DIR/MacOS"

echo "Compiling chris-calendar..."
swiftc -sdk "$SDK" -target arm64-apple-macos15.0 -O \
  "$SWIFT_SRC" -o "$BIN_DIR/chris-calendar"

# Copy into app bundle
cp "$BIN_DIR/chris-calendar" "$APP_DIR/MacOS/chris-calendar"

# ---------------------------------------------------------------------------
# App bundle Info.plist (for TCC Calendar permission)
# ---------------------------------------------------------------------------

cat > "$APP_DIR/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.chris-assistant.calendar-helper</string>
    <key>CFBundleName</key>
    <string>ChrisCalendar</string>
    <key>CFBundleExecutable</key>
    <string>chris-calendar</string>
    <key>CFBundleVersion</key>
    <string>1.0</string>
    <key>LSUIElement</key>
    <true/>
    <key>NSCalendarsUsageDescription</key>
    <string>Chris Assistant needs calendar access to manage your events.</string>
    <key>NSCalendarsFullAccessUsageDescription</key>
    <string>Chris Assistant needs full calendar access to view and create events.</string>
</dict>
</plist>
PLIST

# ---------------------------------------------------------------------------
# Codesign
# ---------------------------------------------------------------------------

codesign --force --deep --sign - "$INSTALL_DIR/ChrisCalendar.app"

echo ""
echo "Built: $BIN_DIR/chris-calendar"
echo "App bundle: $INSTALL_DIR/ChrisCalendar.app"
echo ""
echo "To grant Calendar permission, run once:"
echo "  open $INSTALL_DIR/ChrisCalendar.app"
echo "Then approve the permission dialog."
