# Handoff to Claude Code on this MacBook (2026-09-20)

Written by the cloud session that did the macOS port, for the local Claude Code
session that takes over on the Mac. The user is new to macOS.

## State when this was written
- Branch `claude/strata-port-new-macbook-qm6eq7` in `~/strata-code` and `~/strata-photo`
  (PRs open: strata-code #2, strata-photo #1, strata-tune #5).
- On the Mac tonight: Homebrew, node, ollama, llama.cpp installed by `scripts/mac/setup.sh`;
  `qwen3.8:27b` pulled; the Q6_K coder GGUF was mid-download into
  `~/Library/Application Support/Strata/code/models/`. Photo setup may not have run yet.
- The setup scripts were fixed after that run started (downloads now show live progress);
  `git pull` before re-running. Both scripts are idempotent and resume downloads.

## What to do, in order
1. `tail -30 ~/strata-code/setup-mac.log`. Unless it ends with `Done. Launch Strata Code…`,
   run `cd ~/strata-code && git pull && scripts/mac/setup.sh --yes`. Verify: full GGUF
   (Q6_K = 25092535456 bytes) + `coder-config.json` under `~/Library/Application Support/Strata/code/`,
   `Strata Code.app` in `~/Applications`, alias on `~/Desktop`.
2. `cd ~/strata-photo && git pull && scripts/mac/setup.sh --yes`. Verify
   `sidecar/.venv/bin/python -c "import torch, rawpy; print(torch.backends.mps.is_available())"` -> True,
   `dist-electron/main.js` exists, `Strata Photo.app` in `~/Applications`.
3. Smoke-test the sidecar on Metal: `cd ~/strata-photo/sidecar && .venv/bin/python -m strata_sidecar --port 8766 &`
   then `curl -s localhost:8766/health` must show `"accelerator": "mps"`. Kill it after. Fixes go in
   `sidecar/strata_sidecar/device.py`, `paths.py`, `ai/models.py`, `resources.py`, `server.py`.
4. Start overnight training: `cd ~/strata-photo && scripts/mac/train-overnight.sh <photo folder> [...]`
   (ask the user which folders if `~/Pictures` is not obvious). Runs under caffeinate; log in
   `~/Library/Logs/StrataPhoto/train-<date>.log`. Watch the first minutes: the scan must report
   `N/M done … /min`. bf16 trouble on MPS -> re-run with `--no-autocast`.
5. Explain to the user, for a mac beginner: apps are in Launchpad / Desktop / `~/Applications`;
   first open of an unsigned app is right-click -> Open; check the log in the morning with
   `tail -5 ~/Library/Logs/StrataPhoto/train-*.log`; keep the Mac plugged in, lid open.

Commit only to `claude/strata-port-new-macbook-qm6eq7`. Details: `MACOS.md` (Code), `docs/MACOS.md` (Photo).
