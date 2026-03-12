#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_FILE="$ROOT_DIR/src/swift/chris-reminders.swift"
APP_DIR="$HOME/.chris-assistant/ChrisReminders.app"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
PLIST_FILE="$CONTENTS_DIR/Info.plist"
BIN_FILE="$MACOS_DIR/ChrisReminders"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "setup:reminders-helper only supports macOS." >&2
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
  <string>ChrisReminders</string>
  <key>CFBundleExecutable</key>
  <string>ChrisReminders</string>
  <key>CFBundleIdentifier</key>
  <string>com.chris-assistant.reminders-helper</string>
  <key>CFBundleName</key>
  <string>ChrisReminders</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSRemindersUsageDescription</key>
  <string>Chris Assistant needs Reminders access to list and manage your reminders.</string>
</dict>
</plist>
PLIST

xcrun swiftc "$SRC_FILE" -framework EventKit -o "$BIN_FILE"
chmod +x "$BIN_FILE"

# Ad-hoc codesign so macOS treats it as a proper app for TCC
codesign --force --deep --sign - "$APP_DIR"

echo "Installed Reminders helper app:"
echo "  $APP_DIR"
echo
echo "Run this once from Terminal to trigger reminders permission prompt:"
echo "  open -n -W \"$APP_DIR\" --args list-lists"
