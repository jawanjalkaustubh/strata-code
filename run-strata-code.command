#!/usr/bin/env bash
# Strata Code - macOS launcher. Double-click in Finder (opens Terminal) or run
# from a shell. First run: installs dependencies and builds; every run: makes
# sure Ollama answers, then starts the app. The coder llama-server on port
# 8080 is started by the app itself on the first coding prompt (electron/main.ts).
cd "$(dirname "$0")" || exit 1

# A Finder launch has no Homebrew on PATH.
if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

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
exec npm start
