import React, { useEffect, useRef, useState } from 'react';
import { ShieldAlert, ScrollText } from 'lucide-react';

interface AgreementModalProps {
  text: string;
  version: string;
  onAccept: () => Promise<void> | void;
  onDecline: () => Promise<void> | void;
}

/**
 * First-launch License Agreement. Blocks the whole UI until accepted;
 * Decline quits the app. The agreement is Markdown, rendered here as plain
 * structured text (headings and paragraphs) - no markdown library needed.
 */
const AgreementModalInner: React.FC<AgreementModalProps> = ({ text, version, onAccept, onDecline }) => {
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const check = () => {
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 24) setScrolledToEnd(true);
    };
    check();
    el.addEventListener('scroll', check);
    return () => el.removeEventListener('scroll', check);
  }, []);

  const blocks = text.replace(/\r/g, '').split('\n');

  return (
    <div className="fixed inset-0 z-[100] bg-studio-bg/95 backdrop-blur-sm flex items-center justify-center select-text" data-testid="agreement-modal">
      <div className="w-[760px] max-w-[94vw] h-[86vh] flex flex-col rounded-modal border border-studio-border bg-studio-surface shadow-panel">
        <div className="px-5 py-3 border-b border-studio-border flex items-center gap-3">
          <ShieldAlert size={18} className="text-state-warn-400" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-studio-text">License Agreement</div>
            <div className="text-micro text-studio-muted">Please read it. The agent can modify files and run commands in the folders you open. Version {version}</div>
          </div>
          <ScrollText size={16} className="text-studio-subtle" />
        </div>

        <div ref={bodyRef} className="flex-1 overflow-y-auto px-6 py-4 text-xs leading-relaxed text-studio-text" data-testid="agreement-body">
          {blocks.map((line, i) => {
            if (/^# /.test(line)) return <h1 key={i} className="text-base font-bold mt-2 mb-3 text-studio-text">{line.slice(2)}</h1>;
            if (/^## /.test(line)) return <h2 key={i} className="text-sm font-semibold mt-5 mb-2 text-role-architect-300">{line.slice(3)}</h2>;
            if (/^---\s*$/.test(line)) return <hr key={i} className="my-4 border-studio-border" />;
            if (!line.trim()) return <div key={i} className="h-2" />;
            const isBullet = /^- /.test(line);
            const content = isBullet ? line.slice(2) : line;
            // **bold** spans only; everything else literal.
            const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
              /^\*\*[^*]+\*\*$/.test(p) ? <strong key={j} className="font-semibold text-studio-text">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>
            );
            return isBullet
              ? <div key={i} className="pl-4 relative mb-1"><span className="absolute left-0">•</span>{parts}</div>
              : <p key={i} className="mb-1.5">{parts}</p>;
          })}
        </div>

        <div className="px-5 py-3 border-t border-studio-border flex items-center gap-4">
          <label className={`flex items-center gap-2 text-xs ${scrolledToEnd ? 'text-studio-text' : 'text-studio-subtle'}`}>
            <input
              type="checkbox"
              data-testid="agreement-checkbox"
              checked={checked}
              disabled={!scrolledToEnd}
              onChange={e => setChecked(e.target.checked)}
              className="accent-role-worker-500"
            />
            I have read and agree to the License Agreement
            {!scrolledToEnd && <span className="text-micro text-studio-subtle">(scroll to the end first)</span>}
          </label>
          <div className="flex-1" />
          <button
            data-testid="agreement-decline"
            onClick={async () => { setBusy(true); await onDecline(); }}
            disabled={busy}
            className="px-3 py-1.5 rounded-control border border-studio-border text-xs text-studio-muted hover:text-studio-text hover:bg-studio-panel disabled:opacity-50"
          >
            Decline and quit
          </button>
          <button
            data-testid="agreement-accept"
            onClick={async () => { setBusy(true); await onAccept(); setBusy(false); }}
            disabled={!checked || busy}
            className="px-4 py-1.5 rounded-control bg-role-worker-600/30 border border-role-worker-500/50 text-xs font-medium text-role-worker-200 hover:bg-role-worker-600/45 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
};

export const AgreementModal = React.memo(AgreementModalInner);
