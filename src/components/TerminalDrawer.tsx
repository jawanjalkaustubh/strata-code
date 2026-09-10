import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, X, Play, Trash2, ArrowUpRight, CheckCircle2, AlertCircle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { TerminalHistoryItem } from '../types';

interface TerminalDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: string;
}

const TerminalDrawerInner: React.FC<TerminalDrawerProps> = ({
  isOpen,
  onClose,
  workspace
}) => {
  const api = (window as any).api;
  const [command, setCommand] = useState('');
  const [history, setHistory] = useState<TerminalHistoryItem[]>([]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [isOpen]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history, isExecuting]);

  const handleRunCommand = async (cmdToRun?: string) => {
    const targetCmd = (cmdToRun || command).trim();
    if (!targetCmd || isExecuting) return;

    setIsExecuting(true);
    if (!cmdToRun) setCommand('');

    // Add to command history for up/down arrow recall
    setCommandHistory(prev => [...prev.filter(c => c !== targetCmd), targetCmd]);
    setHistoryIndex(-1);

    const timestamp = new Date().toLocaleTimeString();
    const itemId = `term_${Date.now()}`;

    try {
      const res = await api?.runTerminalCommand?.(targetCmd);
      const resultItem: TerminalHistoryItem = {
        id: itemId,
        command: targetCmd,
        stdout: res?.stdout || '',
        stderr: res?.stderr || '',
        exitCode: typeof res?.exitCode === 'number' ? res.exitCode : 0,
        timestamp
      };
      setHistory(prev => [...prev, resultItem]);
    } catch (err: any) {
      setHistory(prev => [
        ...prev,
        {
          id: itemId,
          command: targetCmd,
          stdout: '',
          stderr: err.message || 'Execution error',
          exitCode: 1,
          timestamp
        }
      ]);
    } finally {
      setIsExecuting(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleRunCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (commandHistory.length === 0) return;
      const nextIndex = historyIndex === -1 ? commandHistory.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setCommand(commandHistory[nextIndex] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= commandHistory.length) {
        setHistoryIndex(-1);
        setCommand('');
      } else {
        setHistoryIndex(nextIndex);
        setCommand(commandHistory[nextIndex] || '');
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className={`border-t border-studio-border bg-[#080a0f] flex flex-col transition-all duration-200 z-30 shadow-2xl select-none ${
        isMaximized ? 'h-[460px]' : 'h-[240px]'
      }`}
    >
      {/* Drawer Header */}
      <div className="h-8 bg-studio-surface border-b border-studio-border flex items-center justify-between px-3 text-xs flex-shrink-0">
        <div className="flex items-center space-x-2">
          <TerminalIcon size={13} className="text-role-user-400" />
          <span className="font-semibold text-slate-200">Terminal</span>
          <span className="text-micro font-mono text-slate-400 bg-black/40 px-1.5 py-0.5 rounded border border-studio-border max-w-[200px] truncate" title={workspace}>
            {workspace}
          </span>
        </div>

        {/* Preset shortcut buttons */}
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => handleRunCommand('git status')}
            disabled={isExecuting}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-studio-panel hover:bg-studio-border text-micro text-slate-300 transition"
            title="Run 'git status'"
          >
            <span>git status</span>
          </button>

          <button
            onClick={() => handleRunCommand('git diff --stat')}
            disabled={isExecuting}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-studio-panel hover:bg-studio-border text-micro text-slate-300 transition"
            title="Run 'git diff --stat'"
          >
            <span>git diff</span>
          </button>

          <button
            onClick={() => handleRunCommand('npm test')}
            disabled={isExecuting}
            className="flex items-center space-x-1 px-2 py-0.5 rounded bg-studio-panel hover:bg-studio-border text-micro text-slate-300 transition"
            title="Run 'npm test'"
          >
            <span>npm test</span>
          </button>

          <div className="h-3 w-[1px] bg-studio-border mx-1" />

          <button
            onClick={() => setHistory([])}
            className="p-1 hover:bg-studio-panel rounded text-slate-400 hover:text-slate-200 transition"
            title="Clear Terminal (Ctrl+L)"
          >
            <Trash2 size={12} />
          </button>

          <button
            onClick={() => setIsMaximized(!isMaximized)}
            className="p-1 hover:bg-studio-panel rounded text-slate-400 hover:text-slate-200 transition"
            title={isMaximized ? "Collapse Height" : "Maximize Height"}
          >
            {isMaximized ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
          </button>

          <button
            onClick={onClose}
            className="p-1 hover:bg-state-danger-500/20 hover:text-state-danger-300 rounded text-slate-400 transition"
            title="Close Terminal (Ctrl+`)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* Output Console Log */}
      <div className="flex-1 p-3 overflow-y-auto font-mono text-micro space-y-2 select-text bg-[#080a0f]">
        {history.length === 0 && (
          <div className="text-slate-500 text-xs py-2 italic select-none">
            PowerShell ready. Type any command below or click a quick action above...
          </div>
        )}

        {history.map(item => (
          <div key={item.id} className="space-y-1">
            <div className="flex items-center space-x-2 text-slate-400 font-semibold select-none">
              <span className="text-role-user-400">PS &gt;</span>
              <span className="text-slate-200">{item.command}</span>
              <span className="text-micro text-slate-400 font-normal">[{item.timestamp}]</span>
              {item.exitCode === 0 ? (
                <span className="text-state-ok-400 text-micro flex items-center space-x-0.5">
                  <CheckCircle2 size={10} />
                  <span>0</span>
                </span>
              ) : (
                <span className="text-state-danger-400 text-micro flex items-center space-x-0.5">
                  <AlertCircle size={10} />
                  <span>exit {item.exitCode}</span>
                </span>
              )}
            </div>

            {item.stdout && (
              <pre className="text-slate-300 whitespace-pre-wrap pl-3 border-l border-role-user-500/20 leading-relaxed font-mono">
                {item.stdout}
              </pre>
            )}

            {item.stderr && (
              <pre className="text-state-danger-400 whitespace-pre-wrap pl-3 border-l border-state-danger-500/40 leading-relaxed font-mono">
                {item.stderr}
              </pre>
            )}
          </div>
        ))}

        {isExecuting && (
          <div className="flex items-center space-x-2 text-role-tool-400 py-1 select-none">
            <Loader2 size={12} className="animate-spin" />
            <span>Running...</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Interactive Command Input */}
      <div className="h-9 border-t border-studio-border bg-studio-surface/90 flex items-center px-3 space-x-2 flex-shrink-0">
        <span className="text-role-user-400 font-mono text-xs font-bold select-none">PS &gt;</span>
        <input
          ref={inputRef}
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type command and press Enter (e.g. dir, git status, npm run dev)..."
          disabled={isExecuting}
          className="flex-1 bg-transparent text-xs font-mono text-slate-100 placeholder-slate-400 focus:outline-none"
        />
        <button
          onClick={() => handleRunCommand()}
          disabled={!command.trim() || isExecuting}
          className="p-1 rounded hover:bg-role-user-600/20 text-role-user-400 hover:text-role-user-300 disabled:opacity-30 transition"
          title="Execute Command (Enter)"
        >
          <Play size={12} />
        </button>
      </div>
    </div>
  );
};

// Memoized. App holds all state in one component, so without this every
// streamed chunk re-rendered this whole subtree. Effective only because the
// handlers App passes down are now referentially stable (useEventCallback).
export const TerminalDrawer = React.memo(TerminalDrawerInner);
