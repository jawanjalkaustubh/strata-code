#!/usr/bin/env bash
# =============================================================================
#  STRATA CODE - macOS (Apple Silicon) SETUP
#
#  Sets up everything the app needs on a Mac, the way installer/Install.ps1
#  does on Windows:
#    1. checks the chip and unified memory
#    2. installs Node, Ollama and llama.cpp with Homebrew (and Homebrew itself)
#    3. pulls the general model (qwen3.8:27b, ~18 GB) into Ollama
#    4. downloads the coder GGUF (~19-25 GB) into the Strata data dir
#    5. writes coder-config.json with a context size that fits this machine
#    6. installs the app's npm dependencies and builds it
#
#  Downloads resume if interrupted - just run the script again.
#
#  Usage:  scripts/mac/setup.sh [options]
#    --coder Q6_K|Q4_K_M|none   force a coder quant (default: by memory)
#    --general <ollama tag>|none  general model for Ollama (default: by memory)
#    --skip-models              only Homebrew packages + build
#    --no-build                 do not run npm install / npm run build
#    --no-shortcuts             do not create the ~/Applications app + Desktop alias
#    --yes                      no prompts (accept Homebrew install, big downloads)
#
#  Where things land (see electron/paths.ts):
#    ~/Library/Application Support/Strata/code/models/*.gguf
#    ~/Library/Application Support/Strata/code/coder-config.json
#    llama-server: /opt/homebrew/bin (brew install llama.cpp)
# =============================================================================
set -euo pipefail

CODER="auto"
GENERAL="auto"
SKIP_MODELS=0
NO_BUILD=0
NO_SHORTCUTS=0
YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --coder) CODER="$2"; shift 2 ;;
    --general) GENERAL="$2"; shift 2 ;;
    --skip-models) SKIP_MODELS=1; shift ;;
    --no-build) NO_BUILD=1; shift ;;
    --no-shortcuts) NO_SHORTCUTS=1; shift ;;
    --yes|-y) YES=1; shift ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DATA="${STRATA_DATA_DIR:-$HOME/Library/Application Support/Strata}"
CODE_DIR="$DATA/code"
MODELS_DIR="${STRATA_MODELS_DIR:-$CODE_DIR/models}"
CONFIG="$CODE_DIR/coder-config.json"
LOG="$REPO/setup-mac.log"

CODER_REPO="https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main"
# name | bytes | min unified GB | ctx  (same table as installer/Install.ps1)
Q6_NAME="Qwen3-Coder-30B-A3B-Instruct-Q6_K.gguf";   Q6_BYTES=25092535456
Q4_NAME="Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf"; Q4_BYTES=18556689568

log()  { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }
step() { echo; log "=== $* ==="; }
fail() { log "ERROR: $*"; echo; echo "Setup did not complete. See $LOG. Re-run the script; downloads resume." >&2; exit 1; }
confirm() {
  [ "$YES" = 1 ] && return 0
  read -r -p "$1 [y/N] " a; [[ "$a" =~ ^[Yy] ]]
}

echo
echo "  STRATA CODE - LOCAL DUAL-BRAIN CODING STUDIO - macOS SETUP"
echo "  Repo: $REPO"
echo "  Data: $DATA"
echo

# ---------------------------------------------------------------------------
step "1/7 System check"
# ---------------------------------------------------------------------------
[ "$(uname -s)" = "Darwin" ] || fail "This script is for macOS. On Windows use installer/Install.bat."
ARCH="$(uname -m)"
CHIP="$(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo unknown)"
MEM_BYTES="$(sysctl -n hw.memsize)"
MEM_GB=$(( MEM_BYTES / 1024 / 1024 / 1024 ))
MACOS="$(sw_vers -productVersion 2>/dev/null || echo ?)"
log "Chip: $CHIP ($ARCH)  |  Unified memory: ${MEM_GB} GB  |  macOS $MACOS"
if [ "$ARCH" != "arm64" ]; then
  log "WARNING: Intel Mac. llama.cpp runs on the CPU there; expect a few tokens/s. Apple Silicon is the target."
fi
# Apple lets the GPU wire roughly 3/4 of unified memory (2/3 below 36 GB).
if [ "$MEM_GB" -ge 36 ]; then GPU_GB=$(( MEM_GB * 3 / 4 )); else GPU_GB=$(( MEM_GB * 2 / 3 )); fi
log "GPU-addressable memory (default wired limit): ~${GPU_GB} GB"
FREE_GB=$(( $(df -k "$HOME" | awk 'NR==2{print $4}') / 1024 / 1024 ))
log "Free disk under \$HOME: ${FREE_GB} GB (coder model 19-25 GB + Ollama model ~18 GB)"

# Coder choice: weights + ~51 KB/token of q8 KV cache must fit the GPU budget with the app around it.
if [ "$CODER" = "auto" ]; then
  if   [ "$MEM_GB" -ge 48 ]; then CODER="Q6_K"
  elif [ "$MEM_GB" -ge 24 ]; then CODER="Q4_K_M"
  else CODER="none"; log "Under 24 GB of unified memory: the 30B coder does not fit. Skipping it; the general model via Ollama still works (pick a small one, e.g. --general qwen3:8b)."
  fi
fi
case "$CODER" in
  Q6_K)   CODER_NAME="$Q6_NAME"; CODER_BYTES="$Q6_BYTES" ;;
  Q4_K_M) CODER_NAME="$Q4_NAME"; CODER_BYTES="$Q4_BYTES" ;;
  none)   CODER_NAME=""; CODER_BYTES=0 ;;
  *) fail "--coder must be Q6_K, Q4_K_M or none" ;;
esac
CTX=65536
if [ "$CODER" = "Q6_K" ] && [ "$MEM_GB" -lt 64 ]; then CTX=32768; fi
if [ "$CODER" = "Q4_K_M" ] && [ "$MEM_GB" -lt 36 ]; then CTX=32768; fi
if [ "$CODER" = "Q4_K_M" ] && [ "$MEM_GB" -lt 32 ]; then CTX=16384; fi
[ -n "$CODER_NAME" ] && log "Coder model: $CODER ($(( CODER_BYTES / 1024 / 1024 / 1024 )) GB), context $CTX tokens"
if [ "$CODER" = "Q4_K_M" ] && [ "$MEM_GB" -lt 32 ]; then
  log "NOTE: on a ${MEM_GB} GB Mac the coder only fits with a raised GPU wired limit. If llama-server fails to load the model, run:"
  log "      sudo sysctl iogpu.wired_limit_mb=$(( MEM_GB * 1024 - 4096 ))     (reverts on reboot)"
fi

if [ "$GENERAL" = "auto" ]; then
  if [ "$MEM_GB" -ge 32 ]; then GENERAL="qwen3.8:27b"; else GENERAL="qwen3:8b"; fi
fi
[ "$GENERAL" != "none" ] && log "General model (Ollama): $GENERAL"

# ---------------------------------------------------------------------------
step "2/7 Homebrew, Node, Ollama, llama.cpp"
# ---------------------------------------------------------------------------
if ! command -v brew >/dev/null 2>&1; then
  if [ -x /opt/homebrew/bin/brew ]; then eval "$(/opt/homebrew/bin/brew shellenv)"; fi
fi
if ! command -v brew >/dev/null 2>&1; then
  log "Homebrew is not installed."
  confirm "Install Homebrew now (official installer, asks for your password)?" || fail "Homebrew is required: https://brew.sh"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  eval "$(/opt/homebrew/bin/brew shellenv)"
fi
log "Homebrew: $(brew --version | head -1)"
for pkg in node ollama llama.cpp; do
  if brew list --versions "$pkg" >/dev/null 2>&1; then
    log "$pkg already installed ($(brew list --versions "$pkg"))"
  else
    log "brew install $pkg"
    brew install "$pkg" 2>&1 | tee -a "$LOG" | tail -3
  fi
done
command -v llama-server >/dev/null 2>&1 || fail "llama-server is not on PATH after brew install llama.cpp. Open a new terminal and re-run, or run: eval \"\$(/opt/homebrew/bin/brew shellenv)\""
log "node $(node --version), npm $(npm --version), ollama $(ollama --version 2>/dev/null | head -1), $(llama-server --version 2>&1 | head -1)"

# ---------------------------------------------------------------------------
step "3/7 Ollama service + general model"
# ---------------------------------------------------------------------------
if [ "$SKIP_MODELS" = 1 ] || [ "$GENERAL" = "none" ]; then
  log "Skipped."
else
  if ! curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
    log "Starting ollama serve in the background"
    (nohup ollama serve >/dev/null 2>&1 &)
    for _ in $(seq 1 30); do curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break; sleep 0.5; done
  fi
  curl -fs http://127.0.0.1:11434/api/version >/dev/null 2>&1 || fail "Ollama did not answer on 127.0.0.1:11434"
  if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$GENERAL"; then
    log "$GENERAL already pulled"
  else
    confirm "Pull $GENERAL into Ollama now (large download)?" && ollama pull "$GENERAL" 2>&1 | tee -a "$LOG" | tail -2 || log "Skipped $GENERAL; pull it later with: ollama pull $GENERAL"
  fi
fi

# ---------------------------------------------------------------------------
step "4/7 Coder model (llama.cpp GGUF)"
# ---------------------------------------------------------------------------
mkdir -p "$MODELS_DIR" "$CODE_DIR"
if [ "$SKIP_MODELS" = 1 ] || [ -z "$CODER_NAME" ]; then
  log "Skipped."
else
  DEST="$MODELS_DIR/$CODER_NAME"
  have=0; [ -f "$DEST" ] && have=$(stat -f %z "$DEST")
  if [ "$have" = "$CODER_BYTES" ]; then
    log "$CODER_NAME already complete ($have bytes)"
  else
    [ "$have" -gt 0 ] && log "Resuming $CODER_NAME from $have bytes"
    confirm "Download $CODER_NAME ($(( CODER_BYTES / 1024 / 1024 / 1024 )) GB) to $MODELS_DIR?" || fail "Coder download declined; re-run later, or use --coder none."
    curl -L --fail --retry 5 --retry-delay 5 -C - -o "$DEST" "$CODER_REPO/$CODER_NAME" 2>&1 | tee -a "$LOG" | tail -1
    have=$(stat -f %z "$DEST")
    [ "$have" = "$CODER_BYTES" ] || fail "$CODER_NAME is $have bytes, expected $CODER_BYTES. Re-run to resume."
    log "Downloaded $CODER_NAME"
  fi
fi

# ---------------------------------------------------------------------------
step "5/7 coder-config.json"
# ---------------------------------------------------------------------------
if [ -n "$CODER_NAME" ]; then
  cat > "$CONFIG" <<JSON
{
  "model": "$CODER_NAME",
  "ctx": $CTX,
  "port": 8080,
  "_written_by": "scripts/mac/setup.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) for $CHIP, ${MEM_GB} GB unified"
}
JSON
  log "Wrote $CONFIG (model $CODER_NAME, ctx $CTX)"
else
  log "No coder model; nothing written. The app runs with Ollama only."
fi

# ---------------------------------------------------------------------------
step "6/7 App dependencies + build"
# ---------------------------------------------------------------------------
if [ "$NO_BUILD" = 1 ]; then
  log "Skipped."
else
  cd "$REPO"
  log "npm install"
  npm install --no-audit --no-fund 2>&1 | tee -a "$LOG" | tail -2
  log "npm run build"
  npm run build 2>&1 | tee -a "$LOG" | tail -3
fi

step "7/7 Shortcuts (~/Applications + Desktop)"
if [ "$NO_SHORTCUTS" = 1 ]; then log "Skipped."; else "$REPO/scripts/mac/install-shortcuts.sh" 2>&1 | tee -a "$LOG"; fi

echo
log "Done. Launch Strata Code from Launchpad / the Desktop shortcut, or:  open \"$REPO/run-strata-code.command\""
log "The app shows the License Agreement (EULA.md) on first launch."
