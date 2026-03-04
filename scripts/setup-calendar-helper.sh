#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_FILE="$ROOT_DIR/src/swift/chris-calendar.swift"
APP_DIR="$HOME/.chris-assistant/ChrisCalendar.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
PLIST_FILE="$CONTENTS_DIR/Info.plist"
BIN_FILE="$MACOS_DIR/ChrisCalendar"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup:calendar-helper only supports macOS." >&2
  exit 1
fi

if [[ ! -f "$SRC_FILE" ]]; then
  echo "Swift source not found: $SRC_FILE" >&2
  exit 1
fi

mkdir -p "$MACOS_DIR"

cat > "$PLIST_FILE" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>ChrisCalendar</string>
  <key>CFBundleExecutable</key>
  <string>ChrisCalendar</string>
  <key>CFBundleIdentifier</key>
  <string>com.chris-assistant.calendar-helper</string>
  <key>CFBundleName</key>
  <string>ChrisCalendar</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSBackgroundOnly</key>
  <true/>
  <key>NSCalendarsUsageDescription</key>
  <string>Chris Assistant needs Calendar access to list and manage your events.</string>
</dict>
</plist>
PLIST

xcrun swiftc "$SRC_FILE" -framework EventKit -o "$BIN_FILE"
chmod +x "$BIN_FILE"

echo "Installed Calendar helper app:"
echo "  $APP_DIR"
echo
echo "Run this once from Terminal to trigger calendar permission prompt:"
echo "  open \"$APP_DIR\" --args list-calendars"
