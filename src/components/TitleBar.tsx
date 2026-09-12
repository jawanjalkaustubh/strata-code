import React, { useState, useEffect, useRef } from 'react';
import { 
  Minus, Square, X, FolderOpen, Zap, Shield, Cpu, Info, Octagon, Columns, Code2, MessageSquare, 
  DownloadCloud, Terminal as TerminalIcon, Play, RefreshCw, Plus, Save, ChevronDown, Check, 
  LogOut, HelpCircle, FileText, Sparkles, HardDrive, Heart
} from 'lucide-react';
import { DualBrainModal } from './DualBrainModal';
import { TaskMode, SystemInfo, OllamaHealthStatus, HybridTier } from '../types';
import { STRATA_ICON } from '../assets/logo';
import { SUPPORT, openExternal } from '../support';

export interface TitleBarProps {
  workspace: string;
  onOpenWorkspace: () => void;
  models: string[];
  taskMode: TaskMode;
  onSelectTaskMode: (mode: TaskMode) => void;
  activeModel: string;
  onSelectModel: (model: string) => void;
  autoMode: boolean;
  onToggleAutoMode: () => void;
  onOpenAbout: () => void;
  onOpenModelManager: () => void;
  isBusy: boolean;
  onStop: () => void;
  isEditorOpen: boolean;
  onToggleEditor: () => void;
  isTerminalOpen?: boolean;
  onToggleTerminal?: () => void;
  systemInfo?: SystemInfo | null;
  ollamaHealth?: OllamaHealthStatus | null;
  isRestartingOllama?: boolean;
  onStartOllama?: () => void;
  onRestartOllama?: () => void;
  // Menu action extensions
  onNewChat?: () => void;
  onSaveActiveFile?: () => void;
  onCloseActiveTab?: () => void;
  onRefreshFiles?: () => void;
  activeFile?: string | null;
  isHybrid?: boolean;
  onToggleHybrid?: () => void;
  hybridTier?: HybridTier;
  onSelectHybridTier?: (tier: HybridTier) => void;
  codingModel?: string;
  generalModel?: string;
  architectModel?: string;
  onOpenDualBrainModal?: () => void;
}

const TitleBarInner: React.FC<TitleBarProps> = ({
  workspace,
  onOpenWorkspace,
  models,
  taskMode,
  onSelectTaskMode,
  activeModel,
  onSelectModel,
  autoMode,
  onToggleAutoMode,
  onOpenAbout,
  onOpenModelManager,
  isBusy,
  onStop,
  isEditorOpen,
  onToggleEditor,
  isTerminalOpen = false,
  onToggleTerminal,
  systemInfo,
  ollamaHealth,
  isRestartingOllama = false,
  onStartOllama,
  onRestartOllama,
  onNewChat,
  onSaveActiveFile,
  onCloseActiveTab,
  onRefreshFiles,
  activeFile,
  isHybrid = false,
  onToggleHybrid,
  hybridTier = 'medium',
  onSelectHybridTier,
  codingModel = 'qwen2.5-coder:32b',
  generalModel = 'qwen3.8:27b',
  architectModel = 'qwen3.8:27b',
  onOpenDualBrainModal
}) => {
  const openModelModal = onOpenDualBrainModal;
  const api = (window as any).api;
  const [openMenu, setOpenMenu] = useState<'file' | 'view' | 'help' | null>(null);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  const workspaceName = workspace ? (workspace.split(/[\\/]/).filter(Boolean).pop() || workspace) : 'No Workspace';

  // Dismiss dropdown menu on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <header className="flex flex-col flex-shrink-0 z-50 select-none">
      {/* =========================================================================
          ROW 1: SYSTEM TITLE BAR (App Icon, Menus, Drag Region, Window Controls)
          Anchored flex-shrink-0 window controls are NEVER cut off during resize!
          ========================================================================= */}
      <div className="custom-titlebar h-9 bg-studio-surface border-b border-studio-border flex items-center justify-between px-2.5 select-none relative">
        {/* Left: Brand Icon + Native-style Menus */}
        <div className="flex items-center space-x-1 no-drag" ref={menuContainerRef} style={{ WebkitAppRegion: 'no-drag' } as any}>
          {/* Brand Logo & Name */}
          <div 
            className="flex items-center space-x-1.5 px-1.5 py-1 rounded hover:bg-studio-panel cursor-pointer transition mr-1"
            onClick={onOpenAbout}
            title="About Strata Code"
          >
            <img 
              src={STRATA_ICON} 
              alt="Strata" 
              className="w-4 h-4 object-contain drop-shadow-[0_0_6px_rgba(45,212,191,0.5)]" 
            />
            <span className="font-bold text-xs tracking-wide bg-gradient-to-r from-role-worker-200 via-state-info-200 to-slate-100 bg-clip-text text-transparent hidden sm:inline">
              Strata Code
            </span>
          </div>

          {/* FILE MENU */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'file' ? null : 'file')}
              onMouseEnter={() => openMenu && setOpenMenu('file')}
              className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                openMenu === 'file' 
                  ? 'bg-studio-panel text-white' 
                  : 'text-slate-300 hover:text-white hover:bg-studio-panel'
              }`}
            >
              File
            </button>

            {openMenu === 'file' && (
              <div className="absolute top-full left-0 mt-1 w-60 bg-studio-surface border border-studio-border rounded-card shadow-2xl py-1 text-xs z-50 animate-in fade-in">
                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenWorkspace();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <FolderOpen size={13} className="text-role-user-400" />
                    <span>Open Folder...</span>
                  </span>
                  <kbd className="text-micro text-slate-500 font-mono">Ctrl+O</kbd>
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onNewChat?.();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <Plus size={13} className="text-role-worker-400" />
                    <span>New Chat / Clear Session</span>
                  </span>
                  <kbd className="text-micro text-slate-500 font-mono">Ctrl+N</kbd>
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onSaveActiveFile?.();
                  }}
                  disabled={!activeFile}
                  className={`w-full flex items-center justify-between px-3 py-1.5 transition text-left ${
                    activeFile 
                      ? 'hover:bg-studio-panel text-slate-300 hover:text-white cursor-pointer' 
                      : 'opacity-40 cursor-not-allowed text-slate-500'
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <Save size={13} className="text-state-ok-400" />
                    <span>Save File</span>
                  </span>
                  <kbd className="text-micro text-slate-500 font-mono">Ctrl+S</kbd>
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onCloseActiveTab?.();
                  }}
                  disabled={!activeFile}
                  className={`w-full flex items-center justify-between px-3 py-1.5 transition text-left ${
                    activeFile 
                      ? 'hover:bg-studio-panel text-slate-300 hover:text-white cursor-pointer' 
                      : 'opacity-40 cursor-not-allowed text-slate-500'
                  }`}
                >
                  <span className="flex items-center space-x-2">
                    <X size={13} className="text-state-danger-400" />
                    <span>Close Current File</span>
                  </span>
                  <kbd className="text-micro text-slate-500 font-mono">Ctrl+W</kbd>
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onRefreshFiles?.();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <RefreshCw size={13} className="text-role-user-400" />
                    <span>Refresh Workspace</span>
                  </span>
                  <kbd className="text-micro text-slate-500 font-mono">Ctrl+R</kbd>
                </button>

                <div className="h-[1px] bg-studio-border my-1" />

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenModelManager();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <DownloadCloud size={13} className="text-role-user-400" />
                    <span>Manage Models...</span>
                  </span>
                </button>

                {onRestartOllama && (
                  <button
                    onClick={() => {
                      setOpenMenu(null);
                      onRestartOllama();
                    }}
                    className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                  >
                    <span className="flex items-center space-x-2">
                      <RefreshCw size={13} className="text-role-tool-400" />
                      <span>Restart Ollama Service</span>
                    </span>
                  </button>
                )}

                <div className="h-[1px] bg-studio-border my-1" />

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    api?.close?.();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-state-danger-500/20 text-state-danger-300 hover:text-state-danger-200 transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <LogOut size={13} />
                    <span>Exit Strata Code</span>
                  </span>
                  <kbd className="text-micro text-state-danger-400/60 font-mono">Alt+F4</kbd>
                </button>
              </div>
            )}
          </div>

          {/* VIEW MENU */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'view' ? null : 'view')}
              onMouseEnter={() => openMenu && setOpenMenu('view')}
              className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                openMenu === 'view' 
                  ? 'bg-studio-panel text-white' 
                  : 'text-slate-300 hover:text-white hover:bg-studio-panel'
              }`}
            >
              View
            </button>

            {openMenu === 'view' && (
              <div className="absolute top-full left-0 mt-1 w-60 bg-studio-surface border border-studio-border rounded-card shadow-2xl py-1 text-xs z-50 animate-in fade-in">
                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onToggleEditor();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <Columns size={13} className="text-role-worker-400" />
                    <span>{isEditorOpen ? 'Collapse Code Editor' : 'Open Code Editor (Split)'}</span>
                  </span>
                  {isEditorOpen && <Check size={12} className="text-role-worker-400" />}
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onToggleTerminal?.();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <TerminalIcon size={13} className="text-role-user-400" />
                    <span>Terminal Console Drawer</span>
                  </span>
                  <kbd className="text-micro text-slate-500 font-mono">Ctrl+`</kbd>
                </button>

                <div className="h-[1px] bg-studio-border my-1" />

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onSelectTaskMode('coding');
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <Code2 size={13} className="text-role-user-400" />
                    <span>Task Mode: Coding</span>
                  </span>
                  {taskMode === 'coding' && <Check size={12} className="text-role-user-400" />}
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onSelectTaskMode('general');
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <MessageSquare size={13} className="text-role-architect-400" />
                    <span>Task Mode: General</span>
                  </span>
                  {taskMode === 'general' && <Check size={12} className="text-role-architect-400" />}
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onToggleAutoMode();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <Zap size={13} className="text-role-tool-400" />
                    <span>Autonomous Auto Mode</span>
                  </span>
                  {autoMode && <Check size={12} className="text-role-tool-400" />}
                </button>
              </div>
            )}
          </div>

          {/* HELP MENU */}
          <div className="relative">
            <button
              onClick={() => setOpenMenu(openMenu === 'help' ? null : 'help')}
              onMouseEnter={() => openMenu && setOpenMenu('help')}
              className={`px-2 py-0.5 rounded text-xs font-medium transition ${
                openMenu === 'help' 
                  ? 'bg-studio-panel text-white' 
                  : 'text-slate-300 hover:text-white hover:bg-studio-panel'
              }`}
            >
              Help
            </button>

            {openMenu === 'help' && (
              <div className="absolute top-full left-0 mt-1 w-60 bg-studio-surface border border-studio-border rounded-card shadow-2xl py-1 text-xs z-50 animate-in fade-in">
                {/* Free for everyone; donations are voluntary (LICENSE section on donations). Opens support.json donateUrl. */}
                <button
                  onClick={() => {
                    setOpenMenu(null);
                    if (SUPPORT.donateUrl) openExternal(SUPPORT.donateUrl);
                    else onOpenAbout();
                  }}
                  data-testid="help-donate"
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                  title={SUPPORT.donateUrl ? SUPPORT.donateUrl : 'Strata Code is free. The donation page is being set up.'}
                >
                  <span className="flex items-center space-x-2">
                    <Heart size={13} className="text-state-danger-400" />
                    <span>{SUPPORT.donateLabel} (donate)</span>
                  </span>
                  <span className="text-micro text-slate-500">{SUPPORT.donateUrl ? 'Free' : 'soon'}</span>
                </button>

                <button
                  onClick={() => {
                    setOpenMenu(null);
                    onOpenAbout();
                  }}
                  className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-studio-panel text-slate-300 hover:text-white transition text-left cursor-pointer"
                >
                  <span className="flex items-center space-x-2">
                    <Info size={13} className="text-role-user-400" />
                    <span>About Strata Code</span>
                  </span>
                </button>

                <div className="h-[1px] bg-studio-border my-1" />

                <div className="px-3 py-1.5 text-micro text-slate-400">
                  <div className="flex items-center justify-between">
                    <span>Ollama Daemon:</span>
                    <span className={ollamaHealth?.online ? 'text-state-ok-400 font-bold' : 'text-state-danger-400 font-bold'}>
                      {ollamaHealth?.online ? `Online (v${ollamaHealth.version || '0.x'})` : 'Offline'}
                    </span>
                  </div>
                </div>

                {!ollamaHealth?.online && onStartOllama && (
                  <button
                    onClick={() => {
                      setOpenMenu(null);
                      onStartOllama();
                    }}
                    className="w-full flex items-center space-x-2 px-3 py-1.5 hover:bg-state-danger-500/20 text-state-danger-300 transition text-left cursor-pointer"
                  >
                    <Play size={13} className="fill-state-danger-300" />
                    <span>Launch Ollama Daemon</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Center: Draggable Window Area */}
        <div 
          className="flex-1 h-full select-none cursor-default"
          style={{ WebkitAppRegion: 'drag' } as any}
        />

        {/* Right: Hardware badge + Ollama Status + ANCHORED WINDOW CONTROLS */}
        <div className="flex items-center space-x-2 no-drag flex-shrink-0" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {systemInfo?.gpu && (
            <div 
              className="hidden lg:flex items-center space-x-1 px-1.5 py-0.5 rounded bg-black/40 border border-studio-border text-micro font-mono text-state-ok-400 flex-shrink-0"
              title={`Discrete GPU: ${systemInfo.gpu} (${systemInfo.vram || 'Dedicated VRAM'})`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-state-ok-400 animate-pulse" />
              <span className="max-w-[120px] truncate">{systemInfo.gpu.replace(/^NVIDIA\s+|GeForce\s+/i, '')}</span>
            </div>
          )}

          {ollamaHealth?.online ? (
            <div 
              className="hidden sm:flex items-center space-x-1 px-1.5 py-0.5 rounded bg-state-ok-500/10 border border-state-ok-500/30 text-state-ok-400 text-micro font-mono flex-shrink-0"
              title={`Ollama Daemon is online (v${ollamaHealth.version || '0.x'})`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-state-ok-400 animate-pulse" />
              <span>Ollama</span>
            </div>
          ) : (
            <div 
              className="hidden sm:flex items-center space-x-1 px-1.5 py-0.5 rounded bg-state-danger-500/10 border border-state-danger-500/30 text-state-danger-400 text-micro font-mono flex-shrink-0"
              title="Ollama is offline"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-state-danger-500" />
              <span>Offline</span>
            </div>
          )}

          <div className="h-4 w-[1px] bg-studio-border mx-1 flex-shrink-0" />

          {/* Window Control Buttons (Minimize, Maximize, Close) - Fixed, Unbreakable, Never Cut Off */}
          <div className="flex items-center h-full flex-shrink-0">
            <button
              onClick={() => api?.minimize?.()}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              className="h-8 w-9 flex items-center justify-center hover:bg-studio-panel rounded text-slate-400 hover:text-slate-100 transition cursor-pointer"
              title="Minimize"
            >
              <Minus size={13} />
            </button>
            <button
              onClick={() => api?.maximize?.()}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              className="h-8 w-9 flex items-center justify-center hover:bg-studio-panel rounded text-slate-400 hover:text-slate-100 transition cursor-pointer"
              title="Maximize"
            >
              <Square size={11} />
            </button>
            <button
              onClick={() => api?.close?.()}
              style={{ WebkitAppRegion: 'no-drag' } as any}
              className="h-8 w-9 flex items-center justify-center hover:bg-state-danger-600 rounded text-slate-400 hover:text-white transition cursor-pointer"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* =========================================================================
          ROW 2: ACTION BAR / SUB-TOOLBAR (All quick tools, mode switches, models)
          Wraps onto a second row on narrow windows so buttons never get cut off!
          ========================================================================= */}
      <div 
        className="bg-studio-surface/85 backdrop-blur-sm border-b border-studio-border flex items-center flex-wrap justify-between px-3 py-1.5 gap-x-2 gap-y-1.5 select-none z-40 flex-shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as any}
      >
        {/* Left: Workspace Quick-Switch + Task Mode Selector + Model Selector */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Workspace Quick-Button */}
          <button
            onClick={onOpenWorkspace}
            className="flex items-center space-x-1.5 px-2 py-1 rounded bg-studio-panel hover:bg-studio-panel/80 border border-studio-border hover:border-role-user-500/40 transition text-xs text-slate-300 hover:text-white flex-shrink-0"
            title="Switch Workspace Folder"
          >
            <FolderOpen size={13} className="text-role-user-400" />
            <span className="max-w-[150px] truncate">{workspaceName}</span>
          </button>

          <div className="h-4 w-[1px] bg-studio-border flex-shrink-0" />

          {/* Task Mode Selector (Coding vs General) */}
          <div className="flex items-center p-0.5 bg-studio-panel/80 rounded-card border border-studio-border text-xs flex-shrink-0">
            <button
              onClick={() => onSelectTaskMode('coding')}
              className={`flex items-center space-x-1.5 px-2 py-1 rounded-control text-xs font-medium transition ${
                taskMode === 'coding'
                  ? 'bg-role-user-600 text-white shadow-sm shadow-role-user-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Coding Task: Qwen specialized for code generation, diffs, and debugging"
            >
              <Code2 size={12} />
              <span>Coding</span>
            </button>
            <button
              onClick={() => onSelectTaskMode('general')}
              className={`flex items-center space-x-1.5 px-2 py-1 rounded-control text-xs font-medium transition ${
                taskMode === 'general'
                  ? 'bg-role-architect-600 text-white shadow-sm shadow-role-architect-600/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="General Task: General reasoning, analysis, documentation, and chat"
            >
              <MessageSquare size={12} />
              <span>General</span>
            </button>
          </div>

          {/* Architecture Switcher: Local Dual-Brain vs Direct Model */}
          <div 
            className="flex items-center p-0.5 bg-studio-panel/90 rounded-card border border-studio-border text-xs flex-shrink-0 select-none shadow-sm"
            title="Toggle between Local Dual-Brain (Architect + Coder) and Direct single model mode"
          >
            <button
              onClick={() => { if (!isHybrid) onToggleHybrid?.(); }}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-xs font-semibold transition cursor-pointer ${
                isHybrid
                  ? 'bg-gradient-to-r from-role-architect-600 to-role-user-600 text-white shadow-sm shadow-role-architect-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Dual-Brain Mode: General Architect (qwen3.8:27b) plans blueprints, Specialist Coder (Qwen3-Coder-30B) executes tools autonomously on RTX 5090"
            >
              <Cpu size={12} className={isHybrid ? 'text-role-tool-300' : 'text-slate-400'} />
              <span>Dual-Brain</span>
            </button>
            <button
              onClick={() => { if (isHybrid) onToggleHybrid?.(); }}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-xs font-semibold transition cursor-pointer ${
                !isHybrid
                  ? 'bg-state-ok-600 text-white shadow-sm shadow-state-ok-600/30 font-bold'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
              }`}
              title="Direct Mode: 100% sovereign direct chat with single local model on your RTX 5090 GPU"
            >
              <HardDrive size={12} className={!isHybrid ? 'text-white' : 'text-slate-400'} />
              <span>Direct</span>
            </button>
          </div>

          {/* Dual-Brain Planning Intensity Selector (Low | Med | High) */}
          {isHybrid && (
            <div 
              className="flex items-center p-0.5 bg-studio-panel/90 rounded-card border border-role-architect-500/30 text-micro flex-shrink-0 select-none shadow-sm animate-in fade-in duration-200"
              title="Dual-Brain Planning Intensity: Governs architectural reasoning depth on your RTX 5090"
            >
              <button
                onClick={() => onSelectHybridTier?.('low')}
                className={`px-2 py-0.5 rounded text-micro font-semibold transition cursor-pointer ${
                  hybridTier === 'low'
                    ? 'bg-role-architect-600 text-white font-bold shadow-sm shadow-role-architect-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
                title="⚡ Low (Light): Ultra-concise directive spark from General Architect. Full execution handled by Coder Worker."
              >
                Low
              </button>
              <button
                onClick={() => onSelectHybridTier?.('medium')}
                className={`px-2 py-0.5 rounded text-micro font-semibold transition cursor-pointer ${
                  hybridTier === 'medium'
                    ? 'bg-role-architect-600 text-white font-bold shadow-sm shadow-role-architect-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
                title="⚡ Med (Balanced): Step-by-step architectural blueprint from General Architect + Coder Worker execution."
              >
                Med
              </button>
              <button
                onClick={() => onSelectHybridTier?.('high')}
                className={`px-2 py-0.5 rounded text-micro font-semibold transition cursor-pointer ${
                  hybridTier === 'high'
                    ? 'bg-role-architect-600 text-white font-bold shadow-sm shadow-role-architect-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                }`}
                title="⚡ High (Deep): Comprehensive architectural blueprint with verification sign-off + Coder Worker execution."
              >
                High
              </button>
            </div>
          )}

          {/* Local Coder Worker Picker */}
          <div 
            className="flex items-center space-x-1.5 bg-studio-panel px-2 py-1 rounded-control border border-studio-border text-xs flex-shrink-0"
            title={isHybrid 
              ? `Local Coder Worker (${taskMode === 'coding' ? 'Coding' : 'General'}): Runs autonomously on your RTX 5090 GPU to write code and execute tools at 237 tok/s`
              : `Offline Local Model (${taskMode === 'coding' ? 'Coding' : 'General'}): 100% sovereign on your local GPU with $0 cost`}
          >
            <HardDrive size={13} className={isHybrid ? "text-role-architect-400" : "text-state-ok-400"} />
            <span className="text-micro uppercase font-bold text-slate-400 font-mono">
              {isHybrid ? 'Coder:' : 'Model:'}
            </span>
            <select
              value={activeModel}
              onChange={(e) => {
                if (e.target.value === '__manage__') {
                  onOpenModelManager();
                } else {
                  onSelectModel(e.target.value);
                }
              }}
              className={`bg-transparent ${isHybrid ? 'text-role-architect-300' : 'text-state-ok-300'} text-xs focus:outline-none cursor-pointer pr-1 max-w-[140px] truncate font-mono font-medium`}
            >
              {models.map(m => (
                <option key={m} value={m} className="bg-studio-panel text-slate-200">
                  {m}
                </option>
              ))}
              <option disabled className="bg-studio-panel text-slate-500">
                ──────────
              </option>
              <option value="__manage__" className="bg-studio-panel text-role-user-300 font-semibold">
                + Download Local Models...
              </option>
            </select>
          </div>

          {/* Local Architect Model Selector Chip in Dual-Brain Mode */}
          {isHybrid && (
            <button
              onClick={openModelModal}
              className="flex items-center space-x-1.5 bg-studio-panel hover:bg-studio-surface px-2 py-1 rounded-control border border-role-architect-500/40 hover:border-role-architect-400 text-xs text-role-architect-200 transition cursor-pointer shadow-sm flex-shrink-0"
              title="Configure Local Dual-Brain Architecture (General Architect + Coder Worker)"
            >
              <Sparkles size={12} className="text-role-tool-300" />
              <span className="text-micro uppercase font-bold text-role-architect-300 font-mono">Architect:</span>
              <span className="font-mono font-medium text-white max-w-[120px] truncate">{architectModel || 'qwen3.8:27b'}</span>
              <span className="text-micro text-role-architect-400">▾</span>
            </button>
          )}

          {/* Dedicated Model Manager & Downloader Button */}
          <button
            onClick={onOpenModelManager}
            className="flex items-center space-x-1 px-2 py-1 rounded-control bg-studio-panel hover:bg-studio-surface border border-studio-border text-xs text-role-user-300 hover:text-role-user-200 transition cursor-pointer shadow-sm flex-shrink-0"
            title="Download, update, and manage local GPU models"
          >
            <DownloadCloud size={13} className="text-role-user-400" />
            <span>Models</span>
          </button>

          {/* Ollama Offline Start Action Button */}
          {!ollamaHealth?.online && onStartOllama && (
            <button
              onClick={onStartOllama}
              disabled={isRestartingOllama}
              className="flex items-center space-x-1 px-2 py-1 rounded-control bg-state-danger-600/30 hover:bg-state-danger-600/40 border border-state-danger-500/40 text-state-danger-200 text-xs transition cursor-pointer disabled:opacity-50 flex-shrink-0"
              title="Start local Ollama service in background"
            >
              {isRestartingOllama ? (
                <RefreshCw size={12} className="animate-spin text-state-danger-300" />
              ) : (
                <Play size={12} className="text-state-danger-300 fill-state-danger-300" />
              )}
              <span>Start Ollama</span>
            </button>
          )}
        </div>

        {/* Right: Auto Mode + Split View + Terminal + Interrupt + About */}
        <div className="flex items-center space-x-2 flex-shrink-0">
          {/* Auto Mode Switch */}
          <button
            onClick={onToggleAutoMode}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-xs font-medium border transition-all flex-shrink-0 ${
              autoMode 
                ? 'bg-role-user-600/20 border-role-user-500/50 text-role-user-300 shadow-sm shadow-role-user-500/10' 
                : 'bg-studio-panel border-studio-border text-slate-400 hover:text-slate-200'
            }`}
            title={autoMode ? 'Auto Mode: Actions execute autonomously' : 'Review Mode: Approvals required for edits/commands'}
          >
            {autoMode ? (
              <>
                <Zap size={13} className="text-role-user-400 animate-pulse" />
                <span>Auto</span>
                <span className="w-1.5 h-1.5 rounded-full bg-role-user-400"></span>
              </>
            ) : (
              <>
                <Shield size={13} className="text-role-tool-400" />
                <span>Review</span>
                <span className="w-1.5 h-1.5 rounded-full bg-role-tool-400"></span>
              </>
            )}
          </button>

          <div className="h-4 w-[1px] bg-studio-border flex-shrink-0" />

          {/* View Toggle: Split View vs Expand Canvas */}
          <button
            onClick={onToggleEditor}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-xs border transition flex-shrink-0 ${
              isEditorOpen
                ? 'bg-role-worker-500/20 border-role-worker-500/50 text-role-worker-300 shadow-sm'
                : 'bg-studio-panel border-studio-border text-slate-400 hover:text-slate-200'
            }`}
            title={isEditorOpen ? "Close Code Editor & Expand Canvas" : "Open Code Editor Split View"}
          >
            <Columns size={13} className={isEditorOpen ? "text-role-worker-400" : "text-slate-400"} />
            <span className="hidden md:inline">{isEditorOpen ? "Split View" : "Expand Canvas"}</span>
          </button>

          {/* Terminal Drawer Toggle Button */}
          <button
            onClick={onToggleTerminal}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-xs border transition flex-shrink-0 ${
              isTerminalOpen
                ? 'bg-role-user-600/20 border-role-user-500/50 text-role-user-300 shadow-sm'
                : 'bg-studio-panel border-studio-border text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle Terminal Drawer (Ctrl+`)"
          >
            <TerminalIcon size={12} className={isTerminalOpen ? "text-role-user-400" : "text-slate-400"} />
            <span className="hidden md:inline">Terminal</span>
          </button>

          {/* Interrupt button (visible when busy) */}
          {isBusy && (
            <button
              onClick={onStop}
              className="flex items-center space-x-1.5 px-2.5 py-1 rounded-control bg-state-danger-600/20 hover:bg-state-danger-600/30 text-state-danger-300 border border-state-danger-500/40 text-xs font-medium transition cursor-pointer animate-in fade-in flex-shrink-0"
              title="Interrupt Current Task (Esc)"
            >
              <Octagon size={13} className="text-state-danger-400 fill-current" />
              <span>Interrupt</span>
              <kbd className="px-1 py-0.5 bg-black/40 rounded text-micro text-state-danger-200 font-mono">Esc</kbd>
            </button>
          )}

          {/* About button */}
          <button
            onClick={onOpenAbout}
            className="flex items-center space-x-1 px-2 py-1 rounded-control text-xs text-slate-400 hover:text-slate-200 hover:bg-studio-panel border border-transparent hover:border-studio-border transition flex-shrink-0"
            title="About Strata Code"
          >
            <Info size={13} />
            <span className="hidden sm:inline">About</span>
          </button>
        </div>
      </div>
    </header>
  );
};

// Memoized. App holds all state in one component, so without this every
// streamed chunk re-rendered this whole subtree. Effective only because the
// handlers App passes down are now referentially stable (useEventCallback).
export const TitleBar = React.memo(TitleBarInner);
