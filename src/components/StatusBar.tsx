import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Cpu, HardDrive, Zap, CircleAlert } from 'lucide-react';

export interface EngineStatus {
  checkedAt: number;
  llamaServer: { up: boolean; alias?: string; nCtx?: number };
  ollamaLoaded: { name: string; vramBytes: number }[];
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

const StatusBarInner: React.FC<{ workspace?: string }> = ({ workspace }) => {
  const [status, setStatus] = useState<EngineStatus | null>(null);
  const [failed, setFailed] = useState(false);

  const poll = useCallback(async () => {
    const api = (window as any).api;
    if (!api?.getEngineStatus) return;
    try {
      const res = await api.getEngineStatus();
      if (res?.success && res.status) { setStatus(res.status); setFailed(false); }
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    poll();
    // The backend caches this probe for 10s, so polling at the same cadence
    // costs essentially nothing beyond one IPC round-trip.
    const t = setInterval(poll, 10000);
    return () => clearInterval(t);
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

  return (
    <div className="h-7 shrink-0 flex items-center gap-4 px-3 bg-studio-surface border-t border-studio-border text-micro font-mono text-studio-muted select-none">
      {/* --- coder engine --- */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span
          className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            serverUp ? 'bg-state-ok-400 animate-pulse-glow' : 'bg-studio-subtle'
          }`}
        />
        <Cpu size={11} className={serverUp ? 'text-role-worker-400' : 'text-studio-subtle'} />
        <span className={`truncate ${serverUp ? 'text-studio-text' : 'text-studio-subtle'}`}>
          {serverUp ? (status?.llamaServer.alias || 'llama-server') : 'llama-server offline'}
        </span>
        {serverUp && (
          <span className="text-studio-subtle shrink-0">
            :8080 · {fmtCtx(status?.llamaServer.nCtx)} ctx
          </span>
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
      <div className="flex items-center gap-1.5 shrink-0" title="Ollama models currently resident in VRAM">
        <HardDrive size={11} className={ollamaGiB > 0.1 ? 'text-role-architect-400' : 'text-studio-subtle'} />
        <span className={ollamaGiB > 0.1 ? 'text-studio-text' : 'text-studio-subtle'}>
          {ollamaGiB > 0.1
            ? `Ollama ${ollamaGiB.toFixed(1)} GiB · ${status?.ollamaLoaded.length}`
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
