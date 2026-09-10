import React, { useState, useEffect } from 'react';
import { 
  X, DownloadCloud, Trash2, CheckCircle2, RefreshCw, Cpu, HardDrive, Sparkles, AlertCircle, Loader2, ArrowRight, Check, Play, Key, Globe, ShieldCheck, Zap, ExternalLink, Gauge, RotateCcw, Layers, Terminal
} from 'lucide-react';
import { OllamaModelDetail, PullProgressData, SystemInfo, ProviderConfig, ModelProvider, OllamaHealthStatus } from '../types';

interface ModelManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  installedModels: OllamaModelDetail[];
  activeCodingModel: string;
  activeGeneralModel: string;
  onSelectCodingModel: (model: string) => void;
  onSelectGeneralModel: (model: string) => void;
  pullProgress: PullProgressData | null;
  onPullModel: (modelName: string) => void;
  onCancelPull: () => void;
  onDeleteModel: (modelName: string) => void;
  onRefreshModels: () => void;
  systemInfo?: SystemInfo | null;
  ollamaHealth?: OllamaHealthStatus | null;
  isRestartingOllama?: boolean;
  onStartOllama?: () => void;
  onRestartOllama?: () => void;
  onClearPullProgress?: () => void;
}

interface RecommendedModel {
  name: string;
  tag: string;
  sizeEstimate: string;
  description: string;
  recommendedRole: 'coding' | 'general' | 'both';
}

const RECOMMENDED_MODELS: RecommendedModel[] = [
  {
    name: 'Qwen 2.5 Coder 32B',
    tag: 'qwen2.5-coder:32b',
    sizeEstimate: '~19.8 GB',
    description: 'Flagship coding champion. Highest benchmark accuracy for multi-file edits, autonomous planning, and debugging.',
    recommendedRole: 'coding'
  },
  {
    name: 'Qwen 2.5 Coder 14B',
    tag: 'qwen2.5-coder:14b',
    sizeEstimate: '~9.0 GB',
    description: 'Ultra-fast code generation and lightning-speed refactoring with low VRAM footprint.',
    recommendedRole: 'coding'
  },
  {
    name: 'DeepSeek Coder V2 16B',
    tag: 'deepseek-coder-v2:16b',
    sizeEstimate: '~8.9 GB',
    description: 'MoE architecture with exceptional code comprehension across 300+ programming languages.',
    recommendedRole: 'coding'
  },
  {
    name: 'Llama 3.3 70B',
    tag: 'llama3.3:70b',
    sizeEstimate: '~43 GB',
    description: 'Frontier open-weights reasoning model for complex system design, planning, and documentation.',
    recommendedRole: 'general'
  },
  {
    name: 'Phi 4 14B',
    tag: 'phi4:14b',
    sizeEstimate: '~9.1 GB',
    description: 'Microsoft synthetic-trained model with outstanding mathematical reasoning and algorithmic logic.',
    recommendedRole: 'both'
  },
  {
    name: 'Mistral Nemo 12B',
    tag: 'mistral-nemo:12b',
    sizeEstimate: '~7.1 GB',
    description: '128K context window powerhouse developed with NVIDIA. Superb speed and general conversation.',
    recommendedRole: 'general'
  }
];

export const ModelManagerModal: React.FC<ModelManagerModalProps> = ({
  isOpen,
  onClose,
  installedModels,
  activeCodingModel,
  activeGeneralModel,
  onSelectCodingModel,
  onSelectGeneralModel,
  pullProgress,
  onPullModel,
  onCancelPull,
  onDeleteModel,
  onRefreshModels,
  systemInfo,
  ollamaHealth,
  isRestartingOllama = false,
  onStartOllama,
  onRestartOllama,
  onClearPullProgress
}) => {
  const [customTag, setCustomTag] = useState('');
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<string | null>(null);

  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    activeProvider: 'ollama',
    hybridMode: false
  });

  useEffect(() => {
    if (isOpen && (window as any).api?.getProviderConfig) {
      (window as any).api.getProviderConfig().then((cfg: any) => {
        if (cfg) {
          setProviderConfig(prev => ({
            ...prev,
            ...cfg
          }));
        }
      });
    }
  }, [isOpen]);

  const handleOpenUrl = (url: string) => {
    (window as any).api?.openExternalUrl?.(url);
  };

  if (!isOpen) return null;

  const isModelInstalled = (tag: string) => {
    return installedModels.some(m => m.name === tag || m.name.startsWith(`${tag}:`) || tag.startsWith(`${m.name}:`));
  };

  const formatBytes = (bytes?: number) => {
    if (!bytes || bytes === 0) return '0 MB';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(2)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const handleCustomPull = (e: React.FormEvent) => {
    e.preventDefault();
    const tag = customTag.trim();
    if (tag) {
      onPullModel(tag);
      setCustomTag('');
    }
  };


  const isPulling = Boolean(pullProgress && !pullProgress.done);
  const hasPullError = Boolean(pullProgress && pullProgress.error);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200 select-text">
      <div 
        className="bg-studio-surface border border-studio-border rounded-modal w-full max-w-3xl max-h-[88vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-studio-border flex items-center justify-between bg-studio-panel/50">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-card bg-gradient-to-tr from-role-user-500 to-role-architect-600 flex items-center justify-center text-white shadow-md shadow-role-user-500/20">
              <DownloadCloud size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center space-x-2">
                <span>Local AI Models & Accelerators</span>
                <span className="px-2 py-0.5 rounded-full bg-state-ok-500/15 border border-state-ok-500/30 text-state-ok-400 text-micro font-mono font-medium">
                  {systemInfo?.gpu ? `${systemInfo.gpu.replace(/^NVIDIA\s+|GeForce\s+/i, '')} Ready` : 'GPU Accelerated'}
                </span>
              </h3>
              <p className="text-micro text-slate-400">
                Manage offline Ollama & llama-server models on your RTX 5090 GPU (100% Offline, $0.00 Cost)
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={onRefreshModels}
              className="p-1.5 rounded-card text-slate-400 hover:text-slate-200 hover:bg-studio-panel border border-studio-border transition"
              title="Refresh Models"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-card text-slate-400 hover:text-slate-200 hover:bg-studio-panel border border-studio-border transition"
              title="Close (Esc)"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="px-5 py-2.5 bg-studio-panel/40 border-b border-studio-border flex items-center justify-between select-none">
          <div className="flex items-center space-x-2">
            <div className="px-3 py-1.5 rounded-card text-xs font-semibold bg-state-ok-600/20 text-state-ok-300 border border-state-ok-500/40 shadow-sm flex items-center space-x-1.5">
              <HardDrive size={13} />
              <span>Installed Local Models ({installedModels.length})</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 text-micro font-mono">
            <span className="text-slate-400">Engine:</span>
            <span className="px-2 py-0.5 rounded bg-state-ok-500/15 border border-state-ok-500/30 text-state-ok-400 font-bold uppercase text-micro">
              {providerConfig.activeProvider === 'ollama' ? 'Local Ollama' : providerConfig.activeProvider}
            </span>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {/* LOCAL MODELS */}
          <>
              {/* Ollama Daemon Offline Alert & 1-Click Starter Banner */}
              {!ollamaHealth?.online && (
                <div className="p-4 rounded-card bg-state-danger-950/40 border border-state-danger-500/40 shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-3 animate-in fade-in">
                  <div className="flex items-start sm:items-center space-x-3">
                    <div className="w-8 h-8 rounded-card bg-state-danger-500/20 border border-state-danger-500/40 flex items-center justify-center text-state-danger-400 flex-shrink-0 mt-0.5 sm:mt-0">
                      <AlertCircle size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-state-danger-200">
                        Ollama Service is Offline or Unresponsive
                      </h4>
                      <p className="text-micro text-state-danger-300/80">
                        {ollamaHealth?.binaryFound
                          ? 'Local Ollama executable detected. Click Start to launch the daemon without restarting your PC.'
                          : 'Ollama is not running on 127.0.0.1:11434. Make sure Ollama is installed.'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2 flex-shrink-0">
                    {onStartOllama && (
                      <button
                        onClick={onStartOllama}
                        disabled={isRestartingOllama}
                        className="px-3 py-1.5 rounded-card bg-state-ok-600 hover:bg-state-ok-500 text-white text-xs font-medium flex items-center space-x-1.5 transition shadow-sm disabled:opacity-50 cursor-pointer"
                      >
                        {isRestartingOllama ? <RefreshCw size={12} className="animate-spin" /> : <Play size={12} className="fill-current" />}
                        <span>Start Ollama</span>
                      </button>
                    )}
                    {onRestartOllama && (
                      <button
                        onClick={onRestartOllama}
                        disabled={isRestartingOllama}
                        className="px-3 py-1.5 rounded-card bg-studio-panel hover:bg-studio-surface border border-studio-border text-slate-300 text-xs font-medium flex items-center space-x-1.5 transition disabled:opacity-50 cursor-pointer"
                        title="Force terminates any hung or stuck Ollama instances and launches clean daemon"
                      >
                        <RefreshCw size={12} className={isRestartingOllama ? 'animate-spin text-role-user-400' : 'text-slate-400'} />
                        <span>Restart Daemon</span>
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Ollama Daemon Online Indicator with Restart Option */}
              {ollamaHealth?.online && (
                <div className="px-4 py-2.5 rounded-card bg-state-ok-500/10 border border-state-ok-500/25 flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-state-ok-400 animate-pulse" />
                    <span className="text-xs font-medium text-state-ok-300">
                      Ollama Service Online <span className="font-mono text-micro text-state-ok-400/80">(v{ollamaHealth.version})</span>
                    </span>
                  </div>
                  {onRestartOllama && (
                    <button
                      onClick={onRestartOllama}
                      disabled={isRestartingOllama}
                      className="px-2.5 py-1 rounded-control text-micro font-mono text-slate-400 hover:text-slate-200 hover:bg-studio-panel border border-transparent hover:border-studio-border transition flex items-center space-x-1 cursor-pointer disabled:opacity-50"
                      title="Restart Ollama daemon if models or GPU inference hang"
                    >
                      <RefreshCw size={11} className={isRestartingOllama ? 'animate-spin' : ''} />
                      <span>Restart Daemon</span>
                    </button>
                  )}
                </div>
              )}

              {/* Download Error Card (Never swallowed or hidden) */}
              {hasPullError && (
                <div className="p-4 rounded-card bg-state-danger-950/40 border border-state-danger-500/50 shadow-lg animate-in fade-in space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <AlertCircle size={16} className="text-state-danger-400" />
                      <span className="text-xs font-bold text-state-danger-200">
                        Model Download Failed: <span className="font-mono">{pullProgress?.modelName}</span>
                      </span>
                    </div>
                    {onClearPullProgress && (
                      <button
                        onClick={onClearPullProgress}
                        className="p-1 rounded text-state-danger-400 hover:text-state-danger-200 hover:bg-state-danger-900/30 transition cursor-pointer"
                        title="Dismiss"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-state-danger-300/90 font-mono bg-black/40 p-2.5 rounded-card border border-state-danger-900/40 select-text">
                    {pullProgress?.error}
                  </p>
                  <div className="flex items-center space-x-2 pt-1">
                    <button
                      onClick={() => pullProgress?.modelName && onPullModel(pullProgress.modelName)}
                      className="px-3 py-1.5 rounded-card bg-state-danger-600 hover:bg-state-danger-500 text-white text-xs font-medium flex items-center space-x-1.5 transition shadow-sm cursor-pointer"
                    >
                      <RefreshCw size={12} />
                      <span>Retry Download</span>
                    </button>
                    {!ollamaHealth?.online && onStartOllama && (
                      <button
                        onClick={onStartOllama}
                        disabled={isRestartingOllama}
                        className="px-3 py-1.5 rounded-card bg-studio-panel hover:bg-studio-surface border border-studio-border text-slate-200 text-xs font-medium flex items-center space-x-1.5 transition cursor-pointer"
                      >
                        <Play size={12} className="text-state-ok-400" />
                        <span>Start Ollama Daemon</span>
                      </button>
                    )}
                    {onClearPullProgress && (
                      <button
                        onClick={onClearPullProgress}
                        className="px-3 py-1.5 rounded-card text-slate-400 hover:text-slate-200 text-xs transition cursor-pointer"
                      >
                        Dismiss
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Active Download Progress Card */}
              {pullProgress && !pullProgress.done && !hasPullError && (
                <div className="p-4 rounded-card bg-gradient-to-r from-role-user-900/30 via-role-architect-900/30 to-studio-panel border border-role-user-500/40 shadow-lg animate-in fade-in">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <Loader2 size={16} className="text-role-user-400 animate-spin" />
                      <span className="text-xs font-semibold text-slate-100">
                        Pulling: <strong className="text-role-user-300 font-mono">{pullProgress.modelName}</strong>
                      </span>
                    </div>
                    <div className="flex items-center space-x-2">
                      <span className="text-micro font-mono text-role-user-300 font-bold bg-role-user-500/20 px-2 py-0.5 rounded-full border border-role-user-500/30">
                        {pullProgress.percent || 0}%
                      </span>
                      <button
                        onClick={onCancelPull}
                        className="px-2.5 py-1 rounded-card bg-state-danger-600/20 hover:bg-state-danger-600/30 text-state-danger-300 border border-state-danger-500/30 text-micro font-medium transition cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>

                  {/* Progress Bar */}
                  <div className="w-full h-2 bg-studio-bg rounded-full overflow-hidden border border-white/5 my-2">
                    <div
                      className="h-full bg-gradient-to-r from-role-user-500 via-role-architect-500 to-pink-500 rounded-full transition-all duration-150"
                      style={{ width: `${Math.min(100, Math.max(0, pullProgress.percent || 0))}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-micro font-mono text-slate-400">
                    <span className="truncate max-w-md">{pullProgress.status || 'Connecting to Ollama...'}</span>
                    <span>
                      {formatBytes(pullProgress.completed)} / {formatBytes(pullProgress.total)}
                    </span>
                  </div>
                </div>
              )}

              {/* Custom Model Pull Input Bar */}
              <div>
                <h4 className="text-xs font-semibold text-slate-200 mb-1.5 flex items-center space-x-1.5">
                  <DownloadCloud size={13} className="text-role-user-400" />
                  <span>Pull Any Model from Ollama</span>
                </h4>
                <p className="text-micro text-slate-400 mb-2">
                  Enter any model tag from the official <a href="https://ollama.com/library" target="_blank" rel="noreferrer" className="text-role-user-400 hover:underline">Ollama Library</a> (e.g. <code className="text-slate-300 bg-black/30 px-1 py-0.5 rounded">qwen2.5-coder:14b</code>, <code className="text-slate-300 bg-black/30 px-1 py-0.5 rounded">deepseek-coder:33b</code>).
                </p>
                <form onSubmit={handleCustomPull} className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={customTag}
                    onChange={e => setCustomTag(e.target.value)}
                    placeholder="Enter model tag (e.g. qwen2.5-coder:14b, codellama:34b, llama3.3:70b)..."
                    disabled={!!isPulling}
                    className="flex-1 bg-studio-panel border border-studio-border focus:border-role-user-500/80 rounded-card px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition shadow-inner font-mono"
                  />
                  <button
                    type="submit"
                    disabled={!customTag.trim() || !!isPulling}
                    className="px-4 py-2 rounded-card bg-role-user-600 hover:bg-role-user-500 text-white text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-1.5 shadow-md shadow-role-user-600/20"
                  >
                    <DownloadCloud size={13} />
                    <span>Pull Model</span>
                  </button>
                </form>
              </div>

              {/* Recommended Models */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                    <Sparkles size={13} className="text-role-tool-400" />
                    <span>Recommended Local AI Models {systemInfo?.vram ? `(${systemInfo.vram})` : ''}</span>
                  </h4>
                  <span className="text-micro text-slate-400 font-mono">1-Click Install</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {RECOMMENDED_MODELS.map(model => {
                    const installed = isModelInstalled(model.tag);
                    const isCurrentPulling = isPulling && pullProgress?.modelName === model.tag;

                    return (
                      <div
                        key={model.tag}
                        className={`p-3 rounded-card border transition-all flex flex-col justify-between ${
                          installed 
                            ? 'bg-studio-panel/80 border-studio-border hover:border-slate-600'
                            : 'bg-studio-panel/40 border-studio-border/60 hover:border-role-user-500/40'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="text-xs font-bold text-slate-100 flex items-center space-x-1.5">
                                <span>{model.name}</span>
                                {model.recommendedRole === 'coding' ? (
                                  <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-role-user-500/20 text-role-user-300 border border-role-user-500/30">
                                    Coding
                                  </span>
                                ) : model.recommendedRole === 'general' ? (
                                  <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-role-architect-500/20 text-role-architect-300 border border-role-architect-500/30">
                                    General
                                  </span>
                                ) : (
                                  <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-state-ok-500/20 text-state-ok-300 border border-state-ok-500/30">
                                    All-Round
                                  </span>
                                )}
                              </div>
                              <span className="text-micro font-mono text-slate-400">{model.tag}</span>
                            </div>
                            <span className="text-micro font-mono text-slate-400 bg-studio-bg px-2 py-0.5 rounded border border-studio-border">
                              {model.sizeEstimate}
                            </span>
                          </div>
                          <p className="text-micro text-slate-400 mt-1.5 leading-relaxed">
                            {model.description}
                          </p>
                        </div>

                        <div className="mt-3 pt-2 border-t border-studio-border/50 flex items-center justify-between">
                          {installed ? (
                            <div className="flex items-center space-x-1.5 text-micro text-state-ok-400 font-medium">
                              <CheckCircle2 size={13} />
                              <span>Installed & Ready</span>
                            </div>
                          ) : (
                            <div className="text-micro text-slate-500">Not Installed</div>
                          )}

                          {installed ? (
                            <div className="flex items-center space-x-1.5">
                              <button
                                onClick={() => onSelectCodingModel(model.tag)}
                                className={`text-micro px-2 py-1 rounded transition border ${
                                  activeCodingModel === model.tag
                                    ? 'bg-role-user-600/20 text-role-user-300 border-role-user-500/40 font-medium'
                                    : 'bg-studio-surface text-slate-400 hover:text-slate-200 border-studio-border'
                                }`}
                              >
                                Use for Coding
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => onPullModel(model.tag)}
                              disabled={!!isPulling}
                              className="text-micro px-2.5 py-1 rounded-card bg-role-user-600/20 hover:bg-role-user-600/30 text-role-user-300 border border-role-user-500/30 font-medium transition flex items-center space-x-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {isCurrentPulling ? (
                                <>
                                  <Loader2 size={11} className="animate-spin" />
                                  <span>Downloading...</span>
                                </>
                              ) : (
                                <>
                                  <DownloadCloud size={11} />
                                  <span>Download</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Installed Models List */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold text-slate-200 flex items-center space-x-1.5">
                    <HardDrive size={13} className="text-state-ok-400" />
                    <span>Installed Ollama Models ({installedModels.length})</span>
                  </h4>
                  <span className="text-micro text-slate-400 font-mono">Managed locally on your drive</span>
                </div>

                {installedModels.length === 0 ? (
                  <div className="p-6 rounded-card bg-studio-panel/40 border border-studio-border text-center text-slate-400 text-xs">
                    No models detected. Download a recommended model above to get started.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {installedModels.map(model => {
                      const isCodingActive = activeCodingModel === model.name;
                      const isGeneralActive = activeGeneralModel === model.name;
                      const isConfirmingDelete = deleteConfirmTag === model.name;

                      return (
                        <div
                          key={model.name}
                          className={`p-3 rounded-card border transition flex items-center justify-between ${
                            isCodingActive || isGeneralActive
                              ? 'bg-studio-panel border-role-user-500/40 shadow-sm'
                              : 'bg-studio-panel/60 border-studio-border hover:border-slate-600'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-7 h-7 rounded-card bg-studio-surface border border-studio-border flex items-center justify-center text-slate-300">
                              <Cpu size={14} />
                            </div>
                            <div>
                              <div className="flex items-center space-x-2">
                                <span className="text-xs font-bold text-slate-100 font-mono">{model.name}</span>
                                {isCodingActive && (
                                  <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-role-user-500/20 text-role-user-300 border border-role-user-500/30">
                                    Coding
                                  </span>
                                )}
                                {isGeneralActive && (
                                  <span className="text-micro font-mono px-1.5 py-0.5 rounded bg-role-architect-500/20 text-role-architect-300 border border-role-architect-500/30">
                                    General
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center space-x-2 text-micro text-slate-400 font-mono mt-0.5">
                                <span>{formatBytes(model.size)}</span>
                                {model.details?.parameter_size && (
                                  <>
                                    <span>•</span>
                                    <span>{model.details.parameter_size}</span>
                                  </>
                                )}
                                {model.details?.quantization_level && (
                                  <>
                                    <span>•</span>
                                    <span>{model.details.quantization_level}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <button
                              onClick={() => onSelectCodingModel(model.name)}
                              className={`text-micro px-2 py-1 rounded transition border ${
                                isCodingActive
                                  ? 'bg-role-user-600/20 text-role-user-300 border-role-user-500/40 font-medium'
                                  : 'bg-studio-surface text-slate-400 hover:text-slate-200 border-studio-border'
                              }`}
                            >
                              Use for Coding
                            </button>
                            <button
                              onClick={() => onSelectGeneralModel(model.name)}
                              className={`text-micro px-2 py-1 rounded transition border ${
                                isGeneralActive
                                  ? 'bg-role-architect-600/20 text-role-architect-300 border-role-architect-500/40 font-medium'
                                  : 'bg-studio-surface text-slate-400 hover:text-slate-200 border-studio-border'
                              }`}
                            >
                              Use for General
                            </button>

                            {/* Delete Button or Port 8080 Badge */}
                            {model.name.includes('Qwen3-Coder') || model.digest === 'local-gguf-port-8080' ? (
                              <span className="text-micro font-mono px-2 py-0.5 rounded bg-role-tool-500/15 text-role-tool-300 border border-role-tool-500/30 font-bold">
                                Port 8080 (RTX 5090)
                              </span>
                            ) : isConfirmingDelete ? (
                              <div className="flex items-center space-x-1 bg-state-danger-950/40 p-1 rounded-card border border-state-danger-500/40 animate-in fade-in">
                                <span className="text-micro text-state-danger-300 px-1">Sure?</span>
                                <button
                                  onClick={() => {
                                    onDeleteModel(model.name);
                                    setDeleteConfirmTag(null);
                                  }}
                                  className="px-1.5 py-0.5 rounded bg-state-danger-600 hover:bg-state-danger-500 text-white text-micro font-medium transition"
                                >
                                  Yes, Delete
                                </button>
                                <button
                                  onClick={() => setDeleteConfirmTag(null)}
                                  className="px-1.5 py-0.5 rounded bg-studio-surface text-slate-400 hover:text-slate-200 text-micro transition"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setDeleteConfirmTag(model.name)}
                                className="p-1.5 rounded-card text-slate-400 hover:text-state-danger-400 hover:bg-state-danger-500/10 transition"
                                title="Delete model from disk"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
        </div>
      </div>
    </div>
  );
};
