# Strata Code - Autonomous Local AI Desktop Studio

> **Best-in-Class Autonomous AI Coding IDE** combining the precision of **Cursor**, the planning of **Google Antigravity**, and the agentic transparency of **Claude Code CLI** into a **100% private, offline, hardware-accelerated** desktop environment.  
> **Built by Kaustubh Jawanjal**

---

## 📁 Repository & Distribution Paths
- **Active Workspace:** `D:\AntiGravity\strata`
- **1-Click Setup Launcher:** `D:\AntiGravity\strata\Setup-Strata.bat`
- **Distributable Package:** `D:\AntiGravity\strata\release\Strata-Code-Windows-x64.zip` (159 MB)
- **Backup & Archive Mirror:** `C:\AI_dev\projects\strata`
- **Architecture Documentation:** [ARCHITECTURE.md](file:///D:/AntiGravity/strata/ARCHITECTURE.md)
- **AI & Developer Guide:** [PROJECT_OVERVIEW.md](file:///D:/AntiGravity/strata/PROJECT_OVERVIEW.md)

---

## 🚀 Quick Launch & 1-Click Setup

### For New Users / Extracted ZIP:
1. Double-click **`Setup-Strata.bat`**.
2. Review the liability disclaimer (by author Kaustubh Jawanjal), select your target install folder (or keep default), and click **Install & Setup**.
3. The wizard automatically checks and installs Ollama, pulls the optimal model for your GPU (`qwen2.5-coder:32b` on 24GB+ VRAM systems), generates Desktop shortcuts, and launches the app!

### For Existing Installation:
- **Desktop Shortcut:** Double-click **`Strata Code`** on your desktop.
- **Silent Background Launcher:** Run `D:\AntiGravity\strata\run-strata-code.vbs`.
- **Command Line:**
  ```powershell
  cd D:\AntiGravity\strata
  npm start
  ```

---

## 💎 Key Highlights

| Feature | Strata Code | Cursor | Google Antigravity | Claude Code CLI |
| :--- | :---: | :---: | :---: | :---: |
| **Privacy / Local Execution** | 🥇 **100% Local & Offline** | ⚠️ Cloud Telemetry | ⚠️ Cloud-based | ⚠️ Cloud-based |
| **Hardware Tailoring** | 🥇 **Dynamic GPU Auto-Detection** | ❌ N/A | ❌ N/A | ❌ N/A |
| **In-App Model Downloader** | 🥇 **Direct Ollama Library Sync** | ❌ Proprietary only | ❌ N/A | ❌ N/A |
| **Autonomous Multi-Turn Agent** | ✅ **Yes (25 turns + tool loops)** | ✅ Yes (Composer) | ✅ Yes (Deep Reasoning) | ✅ Yes |
| **Live Status ("In Short")** | 🥇 **Animated activity ticker** | ⚠️ Basic | ⚠️ Basic | 🥇 Yes |
| **Inspector (<kbd>Ctrl</kbd>+<kbd>O</kbd>)** | 🥇 **Full Thoughts & Tool Drawer** | ❌ N/A | ❌ N/A | 🥇 Yes |
| **Quota Fallback Protection** | 🥇 **Cloud → Local Ollama (0 Quota)** | ❌ Hard limit | ❌ Hard limit | ❌ Hard limit |
| **Side-by-Side Monaco Diff** | 🥇 **Full `<DiffEditor />`** | 🥇 Full Monaco Diff | ✅ Split comparison | ⚠️ CLI diff |
| **Inline AI (<kbd>Ctrl</kbd>+<kbd>K</kbd>)** | ✅ **Direct Monaco Selection Edit** | ✅ Yes | ❌ N/A | ❌ N/A |
| **Context Tagging (`@file`)** | 🥇 **Zero-Latency Turn-1 Ingestion** | ✅ Yes | ✅ Yes | ⚠️ Basic |
| **Integrated Terminal** | ✅ **Interactive PowerShell Drawer** | ✅ Full PTY | ✅ Full PTY | 🥇 Pure CLI |

---

## 🛠️ Technology Stack
- **Desktop Shell:** Electron 34 with frameless window and hardened IPC
- **Frontend:** React 18, Monaco Editor (`@monaco-editor/react`), Tailwind CSS, Lucide Icons
- **Local AI Runtime:** Ollama local inference engine (`http://127.0.0.1:11434`)
- **Cloud Fallback APIs:** Anthropic Claude API (Claude 3.7 / 3.5), DeepSeek API, OpenRouter
- **Default Recommended Model:** `qwen2.5-coder:32b` / `llama3.3:70b`
- **Build System:** Vite 6 with TypeScript 5.7

---

*Built by Kaustubh Jawanjal. Powered by Ollama & Monaco.*
