# Strata Code - Architecture & System Documentation

> **Strata Code** is a best-in-class, standalone desktop AI Coding IDE inspired by Cursor, Google Antigravity, and Claude Code CLI, tailored specifically for local Ollama LLMs and hardware-accelerated with dynamic multi-tier GPU detection (NVIDIA GeForce RTX 5090 / 40-series / AMD Radeon / Intel Arc), plus native cloud fallbacks (Anthropic Claude 3.7 / 3.5, DeepSeek, OpenRouter).
>
> **Creator & Developer:** Built by **Kaustubh Jawanjal**  
> **Primary Working Directory:** `D:\AntiGravity\strata`  
> **Setup Launcher:** `D:\AntiGravity\Setup-Strata.bat`  
> **Distributable Archive:** `D:\AntiGravity\Strata-Code-Windows-x64.zip` (159 MB)  
> **Backup & Archive Path:** `C:\AI_dev\projects\strata`  
> **Active Default Model:** `qwen2.5-coder:32b` via Ollama (`http://127.0.0.1:11434`)

---

## 1. Brand Identity & The Name: "Strata Code"

The name **Strata Code** represents:
1. **Layers of Deep Intelligence**: In geology, *strata* are rich, sedimentary layers formed over time. In Strata Code, it reflects the architectural layers of modern autonomous AI: from the silicon hardware layer (GPU VRAM offloading) and Ollama inference runtime up to autonomous agent planning, Monaco diff execution, and interactive terminal control.
2. **Visual Emblem**: The custom 3D isometric layered mark showcases ascending tiers of deep cobalt, cyan, and vivid teal, signifying clarity, speed, and precision.
3. **True Local Sovereignty with Cloud Flexibility**: While prioritizing 100% offline local privacy with zero telemetry, Strata Code provides seamless cloud API fallbacks so that developers never hit a wall when tokens or quotas are constrained.

---

## 2. Directory Structure

```
D:\AntiGravity/
├── Setup-Strata.bat            # 1-Click GUI launcher & environment setup wrapper
├── Setup-Strata.ps1            # Windows Forms setup wizard (disclaimer, browse, Ollama & Qwen)
├── Create-Distribution-Zip.ps1 # Automates packaging Strata Code into a shareable ZIP
├── Strata-Code-Windows-x64.zip # 159 MB standalone distributable package
│
└── strata/
    ├── dist/                   # Vite compiled production frontend
    │   ├── assets/             # Minified JavaScript & Tailwind CSS bundles
    │   └── index.html          # Production entry point with inlined preloader
    ├── dist-electron/          # Compiled Electron main process & preload
    │   ├── main.js             # Bundled Electron main process
    │   ├── preload.cjs         # CommonJS context bridge for Electron
    │   └── preload.js          # ES Module preload artifact
    ├── electron/               # Electron Main Process Source (TypeScript)
    │   ├── agent.ts            # Multi-provider agent engine (Ollama, Claude, DeepSeek, OpenRouter)
    │   ├── main.ts             # App lifecycle, dynamic hardware detector, provider IPC & shields
    │   ├── preload.cjs         # ContextBridge exposing window.api to React
    │   ├── preload.ts          # TypeScript source for preload definitions
    │   └── tools.ts            # 5 workspace tools with CRLF normalization & safe execution
    ├── src/                    # React 18 Frontend Source (TypeScript + Tailwind)
    │   ├── assets/             # High-res logos & inlined base64 constants
    │   │   ├── logo.ts         # STRATA_ICON inlined base64 data URI (guarantees 0ms render)
    │   │   └── strata-icon.png # Original high-res isometric mark
    │   ├── components/         # UI Components
    │   │   ├── AboutModal.tsx  # Creator modal ("Built by Kaustubh Jawanjal", dynamic GPU specs)
    │   │   ├── ChatPanel.tsx   # Agent Studio: relocated New Chat, Claude Code live status ticker
    │   │   ├── ClaudeCodeInspector.tsx # Ctrl+O Inspector: live thoughts, execution timeline, tool logs
    │   │   ├── CodeEditor.tsx  # Monaco Editor: multi-tab, DiffEditor, Ctrl+K Inline AI
    │   │   ├── FileTree.tsx    # Workspace explorer with resizable width
    │   │   ├── ModelManagerModal.tsx # In-app Ollama library & Cloud Quota Fallbacks
    │   │   ├── TerminalDrawer.tsx # Integrated interactive PowerShell terminal console
    │   │   └── TitleBar.tsx    # Custom frameless title bar, dynamic GPU badge, split view toggle
    │   ├── App.tsx             # Application state, global shortcuts, split drag resizers
    │   ├── index.css           # Tailwind CSS directives & custom keyframe animations
    │   ├── main.tsx            # React DOM entry point
    │   └── types.ts            # Shared TypeScript interfaces (ProviderConfig, LiveActivityItem, etc.)
    ├── index.html              # Development HTML template with hardware splash preloader
    ├── package.json            # Node dependencies, scripts & metadata ("strata-code")
    ├── package-lock.json       # Dependency lockfile
    ├── postcss.config.js       # PostCSS configuration for Tailwind
    ├── run-strata-code.bat     # Batch launcher script (runs electron.exe directly)
    ├── run-strata-code.vbs     # Silent background VBScript launcher (0 CMD windows)
    └── tailwind.config.js      # Custom studio color palette & animation keyframes
```

---

## 3. Best-in-Class Feature Implementations

### 3.1 Claude Code CLI Live Status ("In Short") & Inspector (<kbd>Ctrl</kbd>+<kbd>O</kbd>)
- **Real-Time Activity Ticker**: Sits directly above the chat box with an animated pulsing indicator showing concise live statuses:
  - `● Thinking (1.2s)...`
  - `● Reading src/components/ChatPanel.tsx`
  - `● Writing src/types.ts`
  - `● Editing electron/agent.ts`
  - `● Running: npm test`
  - `● Searching: "fetchModels"`
- **Live Inspector Drawer (<kbd>Ctrl</kbd>+<kbd>O</kbd>)**: Pressing <kbd>Ctrl</kbd>+<kbd>O</kbd> slides open an inspection drawer:
  1. **Execution Timeline**: Complete step-by-step audit of the current turn with latencies, tool parameters, and status indicators.
  2. **Model Thoughts (Chain-of-Thought)**: Streams live `<think>` tokens from Qwen, Claude 3.7 Sonnet, or DeepSeek R1 before file changes occur.
  3. **Tool Invocations & Diffs**: In-depth inspection of tool calls with syntax-highlighted diffs and raw command outputs.
  4. **Raw Transcript**: 1-click JSON export.

### 3.2 Relocated "New Chat" Button
- **Placement**: Clean square icon button positioned directly to the **left of the chat input textarea**.
- **Action**: Resets agent context and conversation history with a single click.

### 3.3 Multi-Model Provider & Quota Protection Engine
- **Local Ollama (Default)**: 100% Free, unlimited tokens, zero quota limits powered by your local GPU (`qwen2.5-coder:32b`, `llama3.3:70b`, `deepseek-coder-v2`).
- **Cloud Fallbacks**:
  - **Anthropic Claude API**: `claude-3-7-sonnet` (with live thinking tokens), `claude-3-5-sonnet`, `claude-3-5-haiku`
  - **DeepSeek API**: `deepseek-coder`, `deepseek-chat`, `deepseek-reasoner` (R1)
  - **OpenRouter API**: Unified gateway to 100+ models with prepaid tokens
- **Automatic Quota Fallback**: If a cloud provider returns HTTP 429 (Rate Limit / Quota Exceeded), Strata Code automatically falls back to your local Ollama model (`qwen2.5-coder:32b`) so work continues without interruption.

### 3.4 1-Click Distributable Setup Wizard
- **Automated Environment**: Packaged into `Strata-Code-Windows-x64.zip` (159 MB).
- **Features**:
  - Prominent liability waiver naming author Kaustubh Jawanjal with required acceptance.
  - Native Windows **Browse...** folder picker for custom installation paths.
  - Automatic Ollama installer download and background service initialization.
  - Hardware-aware model selection defaulting to `qwen2.5-coder:32b` on 24GB+ VRAM systems.
  - Desktop & Start Menu shortcut generation (`assets/strata.ico`).

### 3.5 Dynamic Hardware Generalization Layer
- Automatically probes hardware via `nvidia-smi` (NVIDIA GPUs, total VRAM), falling back to Windows WMI/CIM queries (`Win32_VideoController`, `Win32_Processor`).
- Injects detected hardware specs into agent system prompts, UI titlebar chips, and model recommendations.

### 3.6 Context Tagging (`@file`) with Zero-Latency Ingestion
- Typing `@` opens an in-memory workspace file search modal directly above the cursor.
- Mentions of `@filename` are intercepted in `electron/agent.ts` before the first turn, eliminating full roundtrip delays.

### 3.7 Native Side-by-Side Monaco Diff Viewer
- Embeds Monaco's diff comparison engine (`<DiffEditor />`) inside the central editor space.
- 1-click **"View Side-by-Side Diff"** in chat cards with **Accept Changes** and **Revert** actions.

### 3.8 Inline AI (<kbd>Ctrl</kbd>+<kbd>K</kbd>) Command Bar
- Select code in Monaco and press <kbd>Ctrl</kbd>+<kbd>K</kbd> to open a floating instruction bar.
- Replaces the selection directly without cluttering the chat history.

### 3.9 Integrated Interactive PowerShell Terminal Drawer
- Toggle via <kbd>Ctrl</kbd>+<kbd>`</kbd> to open a docked console panel with full command history and exit code tracking.

### 3.10 Autonomous Ollama Daemon & Health Management Layer (Zero PC Reboot Dependency)
- **Problem Solved**: If Ollama daemon deadlocks, crashes, or is delayed during Windows boot, desktop apps typically fail with silent promise hangs or blank model lists, forcing the user to restart their entire PC.
- **Automated Process Manager (`OllamaProcessManager`)**:
  - Automatically discovers `ollama.exe` across AppData, Program Files, or Windows PATH.
  - Implements rapid health check via `http://127.0.0.1:11434/api/version` with a strict 2.5-second timeout.
  - Auto-launches detached `ollama serve` in the background if Ollama is not running on app startup.
  - Provides a 1-click **"Start Ollama"** and **"Restart Daemon"** button in both the TitleBar and Model Manager Modal.
  - **Forceful Zombie Process Purge**: Restart terminates any hung instances via `taskkill /F /IM ollama.exe /T`, waits 1.2s for Windows port 11434 release, and restarts a fresh service. The user **never needs to reboot their PC**.
- **Heartbeat & Reactive Auto-Recovery**:
  - `src/App.tsx` runs an intelligent heartbeat loop (every 3.5s when offline, every 12s when online).
  - When transitioning from offline to online, installed models and details are automatically refreshed without requiring manual user intervention.
- **Persistent Error Transparency on Model Downloads**:
  - All download failures and exceptions in `ollama:pull-model` are preserved in state and displayed with full diagnostic logs, a 1-click **Retry Download** button, and dismiss options.

---

## 4. System Stability & Crash Prevention Safeguards

1. **Strict HTTP Timeouts on Native Node/Electron `fetch`**:
   - Every fetch to `127.0.0.1:11434` is wrapped in `AbortSignal.timeout(...)` (2.5s for health, 3s for tags/details, 45s for inline completion), eliminating indefinite network hangs.
2. **Safe IPC Transmission Guard**:
   - In `electron/agent.ts`, all message dispatches utilize a guarded `send()` method that validates `!this.sender.isDestroyed()`.
3. **Line-by-Line & Whitespace-Tolerant Tool Editing**:
   - `ToolExecutor.editFile` performs CRLF/LF normalization and features a whitespace-tolerant fallback algorithm if leading/trailing indentation differs slightly across LLM outputs.
4. **UTF-8 PowerShell Output Guarantee**:
   - Terminal and tool execution forces UTF-8 encoding (`[Console]::OutputEncoding = UTF8`), preventing encoding corruptions on Windows.
5. **Window Teardown Management**:
   - `mainWindow.on('closed')` resets `agent.setSender(null)` immediately.
   - `app.on('before-quit')` wraps `agent.stop()` in a safe `try/catch` block.
6. **Global Exception Shield**:
   - `process.on('uncaughtException')` catches and filters asynchronous teardown race conditions in Chromium/Electron.
7. **Embedded Base64 Asset Guarantee**:
   - The isometric Strata logo is encoded as a base64 data URI in `src/assets/logo.ts` and `index.html`.
8. **Real-Time Token Streaming & Dynamic Context Optimization**:
   - `callOllama` streams tokens in real time directly to `agent:token` (<100ms Time to First Token).
   - Computes dynamic `num_ctx` (8192, 16384, 32768) based on message length instead of fixed 32K KV cache allocation, preventing GPU VRAM exhaustion and PCIe RAM spilling.
   - Decouples tool schemas from general conversation mode, eliminating tool grammar parsing overhead.

---

## 5. Development & Execution Instructions

### Running in Development:
```powershell
cd D:\AntiGravity\strata
npm run dev
```

### Building for Production:
```powershell
npm run build
```

### Launching Strata Code:
- **Option A (Desktop Shortcut)**: Double-click **`Strata Code`** on the Desktop.
- **Option B (Silent VBS Launcher)**: Run `wscript.exe run-strata-code.vbs` (starts invisibly with 0 command prompt windows).
- **Option C (Batch Launcher)**: Run `run-strata-code.bat` (launches `node_modules/electron/dist/electron.exe` standalone).

---

*Document updated on 2026-09-05 for Kaustubh Jawanjal's Strata Code project.*
