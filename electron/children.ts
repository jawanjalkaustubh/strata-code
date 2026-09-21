import { ChildProcess, execFile } from 'child_process';

/**
 * Every child process this app spawns for a job - agent tool commands, the
 * terminal drawer, the coder server - is registered here so it can be
 * tree-killed on its own timeout, on user Stop and at quit.
 *
 * Node's `timeout` option and `child.kill()` only reach the DIRECT child
 * (powershell.exe / the shell); whatever it started (node, python, a dev
 * server) lived on. On Windows `taskkill /PID <pid> /T /F` takes the whole
 * tree; on macOS and Linux the tree is walked with `pgrep -P` and every pid
 * gets SIGKILL, children first. Both asynchronous so the quit path never
 * blocks the event loop.
 */
export type ChildKind = 'tool' | 'terminal' | 'coder';

interface Tracked { child: ChildProcess; kind: ChildKind }

export const liveChildren = new Set<Tracked>();

export function trackChild(child: ChildProcess, kind: ChildKind): void {
  if (!child || typeof child.pid !== 'number') return;
  const entry: Tracked = { child, kind };
  liveChildren.add(entry);
  const drop = () => liveChildren.delete(entry);
  child.once('exit', drop);
  child.once('error', drop);
}

/** Tree-kill one pid. Resolves (never rejects) within `boundMs`. */
export function killTree(pid: number | undefined | null, boundMs = 3000): Promise<void> {
  if (!pid || !Number.isFinite(pid)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    const timer = setTimeout(finish, boundMs);
    try {
      if (process.platform === 'win32') {
        execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: boundMs }, () => {
          clearTimeout(timer);
          finish();
        });
      } else {
        collectTree(pid, Math.max(250, boundMs - 500)).then((pids) => {
          // Deepest descendants first, then the root; every kill is best-effort.
          for (const p of pids.reverse()) { try { process.kill(p, 'SIGKILL'); } catch {} }
          clearTimeout(timer);
          finish();
        });
      }
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

/** Tree-kill every tracked child (optionally only one kind). Bounded; never rejects. */
export async function killTrackedChildren(kind?: ChildKind, boundMs = 3000): Promise<number[]> {
  const targets = Array.from(liveChildren).filter(t => !kind || t.kind === kind);
  const pids: number[] = [];
  await Promise.all(targets.map(async (t) => {
    const pid = t.child.pid;
    if (!pid) return;
    pids.push(pid);
    (t.child as any).strataKilled = true;
    await killTree(pid, boundMs);
    try { t.child.kill(); } catch {}
    liveChildren.delete(t);
  }));
  return pids;
}

/**
 * POSIX: `pid` followed by every descendant, breadth-first, via `pgrep -P`.
 * Falls back to just `pid` when pgrep is missing or the walk exceeds `boundMs`.
 */
function collectTree(pid: number, boundMs: number): Promise<number[]> {
  const deadline = Date.now() + boundMs;
  const out: number[] = [pid];
  const children = (parent: number): Promise<number[]> => new Promise((resolve) => {
    if (Date.now() > deadline) return resolve([]);
    try {
      execFile('pgrep', ['-P', String(parent)], { timeout: 1000 }, (_err, stdout) => {
        resolve(String(stdout || '').split(/\s+/).map(v => parseInt(v, 10)).filter(v => Number.isFinite(v) && v > 0));
      });
    } catch {
      resolve([]);
    }
  });
  return (async () => {
    let frontier = [pid];
    while (frontier.length && Date.now() < deadline) {
      const next: number[] = [];
      for (const p of frontier) {
        for (const c of await children(p)) if (!out.includes(c)) { out.push(c); next.push(c); }
      }
      frontier = next;
    }
    return out;
  })();
}
