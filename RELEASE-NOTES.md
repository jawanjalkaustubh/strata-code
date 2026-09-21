**Requirements:** Windows 10/11 x64, NVIDIA GPU with 22 GB+ VRAM (32 GB recommended), driver 528+, 24 GB+ RAM, ~50 GB free disk, ~45 GB of downloads. Free to use and share.

**Install:** extract the zip anywhere with 30 GB free, run `Install.bat`, wait for the model downloads (they resume if interrupted), then launch from the Desktop shortcut. SmartScreen: *More info → Run anyway* (unsigned build). Upgrading from 1.0.0: extract the new zip; your models and Ollama stay as they are and `Install.bat` skips them.

## What's new in 1.1.0

**One model per turn.** The dual-brain (hybrid) mode is gone. The architect and the coder never fit on one card together — 17 GB beside 23 GB on a 32 GB card — so the engine was rerouting the architect to whatever was already resident and paying two or three extra generations per turn for it. Now you pick the coder or the general model in the title bar, and the coder plans, edits and verifies its own work. The activity strip shows one line: what the run is doing, and on which model.

**Runs on Apple Silicon**, from source. `scripts/mac/setup.sh` installs Ollama and llama.cpp with Homebrew, downloads the models sized for the Mac's unified memory, builds the app, and puts Strata Code in Launchpad and on the Desktop. The VRAM arbiter reads unified memory, the terminal and the agent's `run_command` use zsh, and the coder server runs on Metal. See `MACOS.md`.

**Also:** the status bar and the agent's prompts name the GPU actually detected instead of a hardcoded RTX 5090; the installer text no longer describes the hybrid mode.

**Try:** `what model is this` · `Inspect the workspace files and suggest code improvements` · `Add a function X to file Y and make sure it typechecks`.

**Known limits:** NVIDIA only on Windows (no AMD/Intel/CPU fallback); one model resident at a time on a 32 GB card, so switching reloads; a 24 GB card gets the Q4_K_M coder at 32K context; the executable is unsigned. A vision model left loaded in Ollama by another app blocks the coder until it is released or **Free GPU** is clicked.

**Reporting problems:** the prompt you sent, what the chat showed, the status bar state, and the last 50 lines of `%APPDATA%\StrataCode-v1\coder-server.log`.

Use is governed by [`EULA.md`](EULA.md). SHA-256 of the zip is in the `.sha256` file beside it.
