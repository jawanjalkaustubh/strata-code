import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Sibling presence files - the one convention every Strata app (Photo, Code,
 * Video, Tune) writes and reads so they can share one Ollama daemon and one
 * GPU without evicting each other's models.
 *
 *   <strata data dir>\presence\<app>.json
 *   { "pid": 1234, "app": "code", "models": ["qwen3.8:27b"], "since": "<ISO>" }
 *
 * The data dir is %LOCALAPPDATA%\Strata on Windows, ~/Library/Application
 * Support/Strata on macOS and $XDG_DATA_HOME/Strata (~/.local/share/Strata) on
 * Linux; STRATA_DATA_DIR overrides it everywhere. Every Strata app resolves it
 * with this same function so the files land in one place.
 *
 * Written (tmp + rename) whenever this app sends a load request for an Ollama
 * model, updated when it unloads one, deleted at graceful quit. Readers list
 * the directory, drop entries whose pid is dead (and unlink them) or whose pid
 * is our own. A model listed by a live sibling is never unloaded by this app.
 */

export type StrataApp = 'photo' | 'code' | 'video' | 'tune';

export interface PresenceRecord {
  pid: number;
  app: StrataApp;
  models: string[];
  since: string;
}

export const THIS_APP: StrataApp = 'code';

const since = new Date().toISOString();

/** The per-user folder shared by every Strata app (presence files, downloaded GGUFs, coder config). */
export function strataDataDir(): string {
  if (process.env.STRATA_DATA_DIR) return process.env.STRATA_DATA_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Strata');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Strata');
  }
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'Strata');
}

export function presenceDir(): string {
  return path.join(strataDataDir(), 'presence');
}

function ownFile(): string {
  return path.join(presenceDir(), `${THIS_APP}.json`);
}

/** Ollama reports "name:tag"; a bare "name" is its ":latest". Compare case-insensitively. */
export function normalizeModelName(name: string): string {
  const n = (name || '').trim().toLowerCase();
  if (!n) return '';
  return n.includes(':') ? n : `${n}:latest`;
}

export function sameModel(a: string, b: string): boolean {
  return normalizeModelName(a) === normalizeModelName(b);
}

/** Set once the file has been deleted at quit (or logoff): a late unload must not resurrect it with a dead pid. */
let retired = false;

/** Atomic: written to a temp file next to the target and renamed over it. */
export function writePresence(models: Iterable<string>): void {
  if (retired) return;
  const record: PresenceRecord = {
    pid: process.pid,
    app: THIS_APP,
    models: Array.from(new Set(Array.from(models).filter(Boolean))),
    since
  };
  const file = ownFile();
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
    fs.renameSync(tmp, file);
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

export function deletePresence(): void {
  retired = true;
  try { fs.unlinkSync(ownFile()); } catch {}
}

/** `process.kill(pid, 0)` throws when the pid is not alive (or not ours to signal - treated as alive). */
export function pidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err?.code === 'EPERM';
  }
}

/** Live sibling apps (never ourselves). Stale files - dead pid, unparsable - are unlinked. */
export function readSiblingPresence(): PresenceRecord[] {
  const dir = presenceDir();
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out: PresenceRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(dir, name);
    let rec: PresenceRecord | null = null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf-8').replace(/^﻿/, ''));
      if (parsed && Number.isFinite(parsed.pid) && typeof parsed.app === 'string') {
        rec = {
          pid: Number(parsed.pid),
          app: parsed.app,
          models: Array.isArray(parsed.models) ? parsed.models.map(String) : [],
          since: String(parsed.since || '')
        };
      }
    } catch {}
    if (!rec) {
      try { fs.unlinkSync(file); } catch {}
      continue;
    }
    if (rec.pid === process.pid) continue;
    if (name === `${THIS_APP}.json`) {
      // A previous instance of this app: only meaningful while its pid lives.
      if (!pidAlive(rec.pid)) { try { fs.unlinkSync(file); } catch {} }
      continue;
    }
    if (!pidAlive(rec.pid)) {
      try { fs.unlinkSync(file); } catch {}
      continue;
    }
    out.push(rec);
  }
  return out;
}

/** Live siblings whose presence lists `model`. */
export function siblingsHolding(model: string, siblings: PresenceRecord[] = readSiblingPresence()): PresenceRecord[] {
  return siblings.filter(s => s.models.some(m => sameModel(m, model)));
}

export function appLabel(app: string): string {
  switch (app) {
    case 'photo': return 'Strata Photo';
    case 'code': return 'Strata Code';
    case 'video': return 'Strata Video';
    case 'tune': return 'Strata Tune';
    default: return `Strata ${app}`;
  }
}
