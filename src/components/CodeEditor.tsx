import React, { useState, useRef, useEffect } from 'react';
import Editor, { DiffEditor, loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import jsonWorker from 'monaco-editor/language/json/json.worker.js?worker';
import cssWorker from 'monaco-editor/language/css/css.worker.js?worker';
import htmlWorker from 'monaco-editor/language/html/html.worker.js?worker';
import tsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker';

// Monaco is bundled from node_modules and served by Vite, not fetched from
// jsdelivr on every launch: the editor used to be blank offline (and after a
// cleared cache), and the CDN's 0.55 did not match the local 0.56 typings.
(self as any).MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    switch (label) {
      case 'json': return new jsonWorker();
      case 'css': case 'scss': case 'less': return new cssWorker();
      case 'html': case 'handlebars': case 'razor': return new htmlWorker();
      case 'typescript': case 'javascript': return new tsWorker();
      default: return new editorWorker();
    }
  }
};
loader.config({ monaco });
import { 
  X, Save, FileCode, PanelRightClose, Sparkles, GitCompare, Check, RotateCcw, Loader2, ArrowRight
} from 'lucide-react';
import { OpenTab, ActiveDiff } from '../types';

interface CodeEditorProps {
  tabs: OpenTab[];
  activeTabPath: string | null;
  onSelectTab: (path: string) => void;
  onCloseTab: (path: string) => void;
  onCloseEditor: () => void;
  onChangeContent: (path: string, content: string) => void;
  onSave: (path: string) => void;
  activeDiff?: ActiveDiff | null;
  onCloseDiff?: () => void;
  onAcceptDiff?: (diff: ActiveDiff) => void;
  onRevertDiff?: (diff: ActiveDiff) => void;
  activeModel?: string;
}

const CodeEditorInner: React.FC<CodeEditorProps> = ({
  tabs,
  activeTabPath,
  onSelectTab,
  onCloseTab,
  onCloseEditor,
  onChangeContent,
  onSave,
  activeDiff,
  onCloseDiff,
  onAcceptDiff,
  onRevertDiff,
  activeModel = 'qwen2.5-coder:32b'
}) => {
  const activeTab = tabs.find(t => t.path === activeTabPath);
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);

  // Real-time canvas resize listener: forces Monaco to adapt instantly without cutting off text
  useEffect(() => {
    if (!editorContainerRef.current) return;
    const ro = new ResizeObserver(() => {
      if (editorRef.current) {
        editorRef.current.layout();
      }
    });
    ro.observe(editorContainerRef.current);
    return () => ro.disconnect();
  }, []);

  // Inline AI (Ctrl+K) states
  const [isInlineAiOpen, setIsInlineAiOpen] = useState(false);
  const [inlinePrompt, setInlinePrompt] = useState('');
  const [isInlineGenerating, setIsInlineGenerating] = useState(false);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const getLanguage = (fileName: string = '') => {
    const lower = fileName.toLowerCase();
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
    if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return 'javascript';
    if (lower.endsWith('.py')) return 'python';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
    if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) return 'css';
    if (lower.endsWith('.json')) return 'json';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
    if (lower.endsWith('.sql')) return 'sql';
    if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
    if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return 'shell';
    if (lower.endsWith('.ps1') || lower.endsWith('.psm1')) return 'powershell';
    if (lower.endsWith('.cpp') || lower.endsWith('.cc') || lower.endsWith('.cxx') || lower.endsWith('.c') || lower.endsWith('.h') || lower.endsWith('.hpp')) return 'cpp';
    if (lower.endsWith('.rs')) return 'rust';
    if (lower.endsWith('.go')) return 'go';
    if (lower.endsWith('.java')) return 'java';
    if (lower.endsWith('.xml') || lower.endsWith('.svg')) return 'xml';
    if (lower.includes('dockerfile')) return 'dockerfile';
    if (lower.endsWith('.ini') || lower.endsWith('.env') || lower.endsWith('.toml')) return 'ini';
    return 'plaintext';
  };

  const handleOpenInlineAi = () => {
    setIsInlineAiOpen(true);
    setInlineError(null);
    setTimeout(() => inlineInputRef.current?.focus(), 50);
  };

  const handleExecuteInlineAi = async () => {
    if (!inlinePrompt.trim() || isInlineGenerating || !editorRef.current) return;

    const editor = editorRef.current;
    const model = editor.getModel();
    if (!model) return;

    const selection = editor.getSelection();
    const selectedCode = model.getValueInRange(selection);
    const language = getLanguage(activeTab?.name || '');

    setIsInlineGenerating(true);
    setInlineError(null);

    const api = (window as any).api;
    try {
      const res = await api?.inlineGenerate?.({
        prompt: inlinePrompt,
        selectedCode,
        language,
        model: activeModel
      });

      if (res?.success && typeof res.code === 'string') {
        const op = {
          range: selection,
          text: res.code,
          forceMoveMarkers: true
        };
        editor.executeEdits('inline-ai', [op]);
        if (activeTab) {
          onChangeContent(activeTab.path, editor.getValue());
        }
        setIsInlineAiOpen(false);
        setInlinePrompt('');
      } else {
        setInlineError(res?.error || 'Inline generation failed.');
      }
    } catch (err: any) {
      setInlineError(err.message || 'Inline generation error.');
    } finally {
      setIsInlineGenerating(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-studio-bg overflow-hidden min-w-0 relative">
      {/* Tab bar */}
      <div className="h-9 bg-studio-surface border-b border-studio-border flex items-center justify-between px-1 overflow-x-auto select-none">
        <div className="flex items-center h-full space-x-0.5 overflow-x-auto">
          {tabs.map(tab => {
            const isActive = tab.path === activeTabPath && !activeDiff;
            return (
              <div
                key={tab.path}
                onClick={() => {
                  if (activeDiff && onCloseDiff) onCloseDiff();
                  onSelectTab(tab.path);
                }}
                className={`flex items-center space-x-1.5 h-full px-3 text-xs cursor-pointer border-r border-studio-border/50 transition group ${
                  isActive 
                    ? 'bg-studio-bg text-slate-100 font-medium border-t-2 border-t-indigo-500' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-studio-panel/50'
                }`}
              >
                <FileCode size={13} className={isActive ? 'text-role-user-400' : 'text-slate-400'} />
                <span className="max-w-[150px] truncate">{tab.name}</span>
                {tab.isDirty && (
                  <span className="w-1.5 h-1.5 rounded-full bg-role-tool-400 ml-1"></span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.path);
                  }}
                  className="p-0.5 rounded-full hover:bg-studio-panel hover:text-slate-100 opacity-60 group-hover:opacity-100 transition ml-1"
                  title="Close file"
                >
                  <X size={12} />
                </button>
              </div>
            );
          })}

          {/* Active Diff Tab if diff is open */}
          {activeDiff && (
            <div className="flex items-center space-x-1.5 h-full px-3 text-xs cursor-pointer border-r border-studio-border/50 bg-studio-bg text-role-tool-300 font-medium border-t-2 border-t-amber-500">
              <GitCompare size={13} className="text-role-tool-400" />
              <span className="max-w-[150px] truncate">Diff: {activeDiff.path.split(/[\\/]/).pop()}</span>
              {onCloseDiff && (
                <button
                  onClick={onCloseDiff}
                  className="p-0.5 rounded-full hover:bg-studio-panel hover:text-slate-100 transition ml-1"
                  title="Close Diff"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right Tab Controls: Inline AI, Save & Expand Studio */}
        <div className="flex items-center space-x-1.5 mr-2 flex-shrink-0">
          {activeTab && !activeDiff && (
            <>
              <button
                onClick={handleOpenInlineAi}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-role-user-600/15 hover:bg-role-user-600/25 border border-role-user-500/30 text-xs text-role-user-300 transition"
                title="Inline AI refactoring (Ctrl+K)"
              >
                <Sparkles size={12} className="text-role-user-400" />
                <span className="hidden sm:inline">Ctrl+K</span>
              </button>

              <button
                onClick={() => onSave(activeTab.path)}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-studio-panel hover:bg-role-user-600/20 hover:text-role-user-300 border border-studio-border text-xs text-slate-300 transition"
                title="Save (Ctrl+S)"
              >
                <Save size={12} />
                <span className="hidden sm:inline">Save</span>
              </button>
            </>
          )}

          <button
            onClick={onCloseEditor}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-studio-panel hover:bg-role-user-600/20 hover:text-role-user-300 border border-studio-border hover:border-role-user-500/40 text-xs text-slate-400 transition"
            title="Close Code Review & Expand Agent Studio (Full Width)"
          >
            <PanelRightClose size={13} />
            <span className="hidden md:inline">Expand Studio</span>
          </button>
        </div>
      </div>

      {/* Side-by-side Diff Toolbar Banner */}
      {activeDiff && (
        <div className="h-9 bg-role-tool-950/40 border-b border-role-tool-500/30 flex items-center justify-between px-3 text-xs flex-shrink-0">
          <div className="flex items-center space-x-2 text-role-tool-200">
            <GitCompare size={14} className="text-role-tool-400" />
            <span className="font-semibold">Side-by-Side Diff:</span>
            <span className="font-mono text-slate-300">{activeDiff.path}</span>
            <span className="text-micro text-slate-400">(Red = Original, Green = Proposed)</span>
          </div>

          <div className="flex items-center space-x-2">
            {onAcceptDiff && (
              <button
                onClick={() => onAcceptDiff(activeDiff)}
                className="flex items-center space-x-1 px-2.5 py-1 rounded bg-state-ok-600 hover:bg-state-ok-500 text-white font-medium transition shadow-sm"
                title="Accept all changes into the file"
              >
                <Check size={13} />
                <span>Accept Changes</span>
              </button>
            )}

            {onRevertDiff && (
              <button
                onClick={() => onRevertDiff(activeDiff)}
                className="flex items-center space-x-1 px-2 py-1 rounded bg-state-danger-600/80 hover:bg-state-danger-600 text-white transition"
                title="Revert back to original file content"
              >
                <RotateCcw size={12} />
                <span>Revert</span>
              </button>
            )}

            {onCloseDiff && (
              <button
                onClick={onCloseDiff}
                className="p-1 rounded hover:bg-studio-panel text-slate-400 hover:text-slate-200 transition"
                title="Close Diff"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Floating Inline AI (Ctrl+K) Prompt Bar */}
      {isInlineAiOpen && (
        <div className="absolute top-11 right-4 z-40 w-96 bg-studio-surface border border-role-user-500/50 rounded-card shadow-2xl p-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-role-user-300">
              <Sparkles size={13} className="text-role-user-400" />
              <span>Inline AI (Ctrl+K)</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-micro font-mono text-slate-400 bg-black/40 px-1.5 py-0.5 rounded border border-studio-border">
                {activeModel}
              </span>
              <button
                onClick={() => setIsInlineAiOpen(false)}
                className="p-0.5 hover:bg-studio-panel rounded text-slate-400 hover:text-slate-200"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          <div className="relative flex items-center">
            <input
              ref={inlineInputRef}
              type="text"
              value={inlinePrompt}
              onChange={(e) => setInlinePrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleExecuteInlineAi();
                } else if (e.key === 'Escape') {
                  setIsInlineAiOpen(false);
                }
              }}
              placeholder="Refactor selection, fix bug, add types..."
              disabled={isInlineGenerating}
              className="w-full bg-studio-bg border border-studio-border focus:border-role-user-500 rounded-card py-1.5 pl-2.5 pr-8 text-xs text-slate-200 placeholder-slate-400 focus:outline-none font-sans"
            />
            <button
              onClick={handleExecuteInlineAi}
              disabled={!inlinePrompt.trim() || isInlineGenerating}
              className="absolute right-1.5 p-1 rounded hover:bg-role-user-600/30 text-role-user-400 disabled:opacity-40 transition"
              title="Apply (Enter)"
            >
              {isInlineGenerating ? (
                <Loader2 size={13} className="animate-spin text-role-user-400" />
              ) : (
                <ArrowRight size={13} />
              )}
            </button>
          </div>

          {inlineError && (
            <div className="mt-1.5 text-micro text-state-danger-400">
              {inlineError}
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-micro text-slate-400">
            <span>Press <kbd className="px-1 py-0.5 bg-black/40 rounded font-mono">Enter</kbd> to generate</span>
            <span><kbd className="px-1 py-0.5 bg-black/40 rounded font-mono">Esc</kbd> to cancel</span>
          </div>
        </div>
      )}

      {/* Editor Body */}
      <div ref={editorContainerRef} className="flex-1 w-full h-full min-w-0 overflow-hidden relative">
        {activeDiff ? (
          <DiffEditor
            height="100%"
            theme="vs-dark"
            original={activeDiff.oldContent}
            modified={activeDiff.newContent}
            language={getLanguage(activeDiff.path)}
            options={{
              renderSideBySide: true,
              readOnly: true,
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Consolas', monospace",
              wordWrap: 'on',
              wrappingStrategy: 'advanced',
              wrappingIndent: 'same',
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              renderLineHighlight: 'none'
            }}
          />
        ) : activeTab ? (
          <Editor
            height="100%"
            theme="vs-dark"
            path={activeTab.path}
            language={getLanguage(activeTab.name)}
            value={activeTab.content}
            onChange={(val) => onChangeContent(activeTab.path, val || '')}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoRef.current = monaco;

              // Save shortcut
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                if (activeTab) onSave(activeTab.path);
              });

              // Inline AI shortcut
              editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
                handleOpenInlineAi();
              });
            }}
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Consolas', monospace",
              minimap: { enabled: false },
              wordWrap: 'on',
              wrappingStrategy: 'advanced',
              wrappingIndent: 'same',
              scrollBeyondLastLine: false,
              smoothScrolling: true,
              automaticLayout: true,
              padding: { top: 12, bottom: 12 },
              cursorSmoothCaretAnimation: 'on',
              renderLineHighlight: 'none',
              wordBasedSuggestions: 'off'
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-12 h-12 rounded-card bg-studio-panel flex items-center justify-center mb-3 border border-studio-border text-role-user-400 shadow-inner">
              <FileCode size={24} />
            </div>
            <h3 className="text-sm font-semibold text-slate-300">No file open</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mb-4">
              Select a file from the explorer on the left, or expand Agent Studio to focus entirely on prompting.
            </p>
            <button
              onClick={onCloseEditor}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-card bg-role-user-600/20 hover:bg-role-user-600/30 text-role-user-300 border border-role-user-500/40 text-xs font-medium transition cursor-pointer"
            >
              <Sparkles size={13} />
              <span>Expand Agent Studio Full-Width</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

// Memoized. App holds all state in one component, so without this every
// streamed chunk re-rendered this whole subtree. Effective only because the
// handlers App passes down are now referentially stable (useEventCallback).
export const CodeEditor = React.memo(CodeEditorInner);
