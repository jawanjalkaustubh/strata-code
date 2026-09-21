# Strata Code on macOS (Apple Silicon)

Strata Code was built on a Windows workstation with an RTX 5090. This page is
the macOS port: the same app, the same two local models, running on a Mac's
unified memory instead of a discrete GPU. Nothing leaves the machine.

## Requirements

| | Minimum | Recommended |
|---|---|---|
| Mac | Apple Silicon (M1 or later), macOS 14 | M4 Pro/Max, macOS 15 |
| Unified memory | 24 GB (coder at 16K context, general model 8B) | 48 GB+ (Q6_K coder at 64K context + qwen3.8:27b) |
| Disk | ~45 GB free under `$HOME` | SSD with 100 GB free |
| Tools | Homebrew, Node 24 (LTS), Ollama, llama.cpp | installed by `scripts/mac/setup.sh` |

Intel Macs run, on the CPU, at a few tokens per second. Not worth it.

## Install

```bash
git clone https://github.com/jawanjalkaustubh/strata-code.git
cd strata-code
scripts/mac/setup.sh          # add --yes for no prompts
```

The script checks the chip and memory, installs `node@24`, `ollama` and
`llama.cpp` with Homebrew (and Homebrew itself if missing), pulls the general
model into Ollama, downloads the coder GGUF with resume support, writes a
`coder-config.json` sized for this machine, then `npm install` + `npm run build`.
Re-running it is safe: it skips what is done.

Options: `--coder Q6_K|Q4_K_M|none`, `--general <ollama tag>|none`,
`--skip-models`, `--no-build`.

## Run

Setup ends by installing **Strata Code.app** in `~/Applications` (Launchpad,
Spotlight; drag it to the Dock) and an alias on the Desktop — the macOS twin of
`Install-Shortcuts.ps1`. Re-create them any time with
`scripts/mac/install-shortcuts.sh` (`--remove` deletes them). Or double-click
**`run-strata-code.command`** in Finder, or:

```bash
npm start
```

The window appears in a couple of seconds. The coder server (llama-server on
port 8080) starts on the first coding prompt and stops after 20 idle minutes,
exactly as on Windows. The app shows the License Agreement (`EULA.md`) on
first launch.

## What is different on a Mac

- **One memory pool.** The GPU has no VRAM of its own; it wires part of the
  unified memory (about 3/4 of it on 36 GB+ machines, 2/3 below that). The
  status bar therefore shows *unified* memory - what the whole machine has
  free - and the VRAM arbiter uses that figure to decide whether the coder
  still fits beside what Ollama holds. Both 30B-class models resident at once
  needs 64 GB+; below that the app routes around it and says so, as on a
  32 GB card.
- **Model sizing.** `setup.sh` picks:

  | Unified memory | Coder | Context | General model |
  |---|---|---|---|
  | 64 GB+ | Q6_K (25 GB) | 65 536 | qwen3.8:27b |
  | 48-63 GB | Q6_K | 32 768 | qwen3.8:27b |
  | 36-47 GB | Q4_K_M (18.6 GB) | 65 536 | qwen3.8:27b |
  | 32-35 GB | Q4_K_M | 32 768 | qwen3.8:27b |
  | 24-31 GB | Q4_K_M | 16 384 | qwen3:8b (raise the wired limit, see below) |
  | under 24 GB | none | - | qwen3:8b |

  Edit `~/Library/Application Support/Strata/code/coder-config.json` to change
  the model file, context or extra llama-server arguments.
- **Shell.** The terminal drawer and the agent's `run_command` tool use your
  login shell (zsh) instead of PowerShell. Verification commands use
  `python3`.
- **PATH.** A Finder launch does not have Homebrew on `PATH`; the app merges
  the login shell's `PATH` at startup so `ollama`, `llama-server`, `node`
  and `npm` resolve. If a tool is still "not found", check that
  `brew shellenv` is in `~/.zprofile`.
- **Presence files** (the one-Ollama-per-machine etiquette shared with Strata
  Photo, Video and Tune) live in `~/Library/Application Support/Strata/presence/`.

## Where things live

| What | Where |
|---|---|
| Coder model (GGUF) | `~/Library/Application Support/Strata/code/models/` |
| Coder config | `~/Library/Application Support/Strata/code/coder-config.json` |
| llama-server | `/opt/homebrew/bin/llama-server` (Homebrew) |
| General model | Ollama's store (`~/.ollama`) |
| App settings, agreement, coder-server.log | `~/Library/Application Support/StrataCode-v1/` |
| Presence files | `~/Library/Application Support/Strata/presence/` |

Environment overrides: `STRATA_DATA_DIR`, `STRATA_MODELS_DIR`,
`STRATA_RUNTIME_DIR`, `STRATA_CODER_CONFIG`.

## Troubleshooting

- **"Electron failed to install correctly"** on launch, or
  `node_modules/electron/dist` holding only `LICENSES.chromium.html`: the
  dependencies were installed with Node 26 (Homebrew's plain `node`), where
  Electron's unpacker stops silently after the first file. Setup installs and
  links `node@24`; if you installed Node yourself, run
  `brew install node@24 && brew link --overwrite node@24`, then
  `node node_modules/electron/install.js` in the repo.
- **"llama-server not found"** in the status bar: `brew install llama.cpp`,
  then relaunch from `run-strata-code.command` (it fixes `PATH`).
- **The coder exits while loading** on a 24-32 GB Mac: the GPU wired limit
  is too low for the model. Raise it until reboot with
  `sudo sysctl iogpu.wired_limit_mb=$((RAM_MB - 4096))`, or use a smaller
  context (`"ctx": 16384` in coder-config.json).
- **Slow generation with both models loaded**: expected when memory spills;
  let the app unload the other model (it asks) or click **Free GPU**.
- **Ollama not answering**: `ollama serve` in a terminal, or open Ollama.app.
  The app auto-starts `ollama serve` when it finds the binary.
- Logs: `~/Library/Application Support/StrataCode-v1/coder-server.log`.

## Packaging a .app

```bash
scripts/mac/package.sh          # release/Strata-Code-macOS-arm64.zip
```

Unsigned build: first launch is right-click > Open. Models and llama-server
are not bundled; the user runs `scripts/mac/setup.sh` (or installs
`llama.cpp` and drops a GGUF in the models folder).
