# Releasing a build

## Build the zip

From `D:\AntiGravity\strata`:

```powershell
powershell -ExecutionPolicy Bypass -File installer\package.ps1
```

Output: `release\Strata-Code-Windows-x64.zip` (~740 MB) plus a `.sha256` file.
The script builds the app, packages it with Electron, copies the llama.cpp
runtime from `C:\AI_dev\llama.cpp`, adds the installer and licenses, and zips.
Add `-SkipBuild` to reuse an existing build. `release\` is git-ignored.

What the zip contains and does not contain:

| In the zip | Downloaded by the user's `Install.bat` |
|---|---|
| `Strata Code.exe` + Electron runtime (~190 MB) | Ollama (winget or `OllamaSetup.exe`, 1.5 GB) |
| `runtime\llama.cpp\` server + CUDA 12 DLLs (1.1 GB, ~550 MB zipped) | `qwen3.8:27b` into Ollama (18 GB) |
| `Install.bat`, `Install.ps1`, `README.md`, `LICENSES\` | Coder GGUF into `models\` (19–25 GB, chosen by VRAM) |

Models cannot ship in the zip: GitHub caps each release asset at **2 GB** and
the two models are 43 GB. The installer downloads them with resume support.

## Publish on GitHub (first time)

**The repository must be public.** Release downloads in a private repository
are only visible to collaborators, so "free for everyone" needs a public repo.
That makes the source code visible too; `EULA.md` still governs use (free to
use and share unmodified, no selling, no modified redistribution). If you want
the code private, create a second, public repository that holds only the
README and the releases, and push the code to the private one.

1. Create an empty **public** repository on github.com (e.g. `strata-code`,
   no README, no .gitignore).
2. Push the code:

```powershell
cd D:\AntiGravity\strata
git remote add origin https://github.com/<you>/strata-code.git
git push -u origin master
```

   Git will open a browser sign-in the first time.

3. Create the release: repository → **Releases** → **Draft a new release** →
   tag `v1.0.0`, title `Strata Code 1.0.0`. Drag
   `release\Strata-Code-Windows-x64.zip` and the `.sha256` file into the
   assets box, paste the release notes below, **Publish release**.

4. Share the release URL. They download the zip, extract, run
   `Install.bat`, and follow `README.md` (it is inside the zip).

Optional, from the terminal instead of the web UI (installs the GitHub CLI once):

```powershell
winget install GitHub.cli
gh auth login
gh release create v1.0.0 release\Strata-Code-Windows-x64.zip release\Strata-Code-Windows-x64.zip.sha256 --title "Strata Code 1.0.0" --notes-file installer\README.md
```

## Later builds

Bump `version` in `package.json`, commit, run `package.ps1`, then
`gh release create v1.1.0 …` (or the web UI). Testers re-download only
the zip; their models and Ollama stay installed, and `Install.bat` skips them.

### 1.1.0 (2026-09-21)

Tag `v1.1.0` is on `main`; the GitHub release is created with these notes and
the Windows zip attached from the PC:

```powershell
cd D:\AntiGravity\strata
git checkout main; git pull
powershell -ExecutionPolicy Bypass -File installer\package.ps1
gh release upload v1.1.0 release\Strata-Code-Windows-x64.zip release\Strata-Code-Windows-x64.zip.sha256
```

Notes:

> **One model per turn.** The dual-brain (hybrid) mode is gone: the architect
> and the coder never fit on one card together, so the coder plans, edits and
> verifies its own work with two or three fewer generations per turn. Pick the
> coder or the general model in the title bar.
>
> **macOS (Apple Silicon)** from source: `scripts/mac/setup.sh` installs
> Ollama and llama.cpp with Homebrew, downloads the models sized for the
> machine's unified memory, builds the app and puts Strata Code in
> Launchpad and on the Desktop. See `MACOS.md`.
>
> **Also:** the status bar names the GPU the probe found instead of a
> hardcoded RTX 5090; the Windows installer text no longer describes the
> hybrid mode. Windows requirements and install steps are unchanged; an
> existing install just needs the new zip.

## Release notes to paste

> **Requirements:** Windows 10/11 x64, NVIDIA GPU with 22 GB+ VRAM (32 GB
> recommended), driver 528+, 24 GB+ RAM, ~50 GB free disk, ~45 GB download.
>
> **Free.** Strata Code is free to use and share.
>
> **Install:** extract the zip anywhere with 30 GB free, run `Install.bat`,
> wait for the downloads (they resume if interrupted), then launch from the
> Desktop shortcut. SmartScreen: *More info → Run anyway* (unsigned build).
>
> **Try:** `what model is this` · `Inspect the workspace files and suggest code
> improvements` · `Add a function X to file Y and make sure it typechecks`.
>
> **Report:** the prompt, what the chat showed, the status bar state, and the
> last 50 lines of `%APPDATA%\StrataCode-v1\coder-server.log`.

## Known limits

- NVIDIA only; no AMD/Intel/CPU fallback.
- One model resident at a time on a 32 GB card; switching model reloads. A
  24 GB card gets the Q4_K_M coder at 32K context.
- Unsigned executable (SmartScreen warning). Code signing needs a certificate.
- The vision model from the photo project, if present in Ollama, blocks the
  coder until that app releases it or **Free GPU** is clicked.

## Legal: the License Agreement

`EULA.md` at the repo root is the agreement. It is shown twice:

- **Installer** prints it and requires the user to type `I AGREE` before
  anything is installed (`-AcceptAgreement` skips the prompt for automation).
  Acceptance is recorded in `%APPDATA%\StrataCode-v1\agreement.json`, keyed to
  a hash of the text, and a copy `agreement-accepted.json` is left in the
  install folder.
- **App** shows it on first launch if no matching acceptance exists (for
  example if someone runs `Strata Code.exe` without the installer). The user
  must scroll to the end, tick the box, and click Accept; Decline quits. The
  main process refuses to start the agent until then, whatever the UI says.

Changing `EULA.md` changes the hash, so everyone sees the new version once.

**Before distributing widely, have a lawyer look at `EULA.md`.** It is written
in plain language and covers the real risks (the agent edits files and runs
commands, AI output can be wrong, third-party models and installers, no
warranty, liability cap), but it is not legal advice and has not been reviewed
by a lawyer. Two things to decide yourself: the governing-law clause currently
says "the jurisdiction in which the Author resides"; name it explicitly if you
prefer. And add a contact address in section 13 if you want one beyond the
repository.

Put the same text in the release description (or link to `EULA.md` in the
repo) so people see it before downloading.
