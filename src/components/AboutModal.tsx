import React, { useEffect } from 'react';
import { X, Sparkles, Cpu, HardDrive, ShieldCheck, Code2, Zap, Bug, ExternalLink } from 'lucide-react';

import { SystemInfo } from '../types';
import { STRATA_ICON } from '../assets/logo';
import { SUPPORT, openExternal } from '../support';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedModel: string;
  systemInfo?: SystemInfo | null;
}

export const AboutModal: React.FC<AboutModalProps> = ({ 
  isOpen, 
  onClose, 
  selectedModel, 
  systemInfo
}) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in select-none">
      <div 
        className="relative w-full max-w-md bg-studio-surface border border-studio-border rounded-modal shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glow Header */}
        <div className="h-32 bg-gradient-to-br from-role-worker-950/40 via-state-info-950/30 to-studio-surface relative flex items-center justify-center border-b border-studio-border">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full hover:bg-studio-panel text-slate-400 hover:text-slate-200 transition"
          >
            <X size={16} />
          </button>

          <div className="flex flex-col items-center">
            <img 
              src={STRATA_ICON} 
              alt="Strata" 
              className="w-14 h-14 object-contain drop-shadow-[0_0_16px_rgba(45,212,191,0.5)] mb-1.5" 
            />
            <h2 className="text-lg font-extrabold tracking-wider bg-gradient-to-r from-role-worker-200 via-state-info-200 to-white bg-clip-text text-transparent">
              STRATA CODE
            </h2>
            <span className="text-micro text-role-worker-300/80 font-mono tracking-wide">
              v1.0.0 • 🛡️ 100% Sovereign Local AI Studio
            </span>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-5 space-y-4">
          {/* Creator Banner */}
          <div className="p-3 rounded-card bg-gradient-to-r from-role-worker-950/50 via-slate-900 to-state-info-950/50 border border-role-worker-500/30 flex items-center space-x-3 shadow-inner">
            <div className="w-10 h-10 rounded-card bg-role-worker-500/20 border border-role-worker-400/40 flex items-center justify-center text-role-worker-300 shadow-sm shadow-role-worker-500/20">
              <Code2 size={19} className="text-role-worker-300" />
            </div>
            <div>
              <div className="text-micro uppercase font-semibold tracking-wider text-role-worker-400">Created By</div>
              <div className="text-sm font-bold text-slate-100 tracking-wide">Kaustubh Jawanjal</div>
            </div>
          </div>

          {/* Specs / Engine details */}
          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between p-2 rounded-card bg-studio-panel/50 border border-studio-border">
              <div className="flex items-center space-x-2 text-slate-300">
                <Cpu size={14} className="text-state-ok-400" />
                <span>Acceleration</span>
              </div>
              <div className="text-right">
                <span className="font-mono text-slate-200 font-medium">{systemInfo?.gpu || 'Local GPU'}</span>
                {systemInfo?.vram && (
                  <span className="ml-1.5 text-micro text-state-ok-400 font-mono">({systemInfo.vram})</span>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded-card bg-studio-panel/50 border border-studio-border">
              <div className="flex items-center space-x-2 text-slate-300">
                <Sparkles size={14} className="text-role-architect-400" />
                <span>Active Model</span>
              </div>
              <span className="font-mono text-slate-200 font-medium">{selectedModel}</span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-card bg-studio-panel/50 border border-studio-border">
              <div className="flex items-center space-x-2 text-slate-300">
                <ShieldCheck size={14} className="text-role-user-400" />
                <span>Privacy Mode</span>
              </div>
              <span className="text-state-ok-400 font-semibold">100% Offline / Local ({systemInfo?.gpu || 'Local GPU'})</span>
            </div>
          </div>

          {/* Project links */}
          {(SUPPORT.projectUrl || SUPPORT.issuesUrl) && (
            <div className="flex items-center justify-center gap-4 text-micro" data-testid="about-links">
              {SUPPORT.projectUrl && (
                <button onClick={() => openExternal(SUPPORT.projectUrl)} className="flex items-center gap-1 text-slate-300 hover:text-white" title={SUPPORT.projectUrl}>
                  <ExternalLink size={12} /> Project page
                </button>
              )}
              {SUPPORT.issuesUrl && (
                <button onClick={() => openExternal(SUPPORT.issuesUrl)} className="flex items-center gap-1 text-slate-300 hover:text-white" title={SUPPORT.issuesUrl}>
                  <Bug size={12} /> Report a problem
                </button>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="pt-2 text-center text-micro text-slate-400">
            Powered by 100% offline local GPU inference & Monaco Editor engine.
          </div>
        </div>
      </div>
    </div>
  );
};
