import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Cpu, HardDrive, Zap, CircleAlert } from 'lucide-react';

export interface EngineStatus {
  checkedAt: number;
  llamaServer: { up: boolean; loading?: boolean; alias?: string; nCtx?: number; pid?: number };
  ollamaLoaded: { name: string; vramBytes: number }[];
  /** Ollama models another app loaded; Strata never evicts these on its own. */
  foreignOllama?: { name: string; vramBytes: number; heldBy?: string }[];
  /** Set when the coder is down and a foreign model leaves too little VRAM to start it, e.g. "Strata Photo (qwen3.8:27b)". */
  coderBlockedBy?: string;
  /** Live sibling Strata apps (presence files). */
  siblings?: { app: string; pid: number; models: string[] }[];
  /** True when this app instance spawned the coder server and will stop it on quit. */
  coderManaged?: boolean;
  coderLog?: string;
  gpu?: { totalMiB: number; usedMiB: number; freeMiB: number };
}

const MIB_PER_GIB = 1024;

/** Headroom a real-time renderer needs alongside the model, in GiB. */
const RENDERER_RESERVE_GIB = 4;

function fmtCtx(n?: number): string {
  if (!n) return '—';
  return n >= 1024 ? `${Math.round(n / 1024)}K` : String(n);
}

type VramTone = 'ok' | 'warn' | 'danger';
interface VramView { usedGiB: number; totalGiB: number; freeGiB: number; pct: number; tone: VramTone }

type CoderEvent = { kind: 'starting' | 'up' | 'exited' | 'error' | 'stopped'; detail: string };

/** One tooltip for the family's evict-all button (Photo, Code and Video use the same words). */
const FREE_GPU_TIP = 'Unload every AI model from the graphics card, including one another Strata app is using (it reloads the model when it next needs it). Never done automatically.';

const StatusBarInner: React.FC<{ workspace?: string }> = ({ workspace }) => {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [failed, setFailed] = useState(false);
  // Last lifecycle push from the main process: why the coder is offline
  // (missing binary, no model, exited with a code, GPU held by a sibling).
  const [coderEvent, setCoderEvent] = useState<CoderEvent | null>(null);
  // While a sibling holds the GPU the poll forces a fresh probe every 10 s, so
  // the block clears within seconds of that app releasing its model.
  const blockedRef = useRef(false);

  const poll = useCallback(async () => {
    const api = (window as any).api;
    if (!api?.getEngineStatus) return;
    try {
      const res = await api.getEngineStatus(blockedRef.current);
      if (res?.success && res.status) {
        setStatus(res.status);
        setFailed(false);
        // A "GPU held by" event is only true while the probe still reports a holder.
        setCoderEvent(ev => ev && /^GPU held by /.test(ev.detail || '') && !res.status.coderBlockedBy ? null : ev);
      }
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    poll();
    // The backend caches this probe for 30 s while no run is active (10 s
    // during one) and skips its process scans at idle; coder lifecycle
    // changes are pushed, so a slow poll loses nothing.
    const t = setInterval(poll, 30000);
    const fast = setInterval(() => { if (blockedRef.current) poll(); }, 10000);
    const api = (window as any).api;
    const unsub = api?.onCoderEvent?.((ev: CoderEvent) => {
      setCoderEvent(ev);
      // Re-probe shortly after: the process has just appeared or gone.
      setTimeout(poll, 500);
    });
    return () => { clearInterval(t); clearInterval(fast); if (typeof unsub === 'function') unsub(); };
  }, [poll]);

  const vram: VramView | null = useMemo<VramView | null>(() => {
    const g = status?.gpu;
    if (!g || !g.totalMiB) return null;
    const usedGiB = g.usedMiB / MIB_PER_GIB;
    const totalGiB = g.totalMiB / MIB_PER_GIB;
    const freeGiB = g.freeMiB / MIB_PER_GIB;
    const pct = Math.min(100, Math.round((g.usedMiB / g.totalMiB) * 100));
    // Tone is driven by absolute headroom, not percentage: what matters is
    // whether anything else — a second model, or a game renderer — still fits.
    const tone: VramTone =
      freeGiB >= RENDERER_RESERVE_GIB ? 'ok' : freeGiB >= 1.5 ? 'warn' : 'danger';
    return { usedGiB, totalGiB, freeGiB, pct, tone };
  }, [status]);

  const ollamaGiB = useMemo(
    () => (status?.ollamaLoaded || []).reduce((a: number, m: { vramBytes: number }) => a + (m.vramBytes || 0), 0) / (1024 ** 3),
    [status]
  );

  const barTone: Record<VramTone, string> = {
    ok:     'bg-state-ok-500',
    warn:   'bg-state-warn-500',
    danger: 'bg-state-danger-500'
  };
  const textTone: Record<VramTone, string> = {
    ok:     'text-state-ok-400',
    warn:   'text-state-warn-400',
    danger: 'text-state-danger-400'
  };

  const serverUp = status?.llamaServer.up;
  const serverLoading = !serverUp && status?.llamaServer.loading;
  const blockedBy = !serverUp && !serverLoading ? status?.coderBlockedBy : undefined;
  const foreign = status?.foreignOllama || [];
  blockedRef.current = !!blockedBy;

  const [busy, setBusy] = useState<'take' | 'stop' | null>(null);
  const takeGpu = useCallback(async () => {
    const api = (window as any).api;
    if (!api?.takeGpu || busy) return;
    setBusy('take');
    try { await api.takeGpu(); } catch {}
    setBusy(null);
    poll();
  }, [busy, poll]);
  const stopCoder = useCallback(async () => {
    const api = (window as any).api;
    if (!api?.stopCoderServer || busy) return;
    setBusy('stop');
    try { await api.stopCoderServer(); } catch {}
    setBusy(null);
    poll();
  }, [busy, poll]);

  // A failure pushed by the main process explains an offline coder.
  const coderFailure = !serverUp && !serverLoading && coderEvent && (coderEvent.kind === 'error' || coderEvent.kind === 'exited')
    ? coderEvent.detail : '';
  const coderLabel = serverUp
    ? (status?.llamaServer.alias || 'llama-server')
    : serverLoading ? 'coder loading…'
    : blockedBy ? 'coder blocked'
    : coderFailure ? 'coder failed'
    : 'coder offline';
  const coderTitle = serverUp
    ? `Coder server on :8080${status?.coderManaged ? ' — started by this app; stops when idle or when the app closes' : ' — started outside the app; stops when the app closes'}${status?.coderLog ? `\nLog: ${status.coderLog}` : ''}`
    : serverLoading ? 'The coder server is reading its model into VRAM (typically 10–60 s). Prompts sent now wait for it.'
    : blockedBy ? `GPU held by ${blockedBy}. "Free GPU" unloads it and starts the coder; the other app reloads its model when it next needs it. Clears itself when that app releases the model.`
    : coderFailure ? coderFailure
    : 'No coder server yet. It starts on the first coding prompt (26 GB, 10–60 s) and stops again after the idle timeout.';

  return (
    <div className="h-7 shrink-0 flex items-center gap-4 px-3 bg-studio-surface border-t border-studio-border text-micro font-mono text-studio-muted select-none">
      {/* --- coder engine --- */}
      <div className="flex items-center gap-1.5 min-w-0" title={coderTitle}>
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            serverUp ? 'bg-state-ok-400 animate-pulse-glow'
            : serverLoading ? 'bg-state-warn-400 animate-pulse'
            : blockedBy ? 'bg-state-danger-400'
            : 'bg-studio-subtle'
          }`}
        />
        <Cpu size={11} className={serverUp ? 'text-role-worker-400' : serverLoading ? 'text-state-warn-400' : blockedBy ? 'text-state-danger-400' : 'text-studio-subtle'} />
        <span className={`truncate ${serverUp ? 'text-studio-text' : serverLoading ? 'text-state-warn-400' : blockedBy ? 'text-state-danger-400' : 'text-studio-subtle'}`}>
          {coderLabel}
        </span>
        {serverUp && (
          <span className="text-studio-subtle shrink-0">
            :8080 · {fmtCtx(status?.llamaServer.nCtx)} ctx
          </span>
        )}
        {!serverUp && !serverLoading && (blockedBy || coderFailure) && (
          <span className="truncate max-w-[360px] text-studio-subtle" title={blockedBy ? `GPU held by ${blockedBy}` : coderFailure}>
            {blockedBy ? `GPU held by ${blockedBy}` : coderFailure}
          </span>
        )}
        {(blockedBy || (!serverLoading && foreign.length > 0)) && (
          <button
            onClick={takeGpu}
            disabled={busy !== null}
            className="ml-1 px-1.5 py-0.5 rounded-control border border-state-danger-500/40 bg-state-danger-500/10 text-state-danger-300 hover:bg-state-danger-500/20 disabled:opacity-50 shrink-0"
            title={`${FREE_GPU_TIP}\nHere: unload ${foreign.map(f => f.heldBy ? `${f.name} (${f.heldBy})` : f.name).join(', ')} and start the coder server.`}
          >
            {busy === 'take' ? 'Freeing…' : 'Free GPU'}
          </button>
        )}
        {serverUp && (
          <button
            onClick={stopCoder}
            disabled={busy !== null}
            className="ml-1 px-1.5 py-0.5 rounded-control border border-studio-border text-studio-subtle hover:text-studio-text hover:bg-studio-panel disabled:opacity-50 shrink-0"
            title="Stop the coder server and release its VRAM (it starts again on the next coding prompt)"
          >
            {busy === 'stop' ? 'stopping…' : 'stop'}
          </button>
        )}
      </div>

      <span className="w-px h-3.5 bg-studio-border shrink-0" />

      {/* --- VRAM --- */}
      {vram ? (
        <div className="flex items-center gap-2 min-w-0" title={`${vram.freeGiB.toFixed(1)} GiB free of ${vram.totalGiB.toFixed(1)} GiB`}>
          <Zap size={11} className={textTone[vram.tone]} />
          <div className="w-24 h-1.5 rounded-full bg-studio-bg overflow-hidden shrink-0">
            <div
              className={`h-full ${barTone[vram.tone]} transition-[width] duration-500`}
              style={{ width: `${vram.pct}%` }}
            />
          </div>
          <span className="text-studio-text shrink-0">
            {vram.usedGiB.toFixed(1)}/{vram.totalGiB.toFixed(1)} GiB
          </span>
          <span className={`${textTone[vram.tone]} shrink-0`}>
            {vram.freeGiB.toFixed(1)} free
          </span>
          {vram.tone !== 'ok' && (
            <span
              className="flex items-center gap-1 text-state-warn-400 shrink-0"
              title={`Under ${RENDERER_RESERVE_GIB} GiB free — not enough headroom for a game renderer or a second model alongside this one.`}
            >
              <CircleAlert size={10} /> low headroom
            </span>
          )}
        </div>
      ) : (
        <span className="text-studio-subtle">{failed ? 'GPU telemetry unavailable' : 'reading GPU…'}</span>
      )}

      <span className="w-px h-3.5 bg-studio-border shrink-0" />

      {/* --- Ollama --- */}
      <div
        className="flex items-center gap-1.5 shrink-0"
        title={
          (status?.ollamaLoaded || []).length
            ? `Resident in Ollama: ${status!.ollamaLoaded.map(m => `${m.name} (${(m.vramBytes / 1024 ** 3).toFixed(1)} GiB)`).join(', ')}${foreign.length ? `\nNot loaded by this app: ${foreign.map(f => f.heldBy ? `${f.name} — held by ${f.heldBy}` : f.name).join(', ')}` : ''}`
            : 'Ollama models currently resident in VRAM'
        }
      >
        <HardDrive size={11} className={foreign.length ? 'text-state-warn-400' : ollamaGiB > 0.1 ? 'text-role-architect-400' : 'text-studio-subtle'} />
        <span className={foreign.length ? 'text-state-warn-400' : ollamaGiB > 0.1 ? 'text-studio-text' : 'text-studio-subtle'}>
          {ollamaGiB > 0.1
            ? `Ollama ${ollamaGiB.toFixed(1)} GiB · ${status?.ollamaLoaded.length}${foreign.length ? ' · other app' : ''}`
            : 'Ollama idle'}
        </span>
      </div>

      <div className="flex-1" />

      <span className="truncate max-w-[280px] text-studio-subtle" title={workspace}>
        {workspace}
      </span>
      <span className="text-state-ok-400 shrink-0">$0.00 · offline</span>
    </div>
  );
};

export const StatusBar = React.memo(StatusBarInner);
