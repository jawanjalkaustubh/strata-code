import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as electron from 'electron';

/**
 * Every machine-specific location the app needs, resolved in one place.
 *
 * Resolution order for each: environment override → the packaged layout
 * (relative to the folder holding Strata Code.exe) → the developer layout
 * on the original workstation (C:\AI_dev, D:\AntiGravity). The dev fallbacks
 * keep `npm start` working unchanged; an extracted zip never touches
 * them.
 *
 * Packaged layout:
 *   <root>\Strata Code.exe
 *   <root>\runtime\llama.cpp\llama-server.exe (+ DLLs, launch-server-8080.ps1)
 *   <root>\runtime\coder-config.json         written by the installer
 *   <root>\models\*.gguf                     downloaded by the installer
 */

const app: any = (electron as any).app;

function exists(p: string | undefined | null): p is string {
  try { return !!p && fs.existsSync(p); } catch { return false; }
}

function firstExisting(candidates: (string | undefined)[]): string | null {
  for (const c of candidates) if (exists(c)) return c;
  return null;
}

/** Folder that contains the executable (packaged) or the project root (dev). */
export function installRoot(): string {
  if (process.env.STRATA_INSTALL_ROOT && exists(process.env.STRATA_INSTALL_ROOT)) return process.env.STRATA_INSTALL_ROOT;
  if (app && app.isPackaged) return path.dirname(process.execPath);
  // dev (`electron .`): the folder holding package.json. Not __dirname - the
  // main bundle is an ES module, where __dirname does not exist; the first
  // version threw a ReferenceError here and the dev app silently never
  // started its coder server.
  if (app && typeof app.getAppPath === 'function') {
    try { return app.getAppPath(); } catch {}
  }
  return process.cwd();
}

export function isPackaged(): boolean {
  return !!(app && app.isPackaged);
}

/** Directory holding llama-server.exe and the launch script. */
export function runtimeDir(): string | null {
  return firstExisting([
    process.env.STRATA_RUNTIME_DIR,
    path.join(installRoot(), 'runtime', 'llama.cpp'),
    'C:\\AI_dev\\llama.cpp'
  ]);
}

export function coderLaunchScript(): string | null {
  const dir = runtimeDir();
  if (!dir) return null;
  const p = path.join(dir, 'launch-server-8080.ps1');
  return exists(p) ? p : null;
}

/** Directory the installer downloads GGUFs into. */
export function modelsDir(): string | null {
  const withGguf = (d: string | undefined) => {
    if (!exists(d)) return false;
    try { return fs.readdirSync(d).some(f => /\.gguf$/i.test(f)); } catch { return false; }
  };
  const candidates = [
    process.env.STRATA_MODELS_DIR,
    path.join(installRoot(), 'models'),
    'C:\\AI_dev\\models\\qwen3-coder'
  ];
  return candidates.find(withGguf) || firstExisting(candidates);
}

export interface CoderConfig {
  /** GGUF file name inside modelsDir, or an absolute path. */
  model?: string;
  /** Context window passed as -Ctx. */
  ctx?: number;
  /** Extra args appended verbatim to the launch script. */
  extraArgs?: string[];
}

/** Written by the installer according to the machine's VRAM. Absent on the dev machine. */
export function coderConfig(): CoderConfig {
  const p = path.join(installRoot(), 'runtime', 'coder-config.json');
  try {
    // PowerShell 5.1 writes UTF-8 with a BOM; JSON.parse rejects it.
    if (exists(p)) return JSON.parse(fs.readFileSync(p, 'utf-8').replace(/^﻿/, '')) as CoderConfig;
  } catch {}
  return {};
}

/** The GGUF the coder server will load. Prefers the configured file, then the largest GGUF present. */
export function coderModelPath(): string | null {
  const cfg = coderConfig();
  const dir = modelsDir();
  if (cfg.model) {
    const candidate = path.isAbsolute(cfg.model) ? cfg.model : (dir ? path.join(dir, cfg.model) : cfg.model);
    if (exists(candidate)) return candidate;
  }
  if (!dir) return null;
  try {
    const ggufs = fs.readdirSync(dir).filter(f => /\.gguf$/i.test(f));
    if (!ggufs.length) return null;
    // Split multi-part files (…-00001-of-00003.gguf): pick the first shard.
    ggufs.sort((a, b) => {
      const sa = fs.statSync(path.join(dir, a)).size;
      const sb = fs.statSync(path.join(dir, b)).size;
      return sb - sa;
    });
    const first = ggufs.find(f => /-00001-of-\d+\.gguf$/i.test(f)) || ggufs[0];
    return path.join(dir, first);
  } catch {
    return null;
  }
}

/** Arguments for `powershell -File <script> …` that start the coder with this install's model and context. */
export function coderLaunchArgs(): string[] | null {
  const script = coderLaunchScript();
  if (!script) return null;
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script];
  const model = coderModelPath();
  if (model) args.push('-Model', model);
  const cfg = coderConfig();
  if (cfg.ctx && Number.isFinite(cfg.ctx)) args.push('-Ctx', String(cfg.ctx));
  if (Array.isArray(cfg.extraArgs)) args.push(...cfg.extraArgs.map(String));
  return args;
}

/** Where the live dual-brain transcript is appended. */
export function liveSessionPath(): string {
  if (process.env.STRATA_LIVE_SESSION) return process.env.STRATA_LIVE_SESSION;
  if (app && typeof app.getPath === 'function') {
    try { return path.join(app.getPath('userData'), 'strata-live-session.md'); } catch {}
  }
  return path.join(os.tmpdir(), 'strata-live-session.md');
}

// ---------------------------------------------------------------------------
// Workspace persistence
// ---------------------------------------------------------------------------

function workspaceStateFile(): string | null {
  if (app && typeof app.getPath === 'function') {
    try { return path.join(app.getPath('userData'), 'workspace.json'); } catch {}
  }
  return null;
}

/** Last workspace the user opened, if it still exists; else a sensible default. */
export function defaultWorkspace(): string {
  const stateFile = workspaceStateFile();
  try {
    if (stateFile && exists(stateFile)) {
      const saved = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      if (exists(saved?.workspace)) return saved.workspace;
    }
  } catch {}
  // Developer workstation default; harmless when the folder does not exist.
  if (exists('D:\\AntiGravity\\strata')) return 'D:\\AntiGravity\\strata';
  const docs = path.join(os.homedir(), 'Documents');
  return exists(docs) ? docs : os.homedir();
}

export function rememberWorkspace(dir: string) {
  const stateFile = workspaceStateFile();
  if (!stateFile) return;
  try {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({ workspace: dir, savedAt: new Date().toISOString() }, null, 2));
  } catch {}
}
