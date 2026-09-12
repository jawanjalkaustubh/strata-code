import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec, execFile, execFileSync, execSync, spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { AgentEngine } from './agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dynamic Hardware Detection Layer (Generalizes to any GPU / CPU / RAM)
//
// This used to run SYNCHRONOUSLY at module load, before the window existed:
// execSync('nvidia-smi') with a 3 s timeout, then a 4 s PowerShell CIM
// fallback. While llama-server is loading a 26 GB model into the card,
// nvidia-smi routinely stalls to its timeout - so the app could sit for
// 7 s with no window at all, at exactly the moment the launcher had just
// kicked off that load. Detection is now async and happens after the
// window is on screen; everything that needs the result awaits it.
type HardwareInfo = { gpu: string; vram?: string; cpu: string; ram: string; os: string };
let cachedHardwareInfo: HardwareInfo | null = null;
let hardwareDetection: Promise<HardwareInfo> | null = null;

function baseHardwareInfo(): HardwareInfo {
  return {
    gpu: 'Hardware Accelerated GPU',
    vram: '',
    cpu: os.cpus()[0]?.model?.trim() || 'Multi-Core Processor',
    ram: `${Math.round(os.totalmem() / (1024 * 1024 * 1024))}GB RAM`,
    os: `${os.type()} ${os.release()}`
  };
}

function runProbe(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { encoding: 'utf-8', timeout, windowsHide: true }, (err, stdout) => {
        resolve(err ? '' : String(stdout || ''));
      });
    } catch {
      resolve('');
    }
  });
}

async function detectHardwareInfo(): Promise<HardwareInfo> {
  if (cachedHardwareInfo) return cachedHardwareInfo;
  if (hardwareDetection) return hardwareDetection;
  hardwareDetection = (async () => {
    const info = baseHardwareInfo();

    // 1. nvidia-smi (fastest for NVIDIA GPUs)
    const out = await runProbe('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], 3000);
    const line = out.trim().split('\n')[0];
    let found = false;
    if (line && line.includes(',')) {
      const parts = line.split(',').map(s => s.trim());
      if (parts[0]) {
        info.gpu = parts[0];
        found = true;
      }
      const total = parseInt(parts[1] || '', 10);
      if (Number.isFinite(total)) info.vram = `${Math.round(total / 1024)}GB VRAM`;
    }

    // 2. Fallback to Windows CIM/WMI
    if (!found && process.platform === 'win32') {
      const ps = await runProbe('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json'], 4000);
      try {
        const parsed = JSON.parse(ps);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        const discrete = list.find((g: any) => /nvidia|geforce|rtx|gtx|radeon|arc/i.test(g?.Name)) || list[0];
        if (discrete && discrete.Name) info.gpu = discrete.Name;
      } catch {}
    }

    cachedHardwareInfo = info;
    return info;
  })();
  return hardwareDetection;
}

/** Whatever is known right now. Never blocks; falls back to generic labels until detection completes. */
function getSystemHardwareInfo(): HardwareInfo {
  return cachedHardwareInfo || baseHardwareInfo();
}

// Ollama Process & Health Management Layer
class OllamaProcessManager {
  private cachedBinaryPath: string | null = null;

  findOllamaBinary(): string | null {
    if (this.cachedBinaryPath && fs.existsSync(this.cachedBinaryPath)) {
      return this.cachedBinaryPath;
    }

    const candidatePaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'),
      'C:\\Program Files\\Ollama\\ollama.exe',
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Ollama', 'ollama.exe')
    ];

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        this.cachedBinaryPath = p;
        return p;
      }
    }

    // Try finding via where.exe on Windows
    try {
      const out = execSync('where.exe ollama', { encoding: 'utf-8', timeout: 2000 });
      const firstLine = out.trim().split(/\r?\n/)[0];
      if (firstLine && fs.existsSync(firstLine)) {
        this.cachedBinaryPath = firstLine;
        return firstLine;
      }
    } catch {}

    return null;
  }

  async checkHealth(): Promise<{
    online: boolean;
    version?: string;
    binaryFound: boolean;
    binaryPath?: string;
    error?: string;
  }> {
    const binPath = this.findOllamaBinary();
    try {
      const res = await fetch('http://127.0.0.1:11434/api/version', {
        signal: AbortSignal.timeout(2500)
      });
      if (res.ok) {
        const data: any = await res.json();
        return {
          online: true,
          version: data.version || '0.x',
          binaryFound: !!binPath,
          binaryPath: binPath || undefined
        };
      }
      return {
        online: false,
        binaryFound: !!binPath,
        binaryPath: binPath || undefined,
        error: `Ollama replied with HTTP ${res.status}`
      };
    } catch (err: any) {
      return {
        online: false,
        binaryFound: !!binPath,
        binaryPath: binPath || undefined,
        error: err.message || 'Connection refused or timed out'
      };
    }
  }

  async startOllamaService(): Promise<{ success: boolean; message?: string; error?: string }> {
    const health = await this.checkHealth();
    if (health.online) {
      return { success: true, message: 'Ollama is already running.' };
    }

    const binPath = this.findOllamaBinary();
    if (!binPath) {
      return {
        success: false,
        error: 'Ollama executable was not found on this system. Please install Ollama from https://ollama.com.'
      };
    }

    try {
      const child = spawn(binPath, ['serve'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      child.unref();

      // Poll checkHealth up to 10 times with 500ms intervals (5 seconds max)
      for (let i = 0; i < 10; i++) {
        await new Promise(r => setTimeout(r, 500));
        const check = await this.checkHealth();
        if (check.online) {
          return { success: true, message: 'Ollama service started successfully.' };
        }
      }

      return {
        success: false,
        error: 'Ollama process started, but service did not respond within 5 seconds.'
      };
    } catch (err: any) {
      return { success: false, error: `Failed to spawn Ollama: ${err.message}` };
    }
  }

  async restartOllamaService(): Promise<{ success: boolean; message?: string; error?: string }> {
    // 1. Force terminate any hung or running Ollama processes
    try {
      if (process.platform === 'win32') {
        execSync('taskkill /F /IM ollama.exe /T', { stdio: 'ignore', timeout: 4000 });
      } else {
        execSync('pkill -9 ollama', { stdio: 'ignore', timeout: 4000 });
      }
    } catch {
      // Ignored: process may not have been active
    }

    // Small delay to allow Windows to cleanly release port 11434
    await new Promise(r => setTimeout(r, 1200));

    // 2. Start clean service
    return this.startOllamaService();
  }
}

const ollamaManager = new OllamaProcessManager();

// Set custom application name and isolate cache
app.name = 'StrataCode';

// Versioned userData root.
//
// `disable-gpu-shader-disk-cache` used to be set here, which forced Chromium to
// recompile every shader on each launch - a permanent startup cost paid to work
// around what is normally a one-off corrupt-cache problem. Versioning the whole
// userData directory solves that properly: bumping CACHE_SCHEMA_VERSION abandons
// the old caches wholesale instead of disabling caching forever.
const CACHE_SCHEMA_VERSION = 'v1';
{
  const legacyUserData = app.getPath('userData');
  const versionedUserData = path.join(path.dirname(legacyUserData), `StrataCode-${CACHE_SCHEMA_VERSION}`);
  app.setPath('userData', versionedUserData);

  // Carry settings forward so bumping the version never silently loses API keys
  // or accumulated quota stats.
  try {
    const legacyConfig = path.join(legacyUserData, 'provider-config.json');
    const newConfig = path.join(versionedUserData, 'provider-config.json');
    if (fs.existsSync(legacyConfig) && !fs.existsSync(newConfig)) {
      fs.mkdirSync(versionedUserData, { recursive: true });
      fs.copyFileSync(legacyConfig, newConfig);
      console.log('[Startup] Migrated provider-config.json into the versioned userData directory.');
    }
  } catch (err) {
    console.warn('[Startup] Could not migrate provider config:', err);
  }
}

let mainWindow: BrowserWindow | null = null;
let currentWorkspace: string = fs.existsSync('d:\\AntiGravity') ? 'd:\\AntiGravity' : os.homedir();
const agent = new AgentEngine(currentWorkspace);

// GPU name is filled in asynchronously once the window is up (see whenReady).
// The agent's default label is used until then.

// Multi-Provider Configuration (Ollama, Anthropic Claude, DeepSeek, OpenRouter)
const providerConfigPath = path.join(app.getPath('userData'), 'provider-config.json');

function getStoredProviderConfig() {
  try {
    if (fs.existsSync(providerConfigPath)) {
      return JSON.parse(fs.readFileSync(providerConfigPath, 'utf-8'));
    }
  } catch {}
  return {
    activeProvider: 'ollama',
    hybridMode: false,
    hybridArchitectModel: 'qwen3.8:27b',
    generalModel: 'qwen3.8:27b',
    codingModel: 'Qwen3-Coder-30B-A3B-Instruct',
    allowPaidApis: false
  };
}

agent.setProviderConfig(getStoredProviderConfig());
agent.onConfigUpdate = (config) => {
  try {
    fs.mkdirSync(path.dirname(providerConfigPath), { recursive: true });
    fs.writeFileSync(providerConfigPath, JSON.stringify(config, null, 2), 'utf-8');
  } catch {}
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    center: true,
    frame: false,
    title: 'Strata Code',
    icon: path.join(__dirname, '../assets/strata.ico'),
    show: true,
    backgroundColor: '#0c0e14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      // Chromium throttles timers and rAF to ~1Hz in unfocused windows. With the
      // agent streaming for minutes at a time, alt-tabbing away froze the token
      // stream and the elapsed-time counter until the window regained focus.
      backgroundThrottling: false,
      // Renderer never touches Node APIs directly - everything goes through the
      // contextBridge in preload.cjs - so the OS sandbox can stay on.
      sandbox: true
    }
  });

  mainWindow.setTitle('Strata Code');
  agent.setSender(mainWindow.webContents);

  // Prevent external links from hijacking window; open in system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    agent.setSender(null);
  });

  // Force bring to front bypassing Windows background lock
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  setTimeout(() => {
    mainWindow?.setAlwaysOnTop(false);
  }, 200);
}

// Global exception filter to avoid crashing dialogs on teardown race conditions
process.on('uncaughtException', (err: any) => {
  if (err && (err.message?.includes('Object has been destroyed') || err.message?.includes('Render frame was disposed'))) {
    // Normal Electron window teardown race condition - safely ignore
    return;
  }
  console.error('[Main Process Exception]', err);
});

/**
 * Starts the port-8080 coder server if nothing answers there. Loading the
 * 26 GB Q6_K model saturates the disk, the PCIe bus and the GPU for ~40 s;
 * doing that while Chromium is painting its first frame is what made the
 * app "hang on open". It is now deferred until the renderer reports
 * did-finish-load, plus a short grace period so the UI is interactive first.
 */
// =============================================================================
// CODER SERVER LIFECYCLE
//
// The coder llama-server is a child of this app: spawned here with its output
// in a log file, its PID recorded, and killed when the app quits. Before this
// it was launched through `cmd /c start` into a console window the app then
// knew nothing about - it outlived the app, Ctrl+C in that window did nothing
// useful, and a relaunch could not tell its own server from Ollama's runner.
// =============================================================================
const CODER_SCRIPT = 'C:\\AI_dev\\llama.cpp\\launch-server-8080.ps1';
let coderChild: ChildProcess | null = null;
const coderPidFile = () => path.join(app.getPath('userData'), 'coder-server.pid');
const coderLogFile = () => path.join(app.getPath('userData'), 'coder-server.log');

function killTreeSync(pid: number) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore', timeout: 8000, windowsHide: true });
  } catch {}
}

/** PIDs of every llama-server on the coder port, synchronously (for quit). */
function coderPortPidsSync(): number[] {
  try {
    const script = "Get-CimInstance Win32_Process -Filter \"Name='llama-server.exe'\" | Where-Object { $_.CommandLine -match '--port 8080( |$)' } | Select-Object -ExpandProperty ProcessId";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf-8', timeout: 6000, windowsHide: true });
    return String(out).split(/\r?\n/).map(l => parseInt(l.trim(), 10)).filter(n => Number.isFinite(n));
  } catch {
    return [];
  }
}

/** Kill our child, any server left by a previous app instance, and anything else on the coder port. */
async function stopCoderServer(reason: string): Promise<number[]> {
  const killed: number[] = [];
  const own = coderChild?.pid;
  if (own) { killTreeSync(own); killed.push(own); }
  coderChild = null;
  try {
    const stale = parseInt(fs.readFileSync(coderPidFile(), 'utf-8').trim(), 10);
    if (Number.isFinite(stale) && !killed.includes(stale)) { killTreeSync(stale); killed.push(stale); }
  } catch {}
  try { fs.unlinkSync(coderPidFile()); } catch {}
  try {
    for (const pid of await agent.findCoderServerPids()) {
      if (!killed.includes(pid)) { killTreeSync(pid); killed.push(pid); }
    }
  } catch {}
  if (killed.length) console.log(`[Coder Server] Stopped (${reason}): pid ${killed.join(', ')}`);
  agent.probeLocalEngines(true).catch(() => {});
  return killed;
}

/** Quit-time variant: no async work, the process is exiting. */
function stopCoderServerSync(reason: string) {
  const own = coderChild?.pid;
  if (own) killTreeSync(own);
  coderChild = null;
  try {
    const stale = parseInt(fs.readFileSync(coderPidFile(), 'utf-8').trim(), 10);
    if (Number.isFinite(stale) && stale !== own) killTreeSync(stale);
  } catch {}
  try { fs.unlinkSync(coderPidFile()); } catch {}
  // Servers started outside this app (the .bat, a previous crashed instance)
  // sit on the same port and are ours by definition.
  for (const pid of coderPortPidsSync()) {
    if (pid !== own) killTreeSync(pid);
  }
  console.log(`[Coder Server] Stopped (${reason})`);
}

/**
 * Starts the coder server as a child of this app. Returns false when it was
 * already up/loading, when the launch script is missing, or when another
 * app's model leaves too little VRAM (the status bar then offers "Free GPU").
 */
async function startCoderServer(reason: string): Promise<boolean> {
  if (!fs.existsSync(CODER_SCRIPT)) {
    console.log('[Coder Server] Launch script not found: ' + CODER_SCRIPT);
    return false;
  }
  const status = await agent.probeLocalEngines(true);
  if (status.llamaServer.up || status.llamaServer.loading) {
    // Adopt a server from a previous instance so quit can stop it.
    if (status.llamaServer.pid && !coderChild) {
      try { fs.writeFileSync(coderPidFile(), String(status.llamaServer.pid)); } catch {}
    }
    console.log('[Coder Server] Already ' + (status.llamaServer.up ? 'up' : 'loading') + '; not starting another.');
    return false;
  }
  if (status.coderBlockedBy) {
    console.log(`[Coder Server] Not started: ${status.coderBlockedBy} (another app) holds the GPU. Use "Free GPU" in the status bar.`);
    return false;
  }
  // Our own leftover Ollama model (e.g. the architect from a local-only run)
  // may still be resident. Evicting it only costs us a reload later.
  try {
    const freed = await agent.releaseOllamaVram(false);
    if (freed.length) {
      console.log(`[Coder Server] Unloaded ${freed.join(', ')} from Ollama first.`);
      await new Promise(r => setTimeout(r, 2500));
    }
  } catch {}

  let logFd: number | undefined;
  try {
    fs.mkdirSync(path.dirname(coderLogFile()), { recursive: true });
    logFd = fs.openSync(coderLogFile(), 'a');
    fs.writeSync(logFd, `\n===== ${new Date().toISOString()} start (${reason}) =====\n`);
  } catch {}

  console.log(`[Coder Server] Starting (${reason}) -> ${coderLogFile()}`);
  agent.markCoderServerStarting();
  // powershell -NonInteractive: the script's "Press Enter to exit" branches
  // fail fast instead of waiting on a console that does not exist.
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CODER_SCRIPT],
    { stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'], windowsHide: true, detached: false }
  );
  coderChild = child;
  try { fs.writeFileSync(coderPidFile(), String(child.pid)); } catch {}
  child.on('exit', (code) => {
    console.log(`[Coder Server] Exited with code ${code}`);
    if (coderChild === child) coderChild = null;
    try { if (logFd !== undefined) fs.closeSync(logFd); } catch {}
    agent.probeLocalEngines(true).catch(() => {});
  });
  child.on('error', (err) => {
    console.warn('[Coder Server] Spawn failed:', err.message);
    if (coderChild === child) coderChild = null;
  });
  return true;
}

function startCoderServerIfDown() {
  fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1200) })
    .then(res => {
      if (!res.ok) throw new Error(`health ${res.status}`);
      // Up already (a previous instance or the .bat): record it so quit stops it.
      agent.probeLocalEngines(true).then(st => {
        if (st.llamaServer.pid) { try { fs.writeFileSync(coderPidFile(), String(st.llamaServer.pid)); } catch {} }
      }).catch(() => {});
    })
    .catch(() => startCoderServer('app-start').catch(err => console.warn('[Coder Server] start failed:', err?.message)));
}

app.whenReady().then(async () => {
  createWindow();

  // Hardware detection runs AFTER the window exists and never blocks it.
  detectHardwareInfo()
    .then(hw => agent.setGpuName(hw.gpu))
    .catch(() => {});

  // Non-blocking auto-check and recovery on boot
  ollamaManager.checkHealth().then(health => {
    if (!health.online && health.binaryFound) {
      console.log('[Strata Code] Ollama service is offline on launch. Auto-starting...');
      ollamaManager.startOllamaService().catch(() => {});
    }
  }).catch(() => {});

  // Coder server: only once the UI is on screen and responsive.
  if (mainWindow) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(startCoderServerIfDown, 3000);
    });
  } else {
    setTimeout(startCoderServerIfDown, 6000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  try {
    agent.stop();
  } catch {
    // Safe teardown
  }
  // The coder server lives and dies with the app. Synchronous on purpose:
  // the process is about to exit and an async kill would be abandoned.
  try {
    stopCoderServerSync('app-quit');
  } catch {}
});

// Window controls
ipcMain.on('window:minimize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.minimize();
});
ipcMain.on('window:maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.on('window:close', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.close();
});

// Workspace handlers
ipcMain.handle('workspace:open-dialog', async () => {
  const res = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    defaultPath: currentWorkspace
  });
  if (!res.canceled && res.filePaths[0]) {
    currentWorkspace = res.filePaths[0];
    agent.setWorkspace(currentWorkspace);
    return currentWorkspace;
  }
  return null;
});

ipcMain.handle('workspace:get-files', async (_e, dirPath?: string) => {
  const root = dirPath || currentWorkspace;
  const getTree = (dir: string, depth: number = 0): any[] => {
    if (depth > 3) return [];
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      return items
        .filter(i => !['node_modules', '.git', 'dist', 'dist-electron', 'Cache', 'GPUCache', 'Code Cache'].includes(i.name))
        .map(item => {
          const full = path.join(dir, item.name);
          const isDir = item.isDirectory();
          return {
            name: item.name,
            path: full,
            relPath: path.relative(currentWorkspace, full),
            isDir,
            children: isDir ? getTree(full, depth + 1) : undefined
          };
        });
    } catch {
      return [];
    }
  };
  return { root: currentWorkspace, items: getTree(root, 0) };
});

ipcMain.handle('workspace:read-file', async (_e, filePath: string) => {
  try {
    if (!fs.existsSync(filePath)) {
      return 'Error: File does not exist.';
    }
    const stat = fs.statSync(filePath);
    if (stat.size > 5 * 1024 * 1024) {
      return `⚠️ File exceeds 5MB (${(stat.size / (1024 * 1024)).toFixed(1)}MB). Too large to display safely in editor.`;
    }
    return fs.readFileSync(filePath, 'utf-8');
  } catch (err: any) {
    return `Error: ${err.message}`;
  }
});

ipcMain.handle('workspace:save-file', async (_e, filePath: string, content: string) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('workspace:create-file', async (_e, filePath: string) => {
  try {
    const full = path.join(currentWorkspace, filePath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!fs.existsSync(full)) {
      fs.writeFileSync(full, '', 'utf-8');
    }
    return { success: true, path: full };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Ollama Daemon & Health Management IPC handlers
ipcMain.handle('ollama:health-check', async () => {
  return ollamaManager.checkHealth();
});

ipcMain.handle('ollama:start-service', async () => {
  return ollamaManager.startOllamaService();
});

ipcMain.handle('ollama:restart-service', async () => {
  return ollamaManager.restartOllamaService();
});

let pullAbortController: AbortController | null = null;

// Local models discovery & details (Ollama + Port 8080 llama-server)
ipcMain.handle('ollama:get-models', async () => {
  const modelsList: string[] = [];

  // 1. Check Port 8080 llama-server or GGUF model file
  const ggufPath = 'C:\\AI_dev\\models\\qwen3-coder\\Qwen3-Coder-30B-A3B-Instruct-Q6_K.gguf';
  if (fs.existsSync(ggufPath)) {
    modelsList.push('Qwen3-Coder-30B-A3B-Instruct');
  }

  // 2. Query Ollama models
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data: any = await res.json();
      const ollamaModels = (data.models || []).map((m: any) => m.name);
      for (const m of ollamaModels) {
        if (!modelsList.includes(m)) modelsList.push(m);
      }
    }
  } catch {}

  if (modelsList.length === 0) {
    modelsList.push('Qwen3-Coder-30B-A3B-Instruct', 'qwen3.8:27b');
  }
  return modelsList;
});

ipcMain.handle('ollama:get-model-details', async () => {
  const detailsList: any[] = [];

  // 1. Inject rich metadata for Qwen3-Coder (Port 8080 llama-server)
  const ggufPath = 'C:\\AI_dev\\models\\qwen3-coder\\Qwen3-Coder-30B-A3B-Instruct-Q6_K.gguf';
  if (fs.existsSync(ggufPath)) {
    try {
      const stats = fs.statSync(ggufPath);
      detailsList.push({
        name: 'Qwen3-Coder-30B-A3B-Instruct',
        size: stats.size,
        modified_at: stats.mtime.toISOString(),
        digest: 'local-gguf-port-8080',
        details: {
          parent_model: 'llama-server (Port 8080 • RTX 5090)',
          format: 'gguf',
          family: 'qwen3-coder',
          families: ['qwen3-coder', 'moe'],
          parameter_size: '30.5B (3.3B Active)',
          quantization_level: 'Q6_K (FlashAttention • 237 t/s)'
        }
      });
    } catch {}
  }

  // 2. Query Ollama model details
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags', {
      signal: AbortSignal.timeout(3000)
    });
    if (res.ok) {
      const data: any = await res.json();
      for (const m of (data.models || [])) {
        if (!detailsList.some(d => d.name === m.name)) {
          detailsList.push(m);
        }
      }
    }
  } catch {}

  return detailsList;
});

function safeSend(sender: Electron.WebContents | null | undefined, channel: string, ...args: any[]) {
  try {
    if (sender && !sender.isDestroyed()) {
      sender.send(channel, ...args);
    }
  } catch {
    // Ignore destroyed webContents
  }
}

// Ollama model pulling with live progress stream
ipcMain.handle('ollama:pull-model', async (event, modelName: string) => {
  if (pullAbortController) {
    pullAbortController.abort();
  }
  pullAbortController = new AbortController();
  const signal = pullAbortController.signal;

  try {
    // Pre-flight health check to give instantaneous actionable feedback if daemon is down
    const health = await ollamaManager.checkHealth();
    if (!health.online) {
      const errMsg = health.binaryFound
        ? 'Ollama service is currently offline. Please click "Start Ollama" to launch the service.'
        : 'Ollama is not installed or unreachable at 127.0.0.1:11434.';
      safeSend(event.sender, 'ollama:pull-progress', {
        modelName,
        status: `Offline: ${errMsg}`,
        error: errMsg,
        done: true
      });
      return { success: false, error: errMsg };
    }

    const res = await fetch('http://127.0.0.1:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName, stream: true }),
      signal
    });

    if (!res.ok) {
      const errorText = await res.text();
      safeSend(event.sender, 'ollama:pull-progress', {
        modelName,
        status: `Download error: ${res.statusText}`,
        error: errorText || res.statusText,
        done: true
      });
      return { success: false, error: errorText };
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable.');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const total = data.total || 0;
          const completed = data.completed || 0;
          const percent = total > 0 ? Number(((completed / total) * 100).toFixed(1)) : 0;

          if (data.error) {
            safeSend(event.sender, 'ollama:pull-progress', {
              modelName,
              status: `Error: ${data.error}`,
              error: data.error,
              done: true
            });
            return { success: false, error: data.error };
          }

          safeSend(event.sender, 'ollama:pull-progress', {
            modelName,
            status: data.status,
            total,
            completed,
            percent,
            done: data.status === 'success'
          });
        } catch {
          // Ignore partial chunk parse error
        }
      }
    }

    safeSend(event.sender, 'ollama:pull-progress', {
      modelName,
      status: 'success',
      percent: 100,
      done: true
    });

    return { success: true };
  } catch (err: any) {
    if (signal.aborted) {
      safeSend(event.sender, 'ollama:pull-progress', {
        modelName,
        status: 'Cancelled by user',
        done: true,
        cancelled: true
      });
      return { success: false, cancelled: true };
    }
    safeSend(event.sender, 'ollama:pull-progress', {
      modelName,
      status: `Error: ${err.message}`,
      error: err.message,
      done: true
    });
    return { success: false, error: err.message };
  } finally {
    pullAbortController = null;
  }
});

// Cancel active pull
ipcMain.handle('ollama:cancel-pull', async () => {
  if (pullAbortController) {
    pullAbortController.abort();
    pullAbortController = null;
    return { success: true };
  }
  return { success: false };
});

// Delete an installed model
ipcMain.handle('ollama:delete-model', async (_e, modelName: string) => {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/delete', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: modelName }),
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      return { success: true };
    }
    const errText = await res.text();
    return { success: false, error: errText };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Agent control
ipcMain.handle('agent:start', async (_e, prompt: string, model: string, autoMode: boolean, taskMode: string = 'coding', editorContext?: any, images?: string[]) => {
  agent.run(prompt, model, autoMode, taskMode, editorContext, images);
  return { started: true };
});

ipcMain.handle('agent:stop', async () => {
  agent.stop();
  return { stopped: true };
});

ipcMain.handle('agent:reset-history', async () => {
  agent.resetHistory();
  return { reset: true };
});

ipcMain.handle('agent:approval-response', async (_e, approvalId: string, approved: boolean) => {
  agent.resolveApproval(approvalId, approved);
  return { received: true };
});

// System Hardware Info (Dynamic GPU / CPU / RAM Detection)
ipcMain.handle('system:get-info', async () => {
  return detectHardwareInfo();
});

// Inline AI Completion (Ctrl+K precision code generation) with 45s timeout
ipcMain.handle('ai:inline-generate', async (_e, payload: { prompt: string; selectedCode: string; language: string; model: string }) => {
  const { prompt, selectedCode, language, model } = payload;
  const systemPrompt = `You are a precision code editor. The user wants you to edit or generate code in ${language}.
Output ONLY the replacement code lines. Do NOT wrap your output in markdown codeblocks (no \`\`\`), do NOT explain or add conversational commentary. Output purely the code.`;

  const userPrompt = selectedCode
    ? `Instruction: ${prompt}\n\nSelected Code to modify:\n${selectedCode}`
    : `Instruction: ${prompt}\n\nTarget Language: ${language}`;

  try {
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'qwen2.5-coder:32b',
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false
      }),
      signal: AbortSignal.timeout(45000)
    });
    if (res.ok) {
      const data: any = await res.json();
      let code = data.response || '';
      if (code.startsWith('```')) {
        code = code.replace(/^```[a-zA-Z0-9_-]*\r?\n/, '').replace(/\r?\n```$/, '');
      }
      return { success: true, code: code.trim() };
    }
    return { success: false, error: res.statusText };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Interactive Terminal command runner
ipcMain.handle('terminal:run-command', async (_e, command: string) => {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const opts = {
      cwd: currentWorkspace,
      maxBuffer: 10 * 1024 * 1024,
      // Previously unbounded: a command that waited on input (or any long-running
      // process) left the promise pending forever and the terminal drawer stuck.
      timeout: 120000,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    };
    const done = (error: any, stdout: string, stderr: string) => {
      const timedOut = error && error.killed;
      resolve({
        stdout: stdout || '',
        stderr: timedOut
          ? `${stderr || ''}\n[TIMEOUT] Command exceeded 120s and was terminated.`.trim()
          : (stderr || (error ? error.message : '')),
        exitCode: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0)
      });
    };
    if (isWin) {
      // -NoProfile avoids re-loading the user's PowerShell profile on every command.
      const prefix = '$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', prefix + command], opts, done);
    } else {
      exec(command, { ...opts, shell: '/bin/bash' }, done);
    }
  });
});

// Multi-Provider configuration IPC handlers
ipcMain.handle('provider:get-config', async () => {
  return getStoredProviderConfig();
});

ipcMain.handle('provider:save-config', async (_e, config: any) => {
  try {
    fs.mkdirSync(path.dirname(providerConfigPath), { recursive: true });
    fs.writeFileSync(providerConfigPath, JSON.stringify(config, null, 2), 'utf-8');
    agent.setProviderConfig(config);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

// Live local-engine telemetry for the status bar: which model llama-server is
// actually serving, its real context window, what Ollama is holding, and true
// GPU headroom from nvidia-smi. All of this was already gathered by the VRAM
// arbiter and rendered nowhere.
ipcMain.handle('engine:status', async () => {
  try {
    const status = await agent.probeLocalEngines();
    return { success: true, status: { ...status, coderManaged: coderChild !== null, coderLog: coderLogFile() } };
  } catch (err: any) {
    return { success: false, error: err.message, status: null };
  }
});

// User-initiated only: evict everything from Ollama (including another app's
// model) and start the coder server.
ipcMain.handle('engine:take-gpu', async () => {
  try {
    const freed = await agent.releaseOllamaVram(true);
    if (freed.length) await new Promise(r => setTimeout(r, 2500));
    const started = await startCoderServer('take-gpu');
    return { success: true, freed, started };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('engine:stop-coder', async () => {
  try {
    const killed = await stopCoderServer('user');
    return { success: true, killed };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('shell:open-external', async (_e, url: string) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});


