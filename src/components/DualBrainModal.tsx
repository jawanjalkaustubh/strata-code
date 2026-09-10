import React, { useState } from 'react';
import { X, Sparkles, Check, Cpu, ShieldCheck, Zap } from 'lucide-react';

export interface LocalModelSpec {
  id: string;
  name: string;
  role: 'architect' | 'coder' | 'dual';
  description: string;
  badge?: string;
  port?: string;
  speed?: string;
  vram?: string;
}

export const LOCAL_DUAL_BRAIN_SPECS: LocalModelSpec[] = [
  {
    id: 'qwen3.8:27b',
    name: 'Qwen 3.8 (27B Dense) — General Architect',
    role: 'architect',
    description: 'High-level architectural blueprint planning, system invariants, prompt decomposition, and final sign-off verification.',
    badge: 'LEAD ARCHITECT • OLLAMA',
    port: 'Port 11434',
    speed: '~45 tok/s',
    vram: '~18 GB'
  },
  {
    id: 'Qwen3-Coder-30B-A3B-Instruct',
    name: 'Qwen3-Coder (30B MoE) — Specialist Coder Worker',
    role: 'coder',
    description: 'Autonomous tool execution, exact line-by-line file edits, fast compilation cycles, and bash commands.',
    badge: 'AUTONOMOUS WORKER • 237 TOK/S',
    port: 'Port 8080 (llama-server)',
    speed: '237 tok/s (FlashAttention)',
    vram: '~26.5 GB'
  },
  {
    id: 'qwen2.5-coder:32b',
    name: 'Qwen 2.5 Coder (32B Dense)',
    role: 'coder',
    description: 'Alternative local coder model on Ollama. Deep TypeScript, Python, C++, and React mastery.',
    badge: 'LOCAL OLLAMA',
    port: 'Port 11434',
    speed: '~38 tok/s',
    vram: '~20 GB'
  },
  {
    id: 'deepseek-r1:32b',
    name: 'DeepSeek R1 (32B Reasoning)',
    role: 'architect',
    description: 'Deep mathematical and algorithmic chain-of-thought reasoning for complex architectural bottlenecks.',
    badge: 'REASONING ARCHITECT',
    port: 'Port 11434',
    speed: '~35 tok/s',
    vram: '~20 GB'
  }
];

export interface DualBrainModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeArchitectModel: string;
  onSelectArchitectModel: (modelId: string) => void;
  activeLocalModel?: string;
  onSelectLocalModel?: (modelId: string) => void;
  installedLocalModels?: string[];
  isHybrid?: boolean;
}

export const DualBrainModal: React.FC<DualBrainModalProps> = ({
  isOpen,
  onClose,
  activeArchitectModel,
  onSelectArchitectModel,
  activeLocalModel,
  onSelectLocalModel,
  installedLocalModels = [],
  isHybrid = false
}) => {
  const [activeTab, setActiveTab] = useState<'architect' | 'coder'>('architect');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div 
        className="bg-studio-surface border border-studio-border rounded-modal w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-studio-border flex items-center justify-between bg-gradient-to-r from-state-ok-950/40 via-role-worker-950/30 to-studio-surface">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-card bg-state-ok-500/20 border border-state-ok-500/40 flex items-center justify-center text-state-ok-400 shadow-md shadow-state-ok-500/10">
              <Cpu size={22} />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-slate-100 tracking-tight">
                  Local Dual-Brain Architecture
                </h3>
                <span className="text-micro font-mono px-2 py-0.5 rounded-full bg-state-ok-500/15 text-state-ok-300 border border-state-ok-500/30 font-semibold">
                  100% OFFLINE • RTX 5090
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Two specialized local models collaborating seamlessly with zero cloud tokens and $0.00 cost.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-card hover:bg-white/10 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Dual-Brain Architecture Explainer Banner */}
        <div className="px-5 py-3.5 bg-studio-panel/80 border-b border-studio-border grid grid-cols-2 gap-3 text-xs">
          <div className="p-3 rounded-card bg-role-architect-950/20 border border-role-architect-500/30 flex items-start space-x-2.5">
            <Sparkles size={16} className="text-role-architect-400 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="text-role-architect-300 font-bold block text-xs">Brain 1: General Architect</strong>
              <p className="text-micro text-slate-300 leading-snug mt-0.5">
                Strategic blueprint planning, workspace reconnaissance, invariants checking, and final verification sign-off.
              </p>
              <div className="mt-1.5 flex items-center space-x-1.5 text-micro font-mono text-role-architect-400">
                <span className="w-1.5 h-1.5 rounded-full bg-role-architect-400 animate-pulse" />
                <span>Active: {activeArchitectModel || 'qwen3.8:27b'}</span>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-card bg-state-ok-950/20 border border-state-ok-500/30 flex items-start space-x-2.5">
            <Zap size={16} className="text-state-ok-400 mt-0.5 flex-shrink-0" />
            <div>
              <strong className="text-state-ok-300 font-bold block text-xs">Brain 2: Specialist Coder Worker</strong>
              <p className="text-micro text-slate-300 leading-snug mt-0.5">
                High-speed autonomous tool execution (reads, exact edits, writes, bash commands) at 237 tokens/sec on RTX 5090.
              </p>
              <div className="mt-1.5 flex items-center space-x-1.5 text-micro font-mono text-state-ok-400">
                <span className="w-1.5 h-1.5 rounded-full bg-state-ok-400" />
                <span>Active: {activeLocalModel || 'Qwen3-Coder-30B-A3B-Instruct'}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="px-5 pt-3 border-b border-studio-border flex items-center space-x-4 text-xs font-semibold">
          <button
            onClick={() => setActiveTab('architect')}
            className={`pb-2.5 border-b-2 transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'architect'
                ? 'border-role-architect-500 text-role-architect-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles size={14} />
            <span>Select Architect Model (Brain 1)</span>
          </button>
          <button
            onClick={() => setActiveTab('coder')}
            className={`pb-2.5 border-b-2 transition cursor-pointer flex items-center space-x-1.5 ${
              activeTab === 'coder'
                ? 'border-state-ok-500 text-state-ok-300 font-bold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap size={14} />
            <span>Select Coder Worker Model (Brain 2)</span>
          </button>
        </div>

        {/* Model List */}
        <div className="p-5 overflow-y-auto space-y-2.5 flex-1">
          {activeTab === 'architect' ? (
            <div className="space-y-2.5">
              <div className="text-micro font-semibold uppercase text-slate-400 tracking-wider mb-2">
                Recommended Local Architect Models
              </div>
              {LOCAL_DUAL_BRAIN_SPECS.filter(m => m.role === 'architect' || m.role === 'dual').map(spec => {
                const isSelected = activeArchitectModel === spec.id || (activeArchitectModel === 'local' && spec.id === 'qwen3.8:27b');
                return (
                  <div
                    key={spec.id}
                    onClick={() => {
                      onSelectArchitectModel(spec.id);
                    }}
                    className={`p-3.5 rounded-card border cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-role-architect-950/30 border-role-architect-500 shadow-md ring-1 ring-role-architect-500/50'
                        : 'bg-studio-panel/50 border-studio-border hover:border-slate-600 hover:bg-studio-panel/80'
                    }`}
                  >
                    <div className="space-y-1 pr-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-xs text-slate-100">{spec.name}</span>
                        {spec.badge && (
                          <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-role-architect-500/20 text-role-architect-300 border border-role-architect-500/30 font-bold">
                            {spec.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-micro text-slate-400 leading-relaxed">{spec.description}</p>
                      <div className="flex items-center space-x-3 text-micro font-mono text-slate-500 pt-0.5">
                        <span>{spec.port}</span>
                        <span>•</span>
                        <span>{spec.speed}</span>
                        <span>•</span>
                        <span>VRAM: {spec.vram}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-7 h-7 rounded-full bg-role-architect-500/20 text-role-architect-400 flex items-center justify-center flex-shrink-0 border border-role-architect-500/40">
                        <Check size={14} />
                      </div>
                    )}
                  </div>
                );
              })}

              {installedLocalModels.length > 0 && (
                <div className="pt-3">
                  <div className="text-micro font-semibold uppercase text-slate-400 tracking-wider mb-2">
                    Other Installed Local Models
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {installedLocalModels.map(m => (
                      <button
                        key={m}
                        onClick={() => onSelectArchitectModel(m)}
                        className={`p-2.5 text-left rounded-card border text-xs font-mono transition flex items-center justify-between ${
                          activeArchitectModel === m
                            ? 'bg-role-architect-950/30 border-role-architect-500 text-role-architect-200'
                            : 'bg-studio-panel/40 border-studio-border text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <span className="truncate">{m}</span>
                        {activeArchitectModel === m && <Check size={12} className="text-role-architect-400" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="text-micro font-semibold uppercase text-slate-400 tracking-wider mb-2">
                Recommended Local Coder Worker Models
              </div>
              {LOCAL_DUAL_BRAIN_SPECS.filter(m => m.role === 'coder' || m.role === 'dual').map(spec => {
                const isSelected = activeLocalModel === spec.id;
                return (
                  <div
                    key={spec.id}
                    onClick={() => {
                      onSelectLocalModel?.(spec.id);
                    }}
                    className={`p-3.5 rounded-card border cursor-pointer transition flex items-center justify-between ${
                      isSelected
                        ? 'bg-state-ok-950/30 border-state-ok-500 shadow-md ring-1 ring-state-ok-500/50'
                        : 'bg-studio-panel/50 border-studio-border hover:border-slate-600 hover:bg-studio-panel/80'
                    }`}
                  >
                    <div className="space-y-1 pr-3">
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-xs text-slate-100">{spec.name}</span>
                        {spec.badge && (
                          <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-state-ok-500/20 text-state-ok-300 border border-state-ok-500/30 font-bold">
                            {spec.badge}
                          </span>
                        )}
                      </div>
                      <p className="text-micro text-slate-400 leading-relaxed">{spec.description}</p>
                      <div className="flex items-center space-x-3 text-micro font-mono text-slate-500 pt-0.5">
                        <span>{spec.port}</span>
                        <span>•</span>
                        <span>{spec.speed}</span>
                        <span>•</span>
                        <span>VRAM: {spec.vram}</span>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="w-7 h-7 rounded-full bg-state-ok-500/20 text-state-ok-400 flex items-center justify-center flex-shrink-0 border border-state-ok-500/40">
                        <Check size={14} />
                      </div>
                    )}
                  </div>
                );
              })}

              {installedLocalModels.length > 0 && (
                <div className="pt-3">
                  <div className="text-micro font-semibold uppercase text-slate-400 tracking-wider mb-2">
                    Other Installed Local Coder Models
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {installedLocalModels.map(m => (
                      <button
                        key={m}
                        onClick={() => onSelectLocalModel?.(m)}
                        className={`p-2.5 text-left rounded-card border text-xs font-mono transition flex items-center justify-between ${
                          activeLocalModel === m
                            ? 'bg-state-ok-950/30 border-state-ok-500 text-state-ok-200'
                            : 'bg-studio-panel/40 border-studio-border text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <span className="truncate">{m}</span>
                        {activeLocalModel === m && <Check size={12} className="text-state-ok-400" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-studio-border bg-studio-panel/60 flex items-center justify-between text-xs">
          <div className="flex items-center space-x-2 text-slate-400">
            <ShieldCheck size={15} className="text-state-ok-400" />
            <span className="text-micro">100% Offline GPU Execution • Zero Data Leaves Your Workstation</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-card bg-state-ok-600 hover:bg-state-ok-500 text-white font-semibold transition cursor-pointer shadow-sm shadow-state-ok-600/30"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
