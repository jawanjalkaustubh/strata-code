# 🚀 Strata Code & Google Antigravity: Dependencies & User Guide
**Dual-Model Hybrid Architecture & 100% Sovereign Offline AI Studio**  
*Author: Kaustubh Jawanjal • Accelerated by NVIDIA GeForce RTX 5090 (32GB VRAM)*

---

## 🌟 Executive Summary

Strata Code is a professional, autonomous agentic desktop IDE designed to seamlessly operate in two distinct modes:

1. **🛡️ 100% Sovereign Local Mode**:
   - Fully offline with zero telemetry, zero internet calls, and  token cost.
   - Powered locally by **Ollama** and **Qwen** models running 100% on your local GPU.
   - Completely private: your codebase never leaves your machine.

2. **⚡ Dual-Model Hybrid Mode**:
   - **Google Antigravity (Cloud Architect)** analyzes your prompt and formulates a strategic blueprint.
   - **Local RTX 5090 Worker (qwen3.8:27b)** receives the blueprint and executes all workspace inspection, coding, tool calls, and terminal operations locally on your hardware.
   - Preserves **~95% to 100% of your cloud quota** while providing frontier-class architectural guidance.

---

## 📦 System Requirements & Dependencies

### 1. Offline Mode Dependencies (Local Inference)

| Component | Minimum | Recommended | Notes |
| :--- | :--- | :--- | :--- |
| **GPU** | 8 GB VRAM (CUDA) | **NVIDIA RTX 5090 (32GB)** / RTX 4090 (24GB) | Full VRAM offloading for 100% GPU acceleration |
| **Ollama Daemon** | v0.5.0+ | **Latest Ollama for Windows** | Local REST server at http://127.0.0.1:11434 |
| **Primary Model** | qwen2.5-coder:7b | **qwen3.8:27b** or qwen2.5-coder:32b | Native function/tool calling support |
| **Operating System** | Windows 10/11 x64 | **Windows 11 x64** | PowerShell 5.1+ or PowerShell 7+ |
| **Node.js Runtime** | Node.js 18 LTS | **Node.js 20+ LTS** | Used by Electron runtime |
| **Electron Runtime** | Electron 30+ | **Electron 33+** (bundled in 
ode_modules) | Desktop application container |

#### Recommended Local Models & Pull Commands:
`powershell
# Primary Sovereign Model (Recommended for RTX 5090 - 32GB VRAM):
ollama pull qwen3.8:27b

# High-Capability Coding Alternatives:
ollama pull qwen2.5-coder:32b
ollama pull qwen2.5-coder:14b     # Ideal for 12GB - 16GB GPUs
ollama pull qwen2.5-coder:7b      # Ultra-fast / Lightweight (8GB GPUs)
`

---

### 2. Cloud-Based Antigravity & Hybrid Mode Dependencies

| Component | Requirement | Function |
| :--- | :--- | :--- |
| **Google Antigravity** | Installed on workstation | Cloud Architect & pair-programming companion |
| **Google Gemini API** | *Optional* (Free Tier / Keyless supported) | Connects to gemini-3.8-flash or gemini-3.1-pro |
| **Optional Frontier Keys** | Anthropic, OpenAI, DeepSeek, OpenRouter | Optional fallback or cloud provider switching |
| **Python Runtime** | Python 3.8+ (with 
equests optional) | Powers the real-time live bridge daemon |
| **Inference Bridge** | D:\AntiGravity\strata\query-local-worker.ps1 | Connects Antigravity directly to local Ollama on RTX 5090 |
| **Live Dialogue Stream** | D:\AntiGravity\strata\strata-live-session.md | Shared real-time communication log between models |

---

## 🛠️ Step-by-Step Installation & Setup

### Step 1: Install Ollama (If not already installed)
1. Download Ollama from https://ollama.com/download/windows.
2. Run the installer. It will install to %LOCALAPPDATA%\Programs\Ollama and register in your PATH.
3. Open a terminal and verify:
   `powershell
   ollama --version
   `
4. Pull the primary local worker model:
   `powershell
   ollama pull qwen3.8:27b
   `

### Step 2: Install Strata Code Dependencies
Inside the Strata directory:
`powershell
cd D:\AntiGravity\strata
npm install
npm run build
`

---

## 🎮 User Operation Guide

### 1. Launching Strata Code
You have several 1-click launch options located at D:\AntiGravity\strata:

- **Launch-Strata.bat**: 
  - Standard launcher. Checks if Ollama is running (auto-starts it if offline), launches the background live stream watcher, and opens Strata.
- **Launch-Strata.vbs**:
  - Silent launcher. Launches Strata cleanly in the background without any command prompt window.
- **Desktop / Start Menu Shortcut**:
  - Created by Setup-Strata.bat for seamless OS integration.

---

### 2. Switching Between Hybrid and Local Mode
In the top title bar of Strata Code, look for the mode toggle button:

`
[ ⚡ Hybrid | 💻 Local ]
`

- **Click ⚡ Hybrid**:
  - Activates **Dual-Model Collaboration**.
  - Google Antigravity acts as Lead Cloud Architect.
  - Your local RTX 5090 worker (qwen3.8:27b) implements the code and runs all filesystem tools.
  - Token bar displays: ☁️ Cloud: {N} tok • ⚡ Local: {N} tok • 🛡️ +{N} saved (~95-100%).
  - About modal displays: **⚡ Dual-Model Hybrid (Cloud + Local GPU)**.
  - TitleBar selector switches to **Worker: [qwen3.8:27b]**.

- **Click 💻 Local**:
  - Activates **Pure Sovereign Offline Mode**.
  - 100% of reasoning and execution happens on your local GPU.
  - Token bar displays: ⚡ Local Tokens: {N} tok (RTX 5090).
  - About modal displays: **🛡️ 100% Offline / Local**.
  - TitleBar selector switches to **Model: [qwen3.8:27b]**.

---

### 3. Execution Permissions: Auto Mode vs Review Mode
Inside the chat input bar at the bottom right, you will find the permission toggle:

- **⚡ Auto: Read/Write (Autonomous Execution)**:
  - The model has full autonomous authority to inspect, read, edit, and write files, as well as execute terminal commands inside your workspace.
  - Recommended for fast development and comprehensive refactors.
- **🛡️ Review Mode (Confirmation Required)**:
  - Whenever the model wants to edit or write a file, Strata pauses and displays an approval dialog with a visual diff preview.
  - You can **Accept** or **Reject** every action before it touches your disk.

---

### 4. Code Canvas & Workspace Management
- **Split View vs Expand Canvas**: Click the **Split View / Expand Canvas** button in the title bar to toggle between side-by-side editing or full-width Agent Studio.
- **Automatic Word Wrapping & Resize**: The Monaco Editor dynamically wraps code and adapts instantaneously whenever you resize panels or resize the application window. Text never gets cut off.
- **Inline AI Assistant**: Highlight any code in the editor and press **Ctrl+K** to prompt the local AI model to edit or generate code directly in place.
- **Integrated Terminal**: Press **Ctrl+\`** to open the integrated PowerShell console drawer.
- **Save File**: Press **Ctrl+S** from anywhere to save changes.

---

### 5. Seeing the Two Models Talk Live
When operating in **Hybrid Mode**:
1. You can watch the dialogue directly inside the **Strata Chat Panel**.
2. Simultaneously, in the **Google Antigravity App**, you will see:
   - ### 🌟 Google Antigravity (Cloud Architect) ➔ @Local RTX 5090 Worker (qwen3.8:27b)
   - ### 💻 Local RTX 5090 Worker (qwen3.8:27b) ➔ @Google Antigravity Architect
   - ### 🌟 Google Antigravity Architect ➔ @User & @Local Worker
   - ⚡ Local Tokens: {N} tok (100% GPU) • 🛡️ ~99% Cloud Quota Preserved

---

## 💾 Automated Backup & Distribution

### 1-Click Backup
Run D:\AntiGravity\strata\Backup-Strata.bat. It automatically:
1. Synchronizes all modified source files, engine updates, and assets to:
   - Primary: D:\AntiGravity\strata
   - Mirror: C:\AI_dev\projects\strata
2. Packages the entire project into a self-contained portable archive:
   - D:\AntiGravity\strata\release\Strata-Code-Windows-x64.zip
   - C:\AI_dev\projects\strata\Strata-Code-Windows-x64.zip

---

## ❓ Troubleshooting & FAQs

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **Cannot connect to Ollama (127.0.0.1:11434)** | Ollama background service is not running. | Run Launch-Strata.bat or click **Start Ollama** in the top bar. |
| **Model not found** | The selected model is not installed. | Open **Model Manager** in top bar, or run ollama pull qwen3.8:27b in PowerShell. |
| **Ollama API error: 500** | Context history window overrun or missing user prompt. | Already permanently fixed by Strata's pinned sliding-window engine. |
| **Text cut-off on canvas resize** | Editor not adapting to container width. | Fixed! Monaco has wordWrap: 'on' and active ResizeObserver enabled. |
| **CUDA out of memory error** | Model size exceeds available VRAM. | Switch to qwen2.5-coder:14b or reduce context window in Model Settings. |

---

*Enjoy autonomous, high-IQ software engineering with Google Antigravity & Strata Code!*
