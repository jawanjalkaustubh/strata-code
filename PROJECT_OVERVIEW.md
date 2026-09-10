# Strata Code — AI & Developer System Guide

Welcome to **Strata Code**! This document provides an exhaustive, model-friendly system breakdown designed so that any AI model (Antigravity, Cursor, Claude, GPT, Qwen) or engineer opening this directory can instantly understand the entire codebase, its architecture, file layout, and operational flows.

---

## 🧭 Executive Summary
- **App Name**: Strata Code
- **Description**: Best-in-Class Autonomous Local AI Desktop IDE
- **Core Inspiration**: Combines the precision editing of **Cursor**, the multi-turn agent planning of **Google Antigravity**, and the live transparency of **Claude Code CLI**.
- **Privacy & Hosting**: 100% Offline & Local by default (zero telemetry, zero required cloud dependencies).
- **Inference Runtime**: Powered by **Ollama** (`http://127.0.0.1:11434`), optimized for `qwen2.5-coder:32b`, `llama3.3:70b`, `deepseek-coder-v2:16b`, with native cloud fallbacks for Anthropic Claude (3.7 / 3.5), DeepSeek, and OpenRouter.
- **Creator**: **Kaustubh Jawanjal**
- **Primary Root Directory**: `D:\AntiGravity\strata`
- **Setup Launcher**: `D:\AntiGravity\Setup-Strata.bat`
- **Distributable Archive**: `D:\AntiGravity\Strata-Code-Windows-x64.zip` (159 MB)
- **Backup Archive Mirror**: `C:\AI_dev\projects\strata`

---

## 🗂️ Complete Directory & File Manifest

```
D:\AntiGravity/
├── Setup-Strata.bat                # 1-Click GUI launcher & environment setup wrapper
├── Setup-Strata.ps1                # Windows Forms setup wizard (disclaimer, browse, Ollama & Qwen)
├── Create-Distribution-Zip.ps1     # Automates packaging Strata Code into a shareable ZIP
├── Strata-Code-Windows-x64.zip     # 159 MB standalone distributable package
│
└── strata/
    ├── dist/                       # Production-compiled React frontend (Vite)
    │   ├── assets/                 # Bundled JS, CSS, and hashed assets
    │   └── index.html              # Production HTML entry point with embedded splash
    │
    ├── dist-electron/              # Production-compiled Electron processes
    │   ├── main.js                 # Compiled Electron main process
    │   ├── preload.cjs             # Context bridge exposing window.api to renderer
    │   └── preload.js              # ES Module preload build
    │
    ├── electron/                   # Electron Backend Source (Node.js + TypeScript)
    │   ├── agent.ts                # Multi-provider agent engine (Ollama, Claude, DeepSeek, OpenRouter)
    │   ├── main.ts                 # Application lifecycle, hardware detector, provider IPC
    │   ├── preload.cjs             # ContextBridge definitions for window.api
    │   ├── preload.ts              # Preload TypeScript source declarations
    │   └── tools.ts                # Workspace tools (read_file, write_file, edit_file, list, terminal)
    │
    ├── src/                        # React 18 UI Source (TypeScript + Tailwind CSS)
    │   ├── assets/                 # Branding assets & inlined constants
    │   │   ├── logo.ts             # STRATA_ICON base64 data URI (guarantees 0ms render)
    │   │   ├── strata-icon.png     # Clean isometric layered "S" logo mark
    │   │   ├── strata.ico          # Windows multi-size desktop/taskbar icon
    │   │   └── strata-loading.png  # High-resolution splash icon
    │   │
    │   ├── components/             # Modular React UI Components
    │   │   ├── AboutModal.tsx      # About modal with hardware specs & creator attribution
    │   │   ├── ChatPanel.tsx       # Agent Studio, relocated New Chat, Claude Code live status ticker
    │   │   ├── ClaudeCodeInspector.tsx # Ctrl+O Inspector: live thoughts, execution timeline, tool logs
    │   │   ├── CodeEditor.tsx      # Monaco Editor: multi-tab, DiffEditor, Ctrl+K Inline AI
    │   │   ├── FileTree.tsx        # Workspace file tree explorer with drag resize
    │   │   ├── ModelManagerModal.tsx # In-app Ollama model library & Cloud Quota Fallback settings
    │   │   ├── TerminalDrawer.tsx  # Integrated interactive PowerShell terminal console
    │   │   └── TitleBar.tsx        # Frameless title bar, dynamic GPU badge, split view toggle
    │   │
    │   ├── App.tsx                 # Top-level state coordinator, global hotkeys, layout resizers
    │   ├── index.css               # Tailwind styles and studio animation keyframes
    │   ├── main.tsx                # React root renderer
    │   └── types.ts                # Unified TypeScript definitions (ProviderConfig, LiveActivityItem, etc.)
    │
    ├── assets/                     # Standalone binary icon assets
    ├── public/                     # Vite static public folder
    │
    ├── ARCHITECTURE.md             # In-depth architectural & system engineering document
    ├── README.md                   # High-level overview & comparative benchmark matrix
    ├── PROJECT_OVERVIEW.md         # This quick-start guide for AI models and developers
    │
    ├── index.html                  # Main HTML template with embedded base64 splash preloader
    ├── package.json                # Project metadata ("strata-code"), scripts & dependencies
    ├── package-lock.json           # Deterministic dependency lockfile
    ├── postcss.config.js           # PostCSS plugin configurations
    ├── tailwind.config.js          # Studio theme color definitions & animation timings
    ├── tsconfig.json               # TypeScript compiler options
    ├── vite.config.ts              # Vite + Electron bundler configuration (base: './')
    │
    ├── run-strata-code.bat         # Standalone Windows batch launcher (runs electron.exe directly)
    └── run-strata-code.vbs         # Portable silent background launcher (no flashing CMD window)
```

---

## ⚡ Key Architectural Features & Where to Find Them

### 1. Relocated "New Chat" Button
- **Source**: [`src/components/ChatPanel.tsx`](file:///D:/AntiGravity/strata/src/components/ChatPanel.tsx)
- **Design**: Positioned directly to the left of the input textarea for rapid 1-click context resets.

### 2. Claude Code CLI Live Activity Ticker ("In Short")
- **Source**: [`src/components/ChatPanel.tsx`](file:///D:/AntiGravity/strata/src/components/ChatPanel.tsx)
- **How It Works**: Sits right above the chat box with an animated cyan pulsing dot, displaying real-time concise summaries of what the agent is currently doing (`● Thinking...`, `● Reading file.ts`, `● Editing main.ts`, `● Running terminal command`).

### 3. Claude Code Live Inspector (<kbd>Ctrl</kbd>+<kbd>O</kbd>)
- **Source**: [`src/components/ClaudeCodeInspector.tsx`](file:///D:/AntiGravity/strata/src/components/ClaudeCodeInspector.tsx)
- **How It Works**: Pressing <kbd>Ctrl</kbd>+<kbd>O</kbd> slides open an observation drawer with 4 views:
  - **Execution Timeline**: Step-by-step progress with tool names, parameters, execution latencies, and diffs.
  - **Model Thoughts (Chain-of-Thought)**: Monospace viewer for live streamed thought tokens (`<think>` blocks).
  - **Tool Calls & Diffs**: Deep inspection of exact arguments and formatted outputs.
  - **Raw Transcript**: 1-click JSON export.

### 4. Multi-Model Provider & Quota Protection Engine
- **Source**: [`electron/agent.ts`](file:///D:/AntiGravity/strata/electron/agent.ts) & [`src/components/ModelManagerModal.tsx`](file:///D:/AntiGravity/strata/src/components/ModelManagerModal.tsx)
- **Supported Engines**:
  - **Local Ollama**: 100% Free, unlimited tokens with Qwen 2.5 Coder 32B / 14B / 7B.
  - **Anthropic Claude API**: Claude 3.7 Sonnet (with live thinking tokens), Claude 3.5 Sonnet, Claude 3.5 Haiku.
  - **DeepSeek API**: DeepSeek Coder, DeepSeek V3, DeepSeek Reasoner (R1).
  - **OpenRouter API**: Access to 100+ models with flexible prepaid tokens.
- **Automatic Quota Fallback**: If a cloud provider returns HTTP 429 (Rate Limit / Quota Exceeded), Strata Code automatically falls back to your local Ollama model (`qwen2.5-coder:32b`) so work never stops.

### 5. 1-Click Distributable Setup Wizard
- **Source**: [`Setup-Strata.bat`](file:///D:/AntiGravity/Setup-Strata.bat) & [`Setup-Strata.ps1`](file:///D:/AntiGravity/Setup-Strata.ps1)
- **How It Works**: Contains the liability waiver naming author Kaustubh Jawanjal, an intuitive **Browse...** button for destination selection, automatic Ollama detection and silent installation, and automated Qwen model download.

### 6. Autonomous Ollama Daemon & Health Management (Zero PC Reboot Dependency)
- **Source**: [`electron/main.ts`](file:///D:/AntiGravity/strata/electron/main.ts), [`src/App.tsx`](file:///D:/AntiGravity/strata/src/App.tsx), [`src/components/TitleBar.tsx`](file:///D:/AntiGravity/strata/src/components/TitleBar.tsx), and [`src/components/ModelManagerModal.tsx`](file:///D:/AntiGravity/strata/src/components/ModelManagerModal.tsx)
- **How It Works**:
  - Automatically identifies local `ollama.exe` paths across standard Windows installation directories.
  - Implements a rapid non-blocking health check ping (`http://127.0.0.1:11434/api/version`) with a 2.5-second timeout on application launch.
  - If Ollama is offline or unresponsive, provides 1-click **"Start Ollama"** and **"Restart Daemon"** controls right inside the TitleBar and Model Manager Modal.
  - Running "Restart Daemon" forcefully terminates any zombie or deadlocked `ollama.exe` instances, waits for Windows port 11434 to be released, and launches a fresh daemon. The user never needs to reboot their PC.
  - Features an intelligent heartbeat loop (every 3.5s when offline, every 12s when online) that auto-recovers and re-syncs the model catalog when the service comes back online.
  - Preserves download error state and surfaces actionable error messages with a 1-click **Retry Download** button.

