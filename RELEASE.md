# Releasing a tester build

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

| In the zip | Downloaded by the tester's `Install.bat` |
|---|---|
| `Strata Code.exe` + Electron runtime (~190 MB) | Ollama (winget or `OllamaSetup.exe`, 1.5 GB) |
| `runtime\llama.cpp\` server + CUDA 12 DLLs (1.1 GB, ~550 MB zipped) | `qwen3.8:27b` into Ollama (18 GB) |
| `Install.bat`, `Install.ps1`, `README.md`, `LICENSES\` | Coder GGUF into `models\` (19–25 GB, chosen by VRAM) |

Models cannot ship in the zip: GitHub caps each release asset at **2 GB** and
the two models are 43 GB. The installer downloads them with resume support.

## Publish on GitHub (first time)

1. Create an empty repository on github.com (e.g. `strata-code`, private or
   public, no README, no .gitignore).
2. Push the code:

```powershell
cd D:\AntiGravity\strata
git remote add origin https://github.com/<you>/strata-code.git
git push -u origin master
```

   Git will open a browser sign-in the first time.

3. Create the release: repository → **Releases** → **Draft a new release** →
   tag `v1.0.0-test1`, title `Strata Code tester build 1`. Drag
   `release\Strata-Code-Windows-x64.zip` and the `.sha256` file into the
   assets box, paste the tester notes below, **Publish release**.

4. Send testers the release URL. They download the zip, extract, run
   `Install.bat`, and follow `README.md` (it is inside the zip).

Optional, from the terminal instead of the web UI (installs the GitHub CLI once):

```powershell
winget install GitHub.cli
gh auth login
gh release create v1.0.0-test1 release\Strata-Code-Windows-x64.zip release\Strata-Code-Windows-x64.zip.sha256 --title "Strata Code tester build 1" --notes-file installer\README.md
```

## Later builds

Bump `version` in `package.json`, commit, run `package.ps1`, then
`gh release create v1.0.1-test2 …` (or the web UI). Testers re-download only
the zip; their models and Ollama stay installed, and `Install.bat` skips them.

## Tester notes to paste into the release

> **Requirements:** Windows 10/11 x64, NVIDIA GPU with 22 GB+ VRAM (32 GB
> recommended), driver 528+, 24 GB+ RAM, ~50 GB free disk, ~45 GB download.
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

## Known limits of this build

- NVIDIA only; no AMD/Intel/CPU fallback.
- One model resident at a time on a 32 GB card; the app routes around it and
  says so. A 24 GB card gets the Q4_K_M coder at 32K context.
- Unsigned executable (SmartScreen warning). Code signing needs a certificate.
- The vision model from the photo project, if present in Ollama, blocks the
  coder until **Free GPU** is clicked.
