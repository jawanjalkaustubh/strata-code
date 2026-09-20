#!/usr/bin/env bash
# Strata Code - macOS launcher. Double-click in Finder (opens Terminal) or run
# from a shell. First run: installs dependencies and builds; every run: makes
# sure Ollama answers, then starts the app. The coder llama-server on port
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
if [ ! -f dist-electron/main.js ]; then
  echo "[*] First run: building..."
  npm run build || { read -r -p "npm run build failed. Press Return to close." _; exit 1; }
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
  [ "$(/usr/libexec/PlistBuddy -c 'Print CFBundleDisplayName' "$plist" 2>/dev/null)" = "Strata Code" ] && return 0
  echo "[*] Naming the Electron bundle Strata Code..."
  /usr/libexec/PlistBuddy -c 'Set :CFBundleName Strata Code' -c 'Set :CFBundleDisplayName Strata Code' "$plist" || return 0
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
}
brand_electron

exec npm start
