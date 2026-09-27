#!/usr/bin/env bash
# Strata Code - macOS launcher. Double-click in Finder (opens Terminal) or run
# from a shell. First run, and after a `git pull`: installs dependencies and
# builds; every run: makes sure Ollama answers, then starts the app. The coder llama-server on port
# 8080 is started by the app itself on the first coding prompt (electron/main.ts).
cd "$(dirname "$0")" || exit 1

# A Finder launch has no Homebrew on PATH.
if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
# Node 24 first: Node 26 breaks Electron's installer (extract-zip) and better-sqlite3 (see MACOS.md).
[ -d /opt/homebrew/opt/node@24/bin ] && export PATH="/opt/homebrew/opt/node@24/bin:$PATH"

if ! command -v node >/dev/null 2>&1; then
  echo "Node is not installed. Run scripts/mac/setup.sh first." >&2
  read -r -p "Press Return to close." _; exit 1
fi
if [ ! -d node_modules/electron/dist ]; then
  echo "[*] First run: installing dependencies..."
  npm install --no-audit --no-fund || { read -r -p "npm install failed. Press Return to close." _; exit 1; }
fi

# Launched from the ~/Applications app (scripts/mac/install-shortcuts.sh) there is no Terminal: the
# output goes to its log and stdin is /dev/null, so a long update or a failure would be invisible.
# Those say so in a notification (the text goes in as an argument, never parsed as AppleScript).
launch_log="~/Library/Logs/StrataCode/launch.log"
notify() {
  [ -t 1 ] && return 0
  osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "Strata Code"' -e 'end run' "$1" >/dev/null 2>&1 || true
}

# An instance of this checkout already running: installing or building now would change the files
# under it (vite empties dist/ beneath the live renderer), and this launch only focuses its window
# (single-instance lock). Both wait for the next launch. `electron .` (node_modules/electron/cli.js)
# spawns the bundle's binary by its real path with the app folder as argument; the helper processes
# run from elsewhere in the bundle. -a: pgrep otherwise skips its own ancestors, and this script may
# run inside the app it would rebuild (its Terminal drawer, or the agent's run_command).
electron_bin="$(pwd -P)/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
running=0
pgrep -af "^$(printf '%s' "$electron_bin" | sed 's/[][\.*^$+?(){}|]/\\&/g')( |\$)" >/dev/null 2>&1 && running=1
[ "$running" = 1 ] && echo "[*] Strata Code is already running: no install or build now."

# package.json or its lock changed (a `git pull`): install again, then build. npm records an install
# in node_modules/.package-lock.json but leaves that file alone when nothing changed, so it is
# touched here to date this one.
reinstalled=0
if [ "$running" = 0 ] && [ -d node_modules ] && { [ package.json -nt node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; }; then
  echo "[*] Dependencies changed: installing..."
  notify "Installing updated dependencies (a minute or two)"
  npm install --no-audit --no-fund || { notify "npm install failed. Details: $launch_log"; read -r -p "npm install failed. Press Return to close." _; exit 1; }
  touch node_modules/.package-lock.json; reinstalled=1
fi
# Build on the first run, and again whenever the sources are newer than the build (after a
# `git pull`), so the app never runs yesterday's code.
if [ "$running" = 0 ] && { [ "$reinstalled" = 1 ] || [ ! -f dist-electron/main.js ] || [ -n "$(find electron src index.html package.json vite.config.ts -newer dist-electron/main.js 2>/dev/null | head -1)" ]; }; then
  echo "[*] Building..."
  notify "Updating after a code change (about a minute)"
  if ! npm run build; then
    # New code that does not build still leaves the previous build: start that rather than nothing.
    [ -f dist-electron/main.js ] || { notify "npm run build failed. Details: $launch_log"; read -r -p "npm run build failed. Press Return to close." _; exit 1; }
    echo "[!] npm run build failed; starting the previous build."
    notify "The update did not build; starting the previous version. Details: $launch_log"
  fi
fi

# Ollama daemon (cheap; loads no model). Ollama.app users already have it running.
if ! curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  if command -v ollama >/dev/null 2>&1; then
    echo "[*] Starting Ollama..."
    (nohup ollama serve >/dev/null 2>&1 &)
  elif [ -d /Applications/Ollama.app ]; then
    open -g -a Ollama
  fi
fi

echo "[*] Launching Strata Code..."
# Name and icon. In development the app runs inside the stock Electron bundle, which macOS
# shows as "Electron" in the Dock, the menu bar and the app switcher. The bundle is only
# ad-hoc signed, so its Info.plist and icon can be replaced and the app re-signed ad hoc
# (what @electron/packager does at packaging time). Done once per Electron install.
brand_electron() {
  local app="node_modules/electron/dist/Electron.app" plist png="assets/strata-code-sc-256.png"
  plist="$app/Contents/Info.plist"
  [ -f "$plist" ] || return 0
  # One bundle id per app: LaunchServices caches the display name by identifier, and the three
  # Strata apps all shipped as com.github.Electron, so the Dock kept calling them "Electron".
  [ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleDisplayName' "$plist" 2>/dev/null)" = "Strata Code" ] && [ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$plist" 2>/dev/null)" = "com.kaustubhjawanjal.stratacode" ] && return 0
  echo "[*] Naming the Electron bundle Strata Code..."
  /usr/libexec/PlistBuddy -c 'Set :CFBundleName Strata Code' -c 'Set :CFBundleDisplayName Strata Code' -c 'Set :CFBundleIdentifier com.kaustubhjawanjal.stratacode' "$plist" || return 0
  if [ -f "$png" ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
    local set; set="$(mktemp -d)/icon.iconset"; mkdir -p "$set"
    for s in 16 32 128 256 512; do
      sips -z $s $s "$png" --out "$set/icon_${s}x${s}.png" >/dev/null 2>&1 || true
      d=$((s*2)); [ $d -le 1024 ] && sips -z $d $d "$png" --out "$set/icon_${s}x${s}@2x.png" >/dev/null 2>&1 || true
    done
    iconutil -c icns "$set" -o "$app/Contents/Resources/electron.icns" 2>/dev/null || true
    rm -rf "$(dirname "$set")"
  fi
  codesign --force --sign - "$app" >/dev/null 2>&1 || echo "[!] could not re-sign the Electron bundle; the name may show as Electron"
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$app" >/dev/null 2>&1 || true
}
brand_electron

exec npm start
