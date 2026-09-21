# Strata Code

A free, local, offline AI coding studio for Windows (and, from source, Apple
Silicon Macs - see `MACOS.md` in the repository). Two local models to choose
from, one per turn: a **coder** (Qwen3-Coder-30B-A3B, served by a bundled
llama.cpp) that reads, edits and verifies code, and a **general** model
(Qwen 3.8 27B via Ollama) for everything else. Nothing leaves your machine.
No accounts, no keys.

## Requirements

| | Minimum | Recommended |
|---|---|---|
| OS | Windows 10/11, 64-bit | Windows 11 |
| GPU | NVIDIA, 22 GB VRAM (RTX 3090/4090) | 32 GB (RTX 5090) |
| Driver | 528+ (CUDA 12) | current |
| RAM | 24 GB | 32 GB+ |
| Disk | 30 GB where you extract + 20 GB on your user drive | SSD |
| Network | ~45 GB of downloads, once | |

Not supported by this build: AMD/Intel GPUs, Linux. macOS (Apple Silicon) is a source install: see `MACOS.md` in the repository.

## Agreement

This is software that **edits files and runs commands** in
the folders you open, using AI models that can be wrong. Use it only on folders
you control and have backed up. The installer shows the License Agreement
(`EULA.md`) and asks you to type `I AGREE`; the app asks again on
first launch if it has no record of your acceptance. If you do not agree, do
not install it.

## Install

1. Extract the zip anywhere with 30 GB free (avoid `Program Files`). Do not
   rename the folder while the app is running.
2. Double-click **`Install.bat`**. It will:
   - check your GPU, driver, RAM and disk;
   - install Ollama if you don't have it (winget, else the official installer);
   - pull `qwen3.8:27b` into Ollama (~18 GB);
   - download the coder model into `models\` (~25 GB for 28 GB+ VRAM,
     ~19 GB otherwise) with resume support;
   - write `runtime\coder-config.json` with a context size that fits your VRAM;
   - create Desktop and Start Menu shortcuts and launch the app.
3. If Windows SmartScreen appears for `Strata Code.exe`, choose
   *More info → Run anyway*. The app is unsigned.

Re-running `Install.bat` is safe: it skips what is already done and resumes
partial downloads.

## First run

- The window appears in ~2 s. The status bar (bottom) shows the coder server
  loading its model; on a fast SSD this takes 10–60 s the first time.
- Pick a workspace folder with **Open Workspace** in the title bar. The agent
  can only read and write inside that folder.
- Try, in order:
  1. `what model is this` → answered instantly by the engine
  2. `Inspect the workspace files and suggest code improvements` → analysis
     in chat, no files touched
  3. `Add a function X to file Y and make sure it typechecks` → edits, then
     the project's own verification run (typecheck / build) before it stops

## What to look at

- **Status bar**: coder up/loading/blocked, VRAM used/free, what Ollama
  holds. If another app has a model in Ollama, the coder shows **blocked**
  with a **Free GPU** button.
- **Model picker** in the title bar: the coder for code, the general model
  for questions and prose. One model runs per turn; both cannot be resident
  at once on a 32 GB card, so switching reloads (the status bar shows it).
- **Auto vs Review** mode next to the prompt box. Review asks before every
  file change.

## Logs and where things live

| What | Where |
|---|---|
| Coder server output | `%APPDATA%\StrataCode-v1\coder-server.log` |
| App settings | `%APPDATA%\StrataCode-v1\provider-config.json` |
| Install log | `install.log` next to `Install.bat` |
| Coder model | `models\` next to the app |
| General model | Ollama's store (`%USERPROFILE%\.ollama`) |

## Reporting problems

Open an issue with: the prompt you sent, what the chat showed, the status bar
state, and the last 50 lines of `coder-server.log`. Screenshots help.

## Uninstall

Close the app, delete the extracted folder and `%APPDATA%\StrataCode-v1`.
Remove the Ollama model with `ollama rm qwen3.8:27b` and uninstall Ollama
from *Settings → Apps* if you don't want it.

## Licenses

Strata Code is © Kaustubh Jawanjal and is free to use under `EULA.md`. Bundled: llama.cpp (MIT), NVIDIA CUDA
runtime libraries (NVIDIA CUDA Toolkit EULA, redistributable), Electron and
Chromium (BSD/MIT). Downloaded at install time, not bundled: Ollama, and the
Qwen models (Apache-2.0). See `LICENSES\`.
