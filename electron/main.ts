import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { exec, execFile, execSync, spawn, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import { AgentEngine, OLLAMA_NUM_CTX, OLLAMA_KEEP_ALIVE } from './agent';
import {
  coderServerExe, coderServerArgs, coderModelPath, coderConfig, defaultWorkspace, rememberWorkspace, runtimeDir, modelsDir, installRoot
} from './paths';
import { deletePresence } from './presence';
import { trackChild, killTree, killTrackedChildren } from './children';

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

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
let currentWorkspace: string = defaultWorkspace();
const agent = new AgentEngine(currentWorkspace);

// GPU name is filled in asynchronously once the window is up (see whenReady).
// The agent's default label is used until then.

// Provider configuration (local engines only: Ollama and the llama.cpp coder)
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
    icon: path.join(__dirname, '../assets/strata-code-sc.ico'),
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
  const win = mainWindow;

  // Prevent external links from hijacking window; open in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // The default application menu is gone (Menu.setApplicationMenu(null) in
  // whenReady): on a frameless window it silently bound Ctrl+W (close ->
  // quit -> coder killed mid-run) and Ctrl+R (renderer reload mid-run, dirty
  // buffers lost). DevTools stay reachable in a dev build only.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (_e, input) => {
      if (input.type !== 'keyDown') return;
      const devtools = input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i');
      if (devtools) win.webContents.toggleDevTools();
    });
  }

  // A crashed renderer used to leave a frameless dead window while the run
  // kept executing tools into a destroyed webContents. Abort the run, drop the
  // sender, reload (capped so a crash loop cannot spin forever).
  let rendererReloads = 0;
  win.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[Renderer] gone: ${details.reason} (exit ${details.exitCode})`);
    agent.setSender(null);
    void agent.stop();
    if (quitting || details.reason === 'clean-exit') return;
    if (rendererReloads >= 3) {
      dialog.showErrorBox('Strata Code', `The window crashed repeatedly (${details.reason}). Please relaunch the app.`);
      return;
    }
    rendererReloads++;
    try {
      win.webContents.reload();
      agent.setSender(win.webContents);
    } catch {}
  });

  // Main frame only; -3 (ERR_ABORTED) is a navigation the app itself
  // cancelled; the first load is owned by the whenReady .catch (otherwise one
  // failure shows two boxes).
  let firstLoadDone = false;
  win.webContents.once('did-finish-load', () => { firstLoadDone = true; });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || !firstLoadDone) return;
    console.error(`[Renderer] did-fail-load ${code} ${desc} ${url}`);
    dialog.showErrorBox('Strata Code', `The window failed to load (${code} ${desc}).\n${url}`);
  });

  // Windows logoff / shutdown does not emit before-quit: flush what we can.
  win.on('session-end', () => {
    void agent.flushLiveDialogue();
    deletePresence();
  });

  // Unsaved editor buffers or a running agent: ask before the window goes.
  // The renderer keeps `rendererDirty` current via window:set-dirty.
  win.on('close', (e) => {
    if (quitting || forceClose) return;
    const busy = agent.isRunActive();
    if (!rendererDirty && !busy) return;
    e.preventDefault();
    const detail = [
      rendererDirty ? 'There are unsaved changes in the editor.' : '',
      busy ? 'The agent is still running; closing stops it and kills its tool commands.' : ''
    ].filter(Boolean).join('\n');
    dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Strata Code',
      message: 'Close Strata Code?',
      detail
    }).then(({ response }) => {
      if (response === 1) {
        forceClose = true;
        win.close();
      }
    }).catch(() => {});
  });

  const loading = process.env.VITE_DEV_SERVER_URL
    ? win.loadURL(process.env.VITE_DEV_SERVER_URL)
    : win.loadFile(path.join(__dirname, '../dist/index.html'));

  win.on('closed', () => {
    mainWindow = null;
    agent.setSender(null);
  });

  win.show();
  win.focus();
  return loading;
}

let quitting = false;
let forceClose = false;
let rendererDirty = false;

// Global exception filter to avoid crashing dialogs on teardown race conditions
process.on('uncaughtException', (err: any) => {
  if (err && (err.message?.includes('Object has been destroyed') || err.message?.includes('Render frame was disposed'))) {
    // Normal Electron window teardown race condition - safely ignore
    return;
  }
  console.error('[Main Process Exception]', err);
});

// =============================================================================
// CODER SERVER LIFECYCLE
//
// The coder llama-server.exe is a DIRECT child of this app: spawned here with
// its output in a log file and killed when the app quits. It used to run
// under a powershell.exe wrapper (launch-server-8080.ps1), which made it a
// grandchild - libuv's job object killed the shell on a hard death of
// electron.exe but not the 26 GB server underneath it. Its pid was also
// written to a file and killed blindly on the next launch, which after a
// reboot (pid recycled) could take down ollama.exe or a browser. Both gone:
// the server is identified only as `coderChild` or by its command line
// (`--port 8080`, see agent.findCoderServerPids()).
//
// It is no longer started at launch: the first prompt that targets it starts
// it (agent.onCoderNeeded), and it is stopped again after `coderIdleMinutes`
// without a run. `coderAutoStart: true` in provider-config.json restores the
// launch-time start.
// =============================================================================
let coderChild: ChildProcess | null = null;
const coderLogFile = () => path.join(app.getPath('userData'), 'coder-server.log');
/** Last moment a run was seen active while the coder was up (idle-stop clock). */
let coderLastActiveAt = Date.now();

type CoderEvent = { kind: 'starting' | 'up' | 'exited' | 'error' | 'stopped'; detail: string };
function emitCoderEvent(kind: CoderEvent['kind'], detail: string) {
  safeSend(mainWindow?.webContents, 'coder:event', { kind, detail });
}

/** Kill our child plus any llama-server on the coder port (a previous crashed instance, the .bat). Async, bounded. */
async function stopCoderServer(reason: string): Promise<number[]> {
  const killed: number[] = [];
  const own = coderChild?.pid;
  coderChild = null;
  if (own) { await killTree(own, 3000); killed.push(own); }
  try {
    for (const pid of await agent.findCoderServerPids()) {
      if (!killed.includes(pid)) { await killTree(pid, 3000); killed.push(pid); }
    }
  } catch {}
  agent.clearCoderStarting();
  if (killed.length) console.log(`[Coder Server] Stopped (${reason}): pid ${killed.join(', ')}`);
  emitCoderEvent('stopped', reason);
  agent.probeLocalEngines(true).catch(() => {});
  return killed;
}

/** Idle stop: only the server THIS app spawned, only while no run is active. Never the foreign-:8080 kill. */
async function stopIdleCoder(): Promise<void> {
  const child = coderChild;
  if (!child?.pid) return;
  coderChild = null;
  await killTree(child.pid, 3000);
  agent.clearCoderStarting();
  console.log('[Coder Server] Stopped (idle)');
  emitCoderEvent('stopped', 'idle');
  agent.probeLocalEngines(true).catch(() => {});
}

function coderIdleMs(): number {
  const cfg = agent.providerConfig;
  const minutes = typeof cfg.coderIdleMinutes === 'number' ? cfg.coderIdleMinutes : 20;
  return minutes > 0 ? minutes * 60000 : 0;
}

// One 60 s tick; nothing is spawned by it unless the idle deadline passed.
setInterval(() => {
  if (quitting) return;
  if (!coderChild) { coderLastActiveAt = Date.now(); return; }
  if (agent.isRunActive()) { coderLastActiveAt = Date.now(); return; }
  const idleMs = coderIdleMs();
  if (idleMs > 0 && Date.now() - coderLastActiveAt >= idleMs) {
    stopIdleCoder().catch(() => {});
  }
}, 60000).unref();

/**
 * Starts the coder server as a direct child of this app. Returns false when it
 * was already up/loading, when the binary or model is missing, when the app is
 * quitting, or when another app's model leaves too little VRAM (the status bar
 * then offers "Free GPU"). Every failure is pushed to the renderer as a
 * coder:event so the status bar can say why instead of "coder offline".
 */
async function startCoderServer(reason: string): Promise<boolean> {
  if (quitting) return false;
  const exe = coderServerExe();
  if (!exe) {
    const detail = `llama-server.exe not found (runtime dir: ${runtimeDir() || 'none'}). Run the installer, or set STRATA_RUNTIME_DIR.`;
    console.log(`[Coder Server] ${detail}`);
    emitCoderEvent('error', detail);
    return false;
  }
  const model = coderModelPath();
  if (!model) {
    const detail = `No GGUF model found (models dir: ${modelsDir() || 'none'}). Run the installer to download one.`;
    console.log(`[Coder Server] ${detail}`);
    emitCoderEvent('error', detail);
    return false;
  }
  const status = await agent.probeLocalEngines(true);
  if (quitting) return false;
  if (status.llamaServer.up || status.llamaServer.loading) {
    console.log('[Coder Server] Already ' + (status.llamaServer.up ? 'up' : 'loading') + '; not starting another.');
    return false;
  }
  if (status.coderBlockedBy) {
    const detail = `GPU held by ${status.coderBlockedBy}. Use "Free GPU" in the status bar to unload it.`;
    console.log(`[Coder Server] Not started: ${detail}`);
    emitCoderEvent('error', detail);
    return false;
  }
  // Our own leftover Ollama model (e.g. the architect from a local-only run)
  // may still be resident. Evicting it only costs us a reload later; a model
  // a live sibling lists is kept (releaseOllamaVram checks presence).
  try {
    const freed = await agent.releaseOllamaVram(false);
    if (freed.length) {
      console.log(`[Coder Server] Unloaded ${freed.join(', ')} from Ollama first.`);
      await sleep(2500);
    }
  } catch {}
  if (quitting) return false;

  let logFd: number | undefined;
  try {
    fs.mkdirSync(path.dirname(coderLogFile()), { recursive: true });
    logFd = fs.openSync(coderLogFile(), 'a');
    fs.writeSync(logFd, `\n===== ${new Date().toISOString()} start (${reason}) =====\n`);
  } catch {}
  const closeLog = () => { try { if (logFd !== undefined) fs.closeSync(logFd); } catch {} logFd = undefined; };

  const cfg = coderConfig();
  const args = coderServerArgs(model, cfg);
  console.log(`[Coder Server] Starting (${reason}) -> ${coderLogFile()}`);
  console.log(`[Coder Server] ${exe} ${args.join(' ')}`);
  let child: ChildProcess;
  try {
    child = spawn(exe, args, {
      cwd: path.dirname(exe),
      stdio: ['ignore', logFd ?? 'ignore', logFd ?? 'ignore'],
      windowsHide: true,
      detached: false
    });
  } catch (err: any) {
    closeLog();
    emitCoderEvent('error', `Spawn failed: ${err?.message || err}`);
    return false;
  }
  coderChild = child;
  coderLastActiveAt = Date.now();
  trackChild(child, 'coder');
  agent.markCoderServerStarting();
  emitCoderEvent('starting', `Loading ${path.basename(model)} (ctx ${cfg.ctx ?? 65536})`);
  child.on('exit', (code, sig) => {
    const detail = `Coder server exited (code ${code ?? sig}). See ${coderLogFile()}`;
    console.log(`[Coder Server] ${detail}`);
    if (coderChild === child) coderChild = null;
    closeLog();
    agent.clearCoderStarting();
    if (!quitting) {
      emitCoderEvent('exited', detail);
      agent.probeLocalEngines(true).catch(() => {});
    }
  });
  child.on('error', (err) => {
    console.warn('[Coder Server] Spawn failed:', err.message);
    if (coderChild === child) coderChild = null;
    closeLog();
    agent.clearCoderStarting();
    emitCoderEvent('error', `Spawn failed: ${err.message}`);
  });
  return true;
}

agent.onCoderNeeded = (reason) => startCoderServer(reason).catch(err => {
  console.warn('[Coder Server] start failed:', err?.message);
  return false;
});
agent.coderChildPid = () => (coderChild && coderChild.exitCode === null && coderChild.pid) ? coderChild.pid : null;

function startCoderServerIfDown() {
  if (quitting) return;
  fetch('http://127.0.0.1:8080/health', { signal: AbortSignal.timeout(1200) })
    .then(res => {
      if (!res.ok) throw new Error(`health ${res.status}`);
      // Up already (a previous instance or the .bat): adopted, not recorded anywhere.
      agent.probeLocalEngines(true).catch(() => {});
    })
    .catch(() => startCoderServer('app-start').catch(err => console.warn('[Coder Server] start failed:', err?.message)));
}

// One instance: a second launch used to open a second window whose quit
// killed the first one's coder server. Now it just focuses the first.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    await createWindow();

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

    // Coder server: lazy by default (first coding prompt, see
    // agent.onCoderNeeded). Only `coderAutoStart: true` starts it at launch,
    // and then only once the UI is on screen and responsive.
    if (agent.providerConfig.coderAutoStart === true) {
      if (mainWindow) {
        mainWindow.webContents.once('did-finish-load', () => {
          setTimeout(startCoderServerIfDown, 3000);
        });
      } else {
        setTimeout(startCoderServerIfDown, 6000);
      }
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  }).catch((err: any) => {
    console.error('[Startup] failed:', err);
    try { dialog.showErrorBox('Strata Code failed to start', String(err?.stack || err?.message || err)); } catch {}
    app.exit(1);
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * Bounded shutdown (shared Strata shape): everything async and time-capped,
 * nothing synchronous that blocks the loop, the whole thing raced against 5 s.
 *  1. stop the run (aborts the model fetch, tree-kills tool commands)
 *  2. flush the live-session write queue
 *  3. in parallel: Ollama keep_alive:0 per the sibling rule (2 s), tree-kill
 *     the coder + every tracked child (3 s)
 *  4. delete our presence file (after the unloads, which rewrite it).
 */
async function shutdown(): Promise<void> {
  const stopRun = agent.stop();
  await Promise.race([agent.flushLiveDialogue(), sleep(1500)]).catch(() => {});
  await Promise.all([
    stopRun,
    agent.releaseOllamaVramAtQuit(2000).catch(() => []),
    (async () => {
      const own = coderChild?.pid;
      coderChild = null;
      if (own) await killTree(own, 3000);
      await killTrackedChildren(undefined, 3000);
      // Servers started outside this app on the coder port (the .bat, a
      // previous crashed instance) are ours by definition - by command line,
      // never by a pid file.
      try {
        const pids = await agent.findCoderServerPids();
        await Promise.all(pids.filter(p => p !== own).map(p => killTree(p, 3000)));
      } catch {}
    })()
  ]);
  // Last, after the unloads: each unload rewrites the presence file, so
  // deleting it in parallel left a {pid: <dead>, models: []} file behind.
  deletePresence();
}

app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  Promise.race([shutdown().catch(err => console.warn('[Shutdown]', err?.message)), sleep(5000)])
    .finally(() => { deletePresence(); app.quit(); });
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
// The renderer reports whether any editor buffer is dirty, so the 'close'
// handler can prompt before discarding it.
ipcMain.on('window:set-dirty', (_event, dirty: boolean) => {
  rendererDirty = !!dirty;
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
    rememberWorkspace(currentWorkspace);
    return currentWorkspace;
  }
  return null;
});

// The renderer used to hard-code the developer's workspace as its initial
// state; another machine has no such folder. It now asks.
ipcMain.handle('workspace:get-current', async () => ({
  workspace: currentWorkspace,
  installRoot: installRoot(),
  runtimeDir: runtimeDir(),
  modelsDir: modelsDir(),
  coderModel: coderModelPath()
}));

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
  if (coderModelPath()) {
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
  const ggufPath = coderModelPath();
  if (ggufPath && fs.existsSync(ggufPath)) {
    try {
      const stats = fs.statSync(ggufPath);
      const quant = (path.basename(ggufPath).match(/(Q\d_K(?:_[MSL]|_XL)?|Q\d_\d|IQ\d_\w+|BF16|F16)/i) || ['Q6_K'])[0];
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
          quantization_level: `${quant} (FlashAttention)`
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
// =============================================================================
// TESTER LICENSE AGREEMENT
//
// The agent modifies files and runs commands. Nothing runs until the user has
// accepted EULA.md - either in the installer (which records acceptance in
// userData) or in the app's first-launch dialog. Acceptance is keyed to a hash
// of the agreement text, so a changed agreement is shown again.
// =============================================================================
function agreementPath(): string {
  return path.join(app.getAppPath(), 'EULA.md');
}
function agreementText(): string {
  try { return fs.readFileSync(agreementPath(), 'utf-8').replace(/^﻿/, ''); } catch { return ''; }
}
function agreementVersion(text: string): string {
  return createHash('sha256').update(text.replace(/\r/g, ''), 'utf8').digest('hex').slice(0, 16);
}
function acceptanceFile(): string {
  return path.join(app.getPath('userData'), 'agreement.json');
}
function agreementState() {
  const text = agreementText();
  const version = text ? agreementVersion(text) : '';
  let accepted = false;
  let acceptedAt: string | undefined;
  try {
    const rec = JSON.parse(fs.readFileSync(acceptanceFile(), 'utf-8').replace(/^﻿/, ''));
    accepted = !!version && rec?.version === version;
    acceptedAt = rec?.acceptedAt;
  } catch {}
  return { text, version, accepted, acceptedAt, available: !!text };
}

ipcMain.handle('legal:get-agreement', async () => agreementState());

ipcMain.handle('legal:accept', async () => {
  const st = agreementState();
  if (!st.available) return { success: false, error: 'Agreement text is missing from this build.' };
  try {
    fs.mkdirSync(path.dirname(acceptanceFile()), { recursive: true });
    fs.writeFileSync(acceptanceFile(), JSON.stringify({
      version: st.version,
      acceptedAt: new Date().toISOString(),
      acceptedIn: 'app',
      appVersion: app.getVersion(),
      user: os.userInfo().username,
      machine: os.hostname()
    }, null, 2));
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('legal:decline', async () => {
  console.log('[Legal] Agreement declined; quitting.');
  setTimeout(() => app.quit(), 200);
  return { success: true };
});

ipcMain.handle('agent:start', async (_e, prompt: string, model: string, autoMode: boolean, taskMode: string = 'coding', editorContext?: any, images?: string[]) => {
  const legal = agreementState();
  if (legal.available && !legal.accepted) {
    return { started: false, error: 'The License Agreement has not been accepted. Accept it to use the agent.' };
  }
  if (quitting) return { started: false, error: 'Strata Code is quitting.' };
  void agent.run(prompt, model, autoMode, taskMode, editorContext, images);
  return { started: true };
});

ipcMain.handle('agent:stop', async () => {
  // Aborts the model fetch and tree-kills every tool command still running.
  await agent.stop();
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
    const targetModel = model || 'qwen3.8:27b';
    // Ownership recorded at send time; presence file updated for siblings.
    agent.noteOllamaLoad(targetModel);
    const res = await fetch('http://127.0.0.1:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: targetModel,
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false,
        think: false,
        // Same keep_alive as every other Strata request: without it this call reset the model to Ollama's
        // default, expiring what the chat path (and Strata Photo) had just asked for.
        keep_alive: OLLAMA_KEEP_ALIVE,
        // Same context as the chat path and as Strata Photo: without it Ollama used its own default (65536 on
        // 0.34) and rebuilt the runner on every switch between Ctrl+K and the chat.
        options: { num_ctx: OLLAMA_NUM_CTX }
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
  if (quitting) return { stdout: '', stderr: 'Strata Code is quitting.', exitCode: 1 };
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const TIMEOUT_MS = 120000;
    const opts = {
      cwd: currentWorkspace,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    };
    // The bound is our own timer with a tree-kill (Node's `timeout` only
    // reached powershell.exe, not the node/python it had started), and the
    // child is tracked so quit takes it down too.
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (error: any, stdout: string, stderr: string) => {
      if (timer) clearTimeout(timer);
      const killed = timedOut || (child as any).strataKilled === true || !!(error && error.killed);
      resolve({
        stdout: stdout || '',
        stderr: timedOut
          ? `${stderr || ''}\n[TIMEOUT] Command exceeded 120s; its whole process tree was terminated.`.trim()
          : killed
            ? `${stderr || ''}\n[STOPPED] Command was terminated.`.trim()
            : (stderr || (error ? error.message : '')),
        exitCode: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0)
      });
    };
    let child: ChildProcess;
    if (isWin) {
      // -NoProfile avoids re-loading the user's PowerShell profile on every command.
      const prefix = '$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
      child = execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', prefix + command], opts, done);
    } else {
      child = exec(command, { ...opts, shell: '/bin/bash' }, done);
    }
    trackChild(child, 'terminal');
    timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid).then(() => { try { child.kill(); } catch {} });
    }, TIMEOUT_MS);
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
ipcMain.handle('engine:status', async (_e, force?: boolean) => {
  try {
    const status = await agent.probeLocalEngines(force === true);
    return { success: true, status: { ...status, coderManaged: coderChild !== null, coderLog: coderLogFile() } };
  } catch (err: any) {
    return { success: false, error: err.message, status: null };
  }
});

// User-initiated only: evict everything from Ollama (including another app's
// model) and start the coder server.
ipcMain.handle('engine:take-gpu', async () => {
  if (quitting) return { success: false, error: 'quitting' };
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
    console.log(`[Shell] open external: ${url}`);
    shell.openExternal(url);
    return { success: true };
  }
  return { success: false, error: 'Invalid URL' };
});


