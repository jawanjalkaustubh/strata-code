import React, { useState, useEffect, useRef } from 'react';
import { 
  X, Terminal, BrainCircuit, Wrench, CheckCircle2, AlertCircle, Clock, Copy, Check, ChevronDown, ChevronRight, Eye, Sparkles, FileCode, Layers
} from 'lucide-react';
import { ToolCallItem } from '../types';

export interface LiveActivityItem {
  id: string;
  type: 'thinking' | 'tool' | 'response' | 'error';
  title: string;
  summary: string;
  detail?: string;
  timestamp: string;
  toolName?: string;
  toolArgs?: any;
  toolOutput?: string;
  status: 'running' | 'success' | 'failed';
  elapsedSec?: number;
  diff?: {
    path: string;
    oldContent: string;
    newContent: string;
  };
}

interface ClaudeCodeInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  activeModel: string;
  providerName?: string;
  status: { state: string; turn?: number };
  currentThought?: string;
  activityHistory: LiveActivityItem[];
  tools?: ToolCallItem[];
  elapsedSeconds: number;
}

export const ClaudeCodeInspector: React.FC<ClaudeCodeInspectorProps> = ({
  isOpen,
  onClose,
  activeModel,
  providerName = 'Ollama (Local)',
  status,
  currentThought,
  activityHistory,
  tools = [],
  elapsedSeconds
}) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'thoughts' | 'tools' | 'raw'>('timeline');
  const [copied, setCopied] = useState(false);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Auto scroll timeline on new activity
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activityHistory, currentThought]);

  if (!isOpen) return null;

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleCopyTranscript = () => {
    const transcript = {
      model: activeModel,
      provider: providerName,
      status: status.state,
      turn: status.turn,
      elapsed: `${elapsedSeconds}s`,
      thought: currentThought,
      activities: activityHistory,
      tools: tools
    };
    navigator.clipboard.writeText(JSON.stringify(transcript, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[540px] md:w-[620px] bg-studio-surface border-l border-studio-border shadow-2xl flex flex-col select-text animate-in slide-in-from-right duration-200">
      {/* Top Header */}
      <div className="h-12 px-4 border-b border-studio-border bg-studio-panel/70 flex items-center justify-between select-none">
        <div className="flex items-center space-x-2.5">
          <div className="w-7 h-7 rounded-card bg-role-user-600/20 border border-role-user-500/30 flex items-center justify-center text-role-user-400">
            <Terminal size={15} />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-xs font-bold text-slate-100 flex items-center space-x-1.5">
                <span>Claude Code Live Inspector</span>
              </h3>
              <kbd className="px-1.5 py-0.5 rounded bg-black/40 border border-white/10 text-micro font-mono text-role-user-300">
                Ctrl + O
              </kbd>
            </div>
            <p className="text-micro text-slate-400 font-mono truncate">
              {providerName} • <strong className="text-slate-300">{activeModel}</strong>
              {status.turn ? ` • Turn ${status.turn}/25` : ''}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Live Status Pill */}
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-studio-bg border border-studio-border text-micro font-mono text-slate-300">
            <span className={`w-1.5 h-1.5 rounded-full ${
              status.state === 'thinking' 
                ? 'bg-role-tool-400 animate-ping' 
                : status.state === 'busy' 
                ? 'bg-role-user-400 animate-pulse' 
                : 'bg-state-ok-400'
            }`} />
            <span className="capitalize">{status.state}</span>
            <span>({elapsedSeconds}s)</span>
          </div>

          <button
            onClick={handleCopyTranscript}
            className="p-1.5 rounded-card text-slate-400 hover:text-slate-200 hover:bg-studio-panel border border-studio-border transition"
            title="Copy Inspector Transcript to Clipboard"
          >
            {copied ? <Check size={13} className="text-state-ok-400" /> : <Copy size={13} />}
          </button>

          <button
            onClick={onClose}
            className="p-1.5 rounded-card text-slate-400 hover:text-slate-200 hover:bg-studio-panel border border-studio-border transition cursor-pointer"
            title="Close Inspector (Esc or Ctrl+O)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="px-4 py-2 bg-studio-panel/40 border-b border-studio-border flex items-center space-x-2 select-none">
        <button
          onClick={() => setActiveTab('timeline')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-micro font-medium transition cursor-pointer ${
            activeTab === 'timeline'
              ? 'bg-role-user-600/20 text-role-user-300 border border-role-user-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers size={12} />
          <span>Execution Timeline</span>
          {activityHistory.length > 0 && (
            <span className="ml-1 px-1 rounded-full bg-role-user-500/30 text-micro font-mono">{activityHistory.length}</span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('thoughts')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-micro font-medium transition cursor-pointer ${
            activeTab === 'thoughts'
              ? 'bg-role-user-600/20 text-role-user-300 border border-role-user-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <BrainCircuit size={12} />
          <span>Model Thoughts</span>
        </button>

        <button
          onClick={() => setActiveTab('tools')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-micro font-medium transition cursor-pointer ${
            activeTab === 'tools'
              ? 'bg-role-user-600/20 text-role-user-300 border border-role-user-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <Wrench size={12} />
          <span>Tool Calls ({tools.length})</span>
        </button>

        <button
          onClick={() => setActiveTab('raw')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-control text-micro font-medium transition cursor-pointer ${
            activeTab === 'raw'
              ? 'bg-role-user-600/20 text-role-user-300 border border-role-user-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileCode size={12} />
          <span>Raw Transcript</span>
        </button>
      </div>

      {/* Main Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 font-mono text-xs">
        {/* TAB 1: Timeline */}
        {activeTab === 'timeline' && (
          <div className="space-y-3">
            {activityHistory.length === 0 && !currentThought ? (
              <div className="p-8 text-center text-slate-500 font-sans">
                <Terminal size={24} className="mx-auto mb-2 text-slate-600" />
                <p className="text-xs font-medium text-slate-400">No active turn running</p>
                <p className="text-micro text-slate-500 mt-1">
                  Send a prompt in the chat box to watch live thoughts, tool executions, and diffs here in real time.
                </p>
              </div>
            ) : null}

            {/* Current Active Thought Card */}
            {currentThought && (
              <div className="p-3 rounded-card bg-role-tool-500/10 border border-role-tool-500/30 text-role-tool-200 text-xs shadow-md animate-in fade-in">
                <div className="flex items-center space-x-2 mb-1.5 font-bold text-micro text-role-tool-300">
                  <BrainCircuit size={13} className="animate-spin" />
                  <span>LIVE REASONING / CHAIN OF THOUGHT</span>
                </div>
                <div className="whitespace-pre-wrap font-mono text-micro leading-relaxed text-role-tool-100/90 max-h-48 overflow-y-auto pr-1">
                  {currentThought}
                </div>
              </div>
            )}

            {/* Timeline Events */}
            {activityHistory.map((item, idx) => {
              const isExpanded = !!expandedItems[item.id];
              return (
                <div 
                  key={item.id || idx}
                  className={`p-3 rounded-card border transition-all ${
                    item.type === 'tool'
                      ? 'bg-studio-panel/60 border-studio-border hover:border-slate-600'
                      : item.type === 'thinking'
                      ? 'bg-role-tool-950/20 border-role-tool-500/30 text-role-tool-200'
                      : 'bg-studio-panel/40 border-studio-border'
                  }`}
                >
                  <div 
                    onClick={() => toggleExpand(item.id)}
                    className="flex items-center justify-between cursor-pointer select-none"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      {isExpanded ? <ChevronDown size={13} className="text-slate-400" /> : <ChevronRight size={13} className="text-slate-400" />}
                      
                      {item.type === 'tool' ? (
                        <Wrench size={13} className="text-role-user-400 flex-shrink-0" />
                      ) : item.type === 'thinking' ? (
                        <BrainCircuit size={13} className="text-role-tool-400 flex-shrink-0" />
                      ) : (
                        <Sparkles size={13} className="text-state-ok-400 flex-shrink-0" />
                      )}

                      <span className="font-semibold text-slate-200 text-xs truncate">
                        {item.title}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2 flex-shrink-0 text-micro text-slate-400">
                      {item.status === 'running' ? (
                        <span className="px-1.5 py-0.5 rounded bg-role-tool-500/20 text-role-tool-300 font-mono">Running...</span>
                      ) : item.status === 'failed' ? (
                        <span className="px-1.5 py-0.5 rounded bg-state-danger-500/20 text-state-danger-300 font-mono">Failed</span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded bg-state-ok-500/20 text-state-ok-300 font-mono">OK</span>
                      )}
                      <span>{item.timestamp}</span>
                    </div>
                  </div>

                  {/* Summary line */}
                  <div className="mt-1 ml-5 text-micro text-slate-400 font-mono truncate">
                    {item.summary}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-2 ml-5 pt-2 border-t border-white/5 space-y-2 text-micro">
                      {item.toolArgs && (
                        <div>
                          <span className="text-micro uppercase font-bold text-role-user-300">Arguments:</span>
                          <pre className="mt-1 p-2 rounded bg-black/50 border border-white/5 overflow-x-auto text-micro text-slate-300">
                            {JSON.stringify(item.toolArgs, null, 2)}
                          </pre>
                        </div>
                      )}

                      {item.toolOutput && (
                        <div>
                          <span className="text-micro uppercase font-bold text-state-ok-300">Output:</span>
                          <pre className="mt-1 p-2 rounded bg-black/50 border border-white/5 overflow-x-auto text-micro text-state-ok-200/90 max-h-48">
                            {item.toolOutput}
                          </pre>
                        </div>
                      )}

                      {item.diff && (
                        <div>
                          <span className="text-micro uppercase font-bold text-role-architect-300">File Diff ({item.diff.path}):</span>
                          <div className="mt-1 p-2 rounded bg-black/60 border border-role-architect-500/20 text-micro font-mono overflow-x-auto max-h-48">
                            <div className="text-state-danger-400 whitespace-pre-wrap font-sans">{item.diff.oldContent.slice(0, 200)}...</div>
                            <div className="text-state-ok-400 whitespace-pre-wrap font-sans mt-1">→ {item.diff.newContent.slice(0, 200)}...</div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TAB 2: Model Thoughts */}
        {activeTab === 'thoughts' && (
          <div className="space-y-3">
            <div className="p-3 bg-studio-panel/50 border border-studio-border rounded-card">
              <h4 className="text-xs font-semibold text-slate-200 mb-2 flex items-center space-x-1.5">
                <BrainCircuit size={13} className="text-role-user-400" />
                <span>Active Model Chain-of-Thought</span>
              </h4>
              <p className="text-micro text-slate-400 mb-3 font-sans">
                Real-time thought stream produced by local reasoning tokens (e.g. Qwen or DeepSeek R1) before generating code edits.
              </p>

              {currentThought ? (
                <pre className="p-3 bg-black/50 border border-white/5 rounded-card text-role-tool-200 text-xs whitespace-pre-wrap leading-relaxed max-h-[60vh] overflow-y-auto">
                  {currentThought}
                </pre>
              ) : (
                <div className="p-6 text-center text-slate-500 font-sans text-xs">
                  No active chain of thought in the current turn.
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: Tool Calls */}
        {activeTab === 'tools' && (
          <div className="space-y-3">
            {tools.length === 0 ? (
              <div className="p-8 text-center text-slate-500 font-sans text-xs">
                No tool calls executed yet.
              </div>
            ) : (
              tools.map((t, idx) => (
                <div key={t.id || idx} className="p-3 rounded-card bg-studio-panel border border-studio-border space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center space-x-2">
                      <Wrench size={13} className="text-role-user-400" />
                      <strong className="text-slate-200">{t.name}</strong>
                    </div>
                    <span className={`px-2 py-0.5 rounded text-micro font-medium ${
                      t.status === 'success' ? 'bg-state-ok-500/20 text-state-ok-300' :
                      t.status === 'failed' ? 'bg-state-danger-500/20 text-state-danger-300' :
                      'bg-role-tool-500/20 text-role-tool-300'
                    }`}>
                      {t.status}
                    </span>
                  </div>

                  <div>
                    <span className="text-micro uppercase font-bold text-slate-400">Arguments:</span>
                    <pre className="mt-1 p-2 rounded bg-black/50 border border-white/5 overflow-x-auto text-micro text-slate-300">
                      {JSON.stringify(t.args, null, 2)}
                    </pre>
                  </div>

                  {t.output && (
                    <div>
                      <span className="text-micro uppercase font-bold text-slate-400">Output:</span>
                      <pre className="mt-1 p-2 rounded bg-black/50 border border-white/5 overflow-x-auto text-micro text-state-ok-300/90 max-h-36">
                        {t.output}
                      </pre>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 4: Raw Transcript */}
        {activeTab === 'raw' && (
          <div className="space-y-2">
            <pre className="p-3 bg-black/60 border border-white/5 rounded-card text-micro text-slate-300 leading-relaxed overflow-x-auto">
              {JSON.stringify({
                model: activeModel,
                provider: providerName,
                status,
                elapsed: `${elapsedSeconds}s`,
                activities: activityHistory,
                tools
              }, null, 2)}
            </pre>
          </div>
        )}
      </div>

      {/* Footer Info */}
      <div className="px-4 py-2 border-t border-studio-border bg-studio-panel/50 flex items-center justify-between text-micro text-slate-400 select-none">
        <span>Press <kbd className="px-1 py-0.5 rounded bg-black/40 border border-white/10 font-mono text-slate-300">Ctrl + O</kbd> or <kbd className="px-1 py-0.5 rounded bg-black/40 border border-white/10 font-mono text-slate-300">Esc</kbd> to toggle</span>
        <span>Strata Code Agent Engine</span>
      </div>
    </div>
  );
};
