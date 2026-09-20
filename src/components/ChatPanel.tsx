import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  Send, Square, Sparkles, CheckCircle2, AlertCircle, Wrench, ShieldAlert, Shield, Check, X, Loader2, BrainCircuit, Columns, PanelRightClose, Code2, MessageSquare, Cpu, Copy, RotateCcw, GitCompare, FileCode, Paperclip, Gauge, HardDrive, Zap, ExternalLink, Plus, Image as ImageIcon
} from 'lucide-react';
import { ChatMessage, ToolCallItem, TaskMode, FileNode, SystemInfo, CollaborateStepData, HybridTier } from '../types';
import { STRATA_ICON } from '../assets/logo';
import { ActivityInspector, LiveActivityItem } from './ActivityInspector';

interface ChatPanelProps {
  messages: ChatMessage[];
  status: { state: string; turn?: number };
  pendingApproval: ToolCallItem | null;
  onSendMessage: (prompt: string, images?: string[]) => void;
  onStop: () => void;
  onApprove: (approvalId: string, approved: boolean) => void;
  onNewChat?: () => void;
  isEditorOpen: boolean;
  onToggleEditor: () => void;
  width?: number;
  taskMode: TaskMode;
  onSelectTaskMode: (mode: TaskMode) => void;
  activeModel: string;
  files?: FileNode[];
  systemInfo?: SystemInfo | null;
  onOpenDiff?: (diff: { path: string; oldContent: string; newContent: string }) => void;
  activeFile?: string | null;
  openTabs?: { path: string; name: string }[];
  collaborateStep?: CollaborateStepData | null;
  onOpenModelManager?: () => void;
  isHybrid?: boolean;
  onToggleHybrid?: () => void;
  hybridTier?: HybridTier;
  onSelectHybridTier?: (tier: HybridTier) => void;
  autoMode?: boolean;
  onToggleAutoMode?: () => void;
  codingModel?: string;
  generalModel?: string;
  architectModel?: string;
  onOpenDualBrainModal?: () => void;
  onSelectArchitectModel?: (modelId: string) => void;
}

const CodeBlock: React.FC<{ code: string; language?: string }> = ({ code, language }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-2 rounded-card overflow-hidden border border-studio-border bg-black/60 shadow-md">
      <div className="flex items-center justify-between px-3 py-1.5 bg-studio-bg/90 border-b border-studio-border text-micro font-mono text-slate-400">
        <span className="font-semibold text-role-user-300 uppercase text-micro tracking-wider">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center space-x-1 hover:text-slate-200 transition px-1.5 py-0.5 rounded bg-studio-panel hover:bg-studio-surface border border-studio-border/50 text-micro cursor-pointer"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check size={11} className="text-state-ok-400" />
              <span className="text-state-ok-400 font-medium">Copied!</span>
            </>
          ) : (
            <>
              <Copy size={11} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto text-micro font-mono text-slate-200 leading-relaxed select-text">
        <code>{code}</code>
      </pre>
    </div>
  );
};

const FormattedContent: React.FC<{ content: string }> = ({ content }) => {
  // Strip <think>...</think> tags and open <think> during streaming so reasoning tokens don't leak or glitch
  const cleaned = content.replace(/<think>[\s\S]*?(?:<\/think>|$)/g, '').trimStart();
  const regex = /```([a-zA-Z0-9_\-#+.]*)\n([\s\S]*?)```/g;
  const parts: { type: 'text' | 'code'; content: string; language?: string }[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: cleaned.slice(lastIndex, match.index) });
    }
    parts.push({
      type: 'code',
      language: match[1].trim() || 'code',
      content: match[2].replace(/\n$/, '')
    });
    lastIndex = regex.lastIndex;
  }

  const remaining = cleaned.slice(lastIndex);
  if (remaining) {
    // Gracefully handle unclosed code block during real-time token streaming
    const unclosed = remaining.match(/^([\s\S]*?)```([a-zA-Z0-9_\-#+.]*)\n([\s\S]*)$/);
    if (unclosed) {
      if (unclosed[1]) parts.push({ type: 'text', content: unclosed[1] });
      parts.push({
        type: 'code',
        language: unclosed[2].trim() || 'code',
        content: unclosed[3]
      });
    } else {
      parts.push({ type: 'text', content: remaining });
    }
  }

  return (
    <div className="text-xs leading-relaxed space-y-1">
      {parts.map((p, i) =>
        p.type === 'code' ? (
          <CodeBlock key={i} code={p.content} language={p.language} />
        ) : (
          <span key={i} className="whitespace-pre-wrap font-sans text-slate-200">
            {p.content}
          </span>
        )
      )}
    </div>
  );
};

export const ChatPanel: React.FC<ChatPanelProps> = ({
  messages,
  status,
  pendingApproval,
  onSendMessage,
  onStop,
  onApprove,
  onNewChat,
  isEditorOpen,
  onToggleEditor,
  width = 480,
  taskMode,
  onSelectTaskMode,
  activeModel,
  files = [],
  systemInfo,
  onOpenDiff,
  activeFile,
  openTabs,
  collaborateStep,
  onOpenModelManager,
  isHybrid = false,
  onToggleHybrid,
  hybridTier = 'medium',
  onSelectHybridTier,
  autoMode = true,
  onToggleAutoMode,
  codingModel = 'qwen2.5-coder:32b',
  generalModel = 'qwen3.8:27b',
  architectModel = 'qwen3.8:27b',
  onOpenDualBrainModal,
  onSelectArchitectModel
}) => {
  const openModelConfig = onOpenDualBrainModal;
  const [input, setInput] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Slash Commands (/model, /clear, /hybrid)
  const [showSlashCommands, setShowSlashCommands] = useState(false);
  const [slashQuery, setSlashQuery] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);

  const SLASH_COMMANDS = useMemo(() => [
    {
      cmd: '/model',
      label: '/model',
      desc: 'Configure Local Dual-Brain Architecture Models (Architect + Coder)',
      action: () => openModelConfig?.()
    },
    {
      cmd: '/clear',
      label: '/clear',
      desc: 'Clear conversation history & reset context',
      action: () => onNewChat?.()
    },
    {
      cmd: '/hybrid',
      label: '/hybrid',
      desc: 'Toggle Local Dual-Brain Mode (Architect + Coder Worker on your local GPU)',
      action: () => onToggleHybrid?.()
    }
  ], [openModelConfig, onNewChat, onToggleHybrid]);

  const filteredSlashCommands = useMemo(() => {
    if (!showSlashCommands) return [];
    const q = slashQuery.toLowerCase().trim();
    if (q === '/' || !q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(c => c.cmd.toLowerCase().includes(q) || c.desc.toLowerCase().includes(q));
  }, [showSlashCommands, slashQuery, SLASH_COMMANDS]);

  // @file Context Tagging Autocomplete
  const [showFileSuggestions, setShowFileSuggestions] = useState(false);
  const [fileQuery, setFileQuery] = useState('');
  const [suggestIndex, setSuggestIndex] = useState(0);
  const [attachedFiles, setAttachedFiles] = useState<string[]>([]);

  // Attached Images & Clipboard Paste
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [copiedImageId, setCopiedImageId] = useState<string | null>(null);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const handlePasteImages = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      for (const file of imageFiles) {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result) {
            setAttachedImages(prev => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleSelectImageFiles = (files: FileList | null) => {
    if (!files) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          if (reader.result) {
            setAttachedImages(prev => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleCopyImageToClipboard = async (imgSrc: string, imgId: string) => {
    try {
      const res = await fetch(imgSrc);
      const blob = await res.blob();
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob })
      ]);
      setCopiedImageId(imgId);
      setTimeout(() => setCopiedImageId(null), 2000);
    } catch (err) {
      console.warn('Failed to copy image to clipboard:', err);
    }
  };

  const isBusy = status.state !== 'idle' && status.state !== 'stopped';

  // Activity inspector state (Ctrl + O)
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [activityHistory, setActivityHistory] = useState<LiveActivityItem[]>([]);
  const [currentThought, setCurrentThought] = useState<string>('');

  // Global Ctrl + O keyboard shortcut to toggle the activity inspector
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'o' || e.key === 'O')) {
        e.preventDefault();
        setIsInspectorOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Compute active tool, whether assistant has started answering, and if it's currently thinking
  const lastMsg = messages[messages.length - 1];
  const activeTool = pendingApproval || (lastMsg?.tools && lastMsg.tools[lastMsg.tools.length - 1]);

  // The assistant is answering once it has streamed text content or initiated tools
  const isAnswering = Boolean(
    isBusy &&
    lastMsg &&
    lastMsg.role === 'assistant' &&
    ((lastMsg.content && lastMsg.content.trim().length > 0) || (lastMsg.tools && lastMsg.tools.length > 0))
  );

  // The thinking GUI card only appears while the model is actively thinking before the answer starts
  const isThinking = isBusy && !isAnswering && status.state === 'thinking';

  const currentActivity = useMemo(() => {
    if (!isBusy) return 'Ready';
    if (activeTool && (activeTool.status === 'running' || activeTool.status === 'pending')) {
      const name = activeTool.name;
      const args = activeTool.args || {};
      const target = args.path || args.targetFile || args.file || '';
      if (name === 'read_file') return `Reading ${target || 'file'}`;
      if (name === 'write_file') return `Writing ${target || 'file'}`;
      if (name === 'edit_file') return `Editing ${target || 'file'}`;
      if (name === 'run_command') {
        const cmd = args.command || '';
        return `Running: ${cmd.length > 28 ? cmd.slice(0, 28) + '...' : cmd}`;
      }
      if (name === 'list_files') return `Listing ${args.dirPath || args.path || 'workspace'}`;
      if (name === 'search_codebase') return `Searching: "${args.query || ''}"`;
      return `Executing ${name}`;
    }
    if (isAnswering || status.state === 'responding') {
      return `Generating response (${elapsed}s)...`;
    }
    if (status.state === 'thinking') {
      return `Thinking (${elapsed}s)...`;
    }
    return `Generating response (${elapsed}s)...`;
  }, [isBusy, activeTool, status.state, elapsed, isAnswering]);

  // Sync tools into activityHistory for inspector
  useEffect(() => {
    if (!messages.length) {
      setActivityHistory([]);
      return;
    }
    const allTools: LiveActivityItem[] = [];
    messages.forEach((m) => {
      if (m.tools) {
        m.tools.forEach(t => {
          const target = t.args?.path || t.args?.targetFile || '';
          let shortDesc = `Tool: ${t.name}`;
          if (t.name === 'read_file') shortDesc = `Read ${target}`;
          else if (t.name === 'write_file') shortDesc = `Wrote ${target}`;
          else if (t.name === 'edit_file') shortDesc = `Edited ${target}`;
          else if (t.name === 'run_command') shortDesc = `Run: ${t.args?.command || ''}`;
          else if (t.name === 'search_codebase') shortDesc = `Search: "${t.args?.query || ''}"`;
          else if (t.name === 'list_files') shortDesc = `List ${t.args?.dirPath || t.args?.path || 'workspace'}`;

          allTools.push({
            id: t.id,
            type: 'tool',
            title: t.name,
            summary: shortDesc,
            timestamp: m.timestamp,
            toolName: t.name,
            toolArgs: t.args,
            toolOutput: t.output,
            status: t.status === 'pending' ? 'running' : t.status === 'success' ? 'success' : 'failed',
            diff: t.diff
          });
        });
      }
    });
    setActivityHistory(allTools);
  }, [messages]);

  // Flatten workspace file tree into fast searchable items
  const flattenedFiles = useMemo(() => {
    const list: { name: string; relPath: string }[] = [];
    const recurse = (nodes?: FileNode[]) => {
      if (!nodes) return;
      for (const node of nodes) {
        if (!node.isDir) {
          list.push({ name: node.name, relPath: node.relPath || node.name });
        }
        if (node.children) recurse(node.children);
      }
    };
    recurse(files);
    return list;
  }, [files]);

  const filteredFiles = useMemo(() => {
    if (!showFileSuggestions) return [];
    const q = fileQuery.toLowerCase().trim();
    if (!q) return flattenedFiles.slice(0, 8);
    return flattenedFiles
      .filter(f => f.relPath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [flattenedFiles, showFileSuggestions, fileQuery]);

  // Aggregate token tracking for Hybrid vs Local display
  const localTokensTotal = useMemo(() => {
    if (collaborateStep && collaborateStep.localTokens > 0) {
      return collaborateStep.localTokens;
    }
    let count = 0;
    for (const m of messages) {
      if (m.role === 'assistant' && m.senderModelType !== 'online' && m.content) {
        count += Math.round(m.content.length / 3.5);
      }
    }
    return count;
  }, [collaborateStep, messages]);


  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInput(val);

    // Slash command trigger
    if (val.startsWith('/')) {
      setShowSlashCommands(true);
      setSlashQuery(val);
      setSlashIndex(0);
      setShowFileSuggestions(false);
      return;
    } else {
      setShowSlashCommands(false);
    }

    const selStart = e.target.selectionStart || val.length;
    const textBeforeCursor = val.slice(0, selStart);
    const lastAt = textBeforeCursor.lastIndexOf('@');

    if (lastAt !== -1 && (lastAt === 0 || /\s/.test(textBeforeCursor[lastAt - 1]))) {
      const query = textBeforeCursor.slice(lastAt + 1);
      if (!/\s/.test(query)) {
        setShowFileSuggestions(true);
        setFileQuery(query);
        setSuggestIndex(0);
        return;
      }
    }
    setShowFileSuggestions(false);
  };

  const handleSelectSuggestedFile = (file: { name: string; relPath: string }) => {
    const selStart = textareaRef.current?.selectionStart || input.length;
    const textBeforeCursor = input.slice(0, selStart);
    const lastAt = textBeforeCursor.lastIndexOf('@');
    const textAfterCursor = input.slice(selStart);

    const cleanPath = file.relPath.includes(' ') ? `"${file.relPath}"` : file.relPath;
    const newTextBefore = textBeforeCursor.slice(0, lastAt) + `@${cleanPath} `;
    const fullNewText = newTextBefore + textAfterCursor;
    setInput(fullNewText);

    if (!attachedFiles.includes(file.relPath)) {
      setAttachedFiles(prev => [...prev, file.relPath]);
    }
    setShowFileSuggestions(false);

    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        const pos = newTextBefore.length;
        textareaRef.current.setSelectionRange(pos, pos);
      }
    }, 30);
  };

  const handleRemoveAttached = (filePath: string) => {
    setAttachedFiles(prev => prev.filter(f => f !== filePath));
    // Also remove from input string if present
    setInput(prev => prev.replace(new RegExp(`@("?)${filePath.replace(/\\/g, '\\\\')}("?)`, 'g'), '').trim());
  };

  // Stopwatch timer for the thinking counter
  useEffect(() => {
    let timer: any;
    if (isBusy) {
      const start = Date.now();
      timer = setInterval(() => {
        setElapsed(Number(((Date.now() - start) / 1000).toFixed(1)));
      }, 100);
    } else {
      setElapsed(0);
    }
    return () => clearInterval(timer);
  }, [isBusy]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
  };

  useEffect(() => {
    if (isNearBottomRef.current && scrollRef.current) {
      if (isBusy) {
        // Direct instant scroll during streaming eliminates the smooth-scrolling stutter/jitter loop
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      } else {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      }
    }
  }, [messages, status, pendingApproval, isBusy]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();

    // Intercept slash commands
    if (trimmed.startsWith('/')) {
      setShowSlashCommands(false);
      const parts = trimmed.split(/\s+/);
      const command = parts[0].toLowerCase();
      const arg = parts.slice(1).join(' ').trim();

      if (command === '/model') {
        if (!arg) {
          openModelConfig?.();
        } else {
          onSelectArchitectModel?.(arg);
        }
        setInput('');
        return;
      } else if (command === '/clear') {
        onNewChat?.();
        setInput('');
        return;
      } else if (command === '/hybrid') {
        onToggleHybrid?.();
        setInput('');
        return;
      }
    }

    if ((trimmed || attachedImages.length > 0) && status.state === 'idle') {
      isNearBottomRef.current = true;
      onSendMessage(trimmed, attachedImages.length > 0 ? attachedImages : undefined);
      setInput('');
      setAttachedImages([]);
      setAttachedFiles([]);
      setShowFileSuggestions(false);
      setShowSlashCommands(false);
    }
  };

  return (
    <div 
      className={`h-full flex flex-col bg-studio-surface select-text overflow-hidden ${
        isEditorOpen ? 'flex-shrink-0 border-l border-studio-border' : 'flex-1 w-full border-none'
      }`}
      style={isEditorOpen ? { width: `${width}px` } : { width: '100%', flex: 1 }}
    >
      {/* Header */}
      <div className="h-9 px-3 border-b border-studio-border flex items-center justify-between bg-studio-surface/80 backdrop-blur select-none flex-shrink-0 gap-1.5">
        <div className="flex items-center space-x-2 flex-shrink-0">
          <Sparkles size={14} className={taskMode === 'coding' ? 'text-role-user-400' : 'text-role-architect-400'} />
          <span className="text-xs font-semibold text-slate-200">Agent Studio</span>
          
          {/* Active Task Mode Badge */}
          <span className={`px-2 py-0.5 rounded-full text-micro font-medium border flex items-center space-x-1 ${
            taskMode === 'coding'
              ? 'bg-role-user-500/15 border-role-user-500/30 text-role-user-300'
              : 'bg-role-architect-500/15 border-role-architect-500/30 text-role-architect-300'
          }`}>
            {taskMode === 'coding' ? <Code2 size={10} /> : <MessageSquare size={10} />}
            <span className="hidden sm:inline">{taskMode === 'coding' ? 'Coding Task' : 'General Task'}</span>
          </span>

          {/* Auto Mode / Review Mode Toggle */}
          {onToggleAutoMode && (
            <button
              type="button"
              onClick={onToggleAutoMode}
              className={`px-2 py-0.5 rounded-full text-micro font-semibold border flex items-center space-x-1 transition cursor-pointer ${
                autoMode
                  ? 'bg-role-tool-500/20 border-role-tool-500/45 text-role-tool-300 hover:bg-role-tool-500/30 shadow-sm shadow-role-tool-500/10'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title={autoMode ? 'Auto Mode Active: Model has autonomous read & write tool access. Click to switch to Review Mode.' : 'Review Mode Active: Actions require manual approval. Click to switch to Auto Mode.'}
            >
              {autoMode ? (
                <>
                  <Zap size={10} className="text-role-tool-400 fill-role-tool-400 animate-pulse" />
                  <span>Auto: Read/Write</span>
                </>
              ) : (
                <>
                  <Shield size={10} className="text-slate-400" />
                  <span>Review Mode</span>
                </>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center space-x-1.5 flex-shrink-0">
          {/* Live activity inspector toggle (Ctrl + O) */}
          <button
            onClick={() => setIsInspectorOpen(prev => !prev)}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-micro font-mono border transition cursor-pointer ${
              isInspectorOpen
                ? 'bg-role-user-600/30 text-role-user-300 border-role-user-500/50'
                : 'bg-studio-panel border-studio-border text-slate-400 hover:text-slate-200'
            }`}
            title="Toggle the activity inspector (Ctrl + O)"
          >
            <BrainCircuit size={11} className={isBusy ? 'animate-spin text-state-info-400' : 'text-role-user-400'} />
            <span className="hidden sm:inline">Ctrl+O</span>
          </button>

          {isBusy ? (
            <button
              onClick={onStop}
              className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-state-danger-500/15 hover:bg-state-danger-500/25 border border-state-danger-500/30 text-micro text-state-danger-300 font-mono transition cursor-pointer"
              title="Stop Agent (Esc)"
            >
              <Square size={9} className="fill-current text-state-danger-400" />
              <span>Stop</span>
              <kbd className="px-1 bg-black/40 rounded text-micro text-state-danger-200">Esc</kbd>
            </button>
          ) : (
            <span className="text-micro text-slate-400 font-mono hidden sm:inline">Ready</span>
          )}
        </div>
      </div>

      {/* Combined Local Dual-Brain Command Strip */}
      {isHybrid ? (
        <div className="px-2.5 py-1.5 bg-gradient-to-r from-role-architect-950/50 via-[#131024] to-role-worker-950/40 border-b border-role-architect-500/40 flex flex-wrap items-center justify-between gap-1.5 text-micro select-none flex-shrink-0">
          <div className="flex items-center space-x-1.5 flex-wrap gap-y-1">
            <span className="px-2 py-0.5 rounded-full text-micro font-mono bg-role-architect-500/20 text-role-architect-300 border border-role-architect-500/40 font-bold flex items-center space-x-1">
              <Cpu size={10} className="text-role-tool-300" />
              <span>DUAL-BRAIN ACTIVE</span>
            </span>

            {/* General Architect Model */}
            <button
              onClick={openModelConfig}
              className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full bg-role-architect-500/20 hover:bg-role-architect-500/35 border border-role-architect-500/40 hover:border-role-architect-400 text-role-architect-200 font-mono text-micro flex-shrink-0 transition cursor-pointer shadow-sm"
              title="Configure Local Dual-Brain Architecture (General Model + Coder Model)"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-role-architect-400 animate-pulse" />
              <span>Architect: <strong className="text-white">{architectModel || 'qwen3.8:27b'}</strong></span>
              <span className="text-micro text-role-architect-300">▾</span>
            </button>

            <span className="text-role-worker-400 font-bold text-xs flex-shrink-0">➔</span>

            {/* Coder Worker Model */}
            <div className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-state-ok-500/20 border border-state-ok-500/40 text-state-ok-200 font-mono text-micro flex-shrink-0" title="Local Sovereign Worker on your local GPU">
              <span className="w-1.5 h-1.5 rounded-full bg-state-ok-400" />
              <span>Coder Worker: <strong className="text-white">{activeModel || 'Qwen3-Coder-30B'}</strong> (237 tok/s)</span>
            </div>
          </div>

          <div className="flex items-center space-x-1.5 flex-shrink-0 ml-auto text-micro font-mono text-slate-400">
            <span className="text-state-ok-400 font-bold">100% OFFLINE</span>
            <span>•</span>
            <span>$0.00 COST</span>
          </div>
        </div>
      ) : (
        <div className="px-2.5 py-1 bg-studio-panel/50 border-b border-studio-border flex items-center justify-between text-micro select-none flex-shrink-0">
          <div className="flex items-center space-x-2 text-slate-400 font-mono text-micro">
            <HardDrive size={11} className="text-state-ok-400" />
            <span>Pure Local Mode (Local GPU • {activeModel})</span>
          </div>
          {onToggleHybrid && (
            <button
              onClick={onToggleHybrid}
              className="text-micro text-role-user-400 hover:text-role-user-300 flex items-center space-x-1 cursor-pointer"
            >
              <Zap size={10} className="text-role-tool-300" />
              <span>Switch to Hybrid Mode</span>
            </button>
          )}
        </div>
      )}

      {/* Messages list */}
      <div 
        ref={scrollRef} 
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-3 space-y-3 text-xs ${
          !isEditorOpen ? 'max-w-4xl mx-auto w-full px-6' : ''
        }`}
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-400">
            <div className="w-14 h-14 rounded-modal bg-role-worker-950/40 border border-role-worker-500/30 flex items-center justify-center mb-2.5 shadow-lg shadow-role-worker-500/10">
              <img src={STRATA_ICON} alt="Strata" className="w-9 h-9 object-contain drop-shadow-[0_0_8px_rgba(45,212,191,0.4)]" />
            </div>
            <h4 className="text-sm font-semibold text-slate-100">
              {taskMode === 'coding' ? 'Strata Coding & Architecture Studio' : 'Strata General Intelligence'}
            </h4>
            <div className="flex items-center space-x-1.5 mt-1 text-micro text-slate-400 font-mono bg-studio-panel px-2.5 py-1 rounded-control border border-studio-border">
              <Cpu size={12} className={taskMode === 'coding' ? 'text-role-user-400' : 'text-role-architect-400'} />
              <span>Model: <strong className="text-slate-200">{activeModel}</strong></span>
              <span>•</span>
              <span className="text-state-ok-400">{systemInfo?.gpu || 'Local GPU'}</span>
            </div>

            <p className="text-xs text-slate-400 mt-2 max-w-sm">
              {taskMode === 'coding'
                ? 'Optimized for high-speed file editing, multi-file refactoring, debugging, and terminal workflows.'
                : 'Optimized for open-ended reasoning, deep questions, technical planning, and documentation.'}
            </p>

            {/* Quick Task Mode Switcher inside empty state */}
            <div className="mt-3 flex items-center space-x-2">
              <button
                onClick={() => onSelectTaskMode('coding')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-card border text-xs font-medium transition ${
                  taskMode === 'coding'
                    ? 'bg-role-user-600/20 border-role-user-500/60 text-role-user-300'
                    : 'bg-studio-panel border-studio-border text-slate-400 hover:text-slate-200'
                }`}
              >
                <Code2 size={13} />
                <span>Coding Mode</span>
              </button>
              <button
                onClick={() => onSelectTaskMode('general')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-card border text-xs font-medium transition ${
                  taskMode === 'general'
                    ? 'bg-role-architect-600/20 border-role-architect-500/60 text-role-architect-300'
                    : 'bg-studio-panel border-studio-border text-slate-400 hover:text-slate-200'
                }`}
              >
                <MessageSquare size={13} />
                <span>General Mode</span>
              </button>
            </div>

            {/* Suggestion Prompts */}
            <div className="mt-4 flex flex-col gap-2 w-full max-w-md">
              {taskMode === 'coding' ? (
                <>
                  <button
                    onClick={() => onSendMessage("Create a modern dark-mode landing page in index.html with Tailwind CSS")}
                    className="text-left px-3 py-2 rounded-card bg-studio-panel border border-studio-border hover:border-role-user-500/40 text-xs text-slate-300 transition"
                  >
                    ⚡ Create a modern landing page in index.html
                  </button>
                  <button
                    onClick={() => onSendMessage("Inspect the workspace files and suggest code improvements")}
                    className="text-left px-3 py-2 rounded-card bg-studio-panel border border-studio-border hover:border-role-user-500/40 text-xs text-slate-300 transition"
                  >
                    🔍 Inspect workspace & suggest improvements
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => onSendMessage("Explain how local model context windows and GPU VRAM offloading work")}
                    className="text-left px-3 py-2 rounded-card bg-studio-panel border border-studio-border hover:border-role-architect-500/40 text-xs text-slate-300 transition"
                  >
                    🧠 Explain context windows & GPU offloading
                  </button>
                  <button
                    onClick={() => onSendMessage("Help me design an architecture for a modular local desktop application")}
                    className="text-left px-3 py-2 rounded-card bg-studio-panel border border-studio-border hover:border-role-architect-500/40 text-xs text-slate-300 transition"
                  >
                    💡 Brainstorm application architecture
                  </button>
                </>
              )}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div
              key={msg.id}
              className={`rounded-card p-3.5 transition-all ${
                msg.role === 'user'
                  ? 'bg-role-user-600/15 border border-role-user-500/30 text-role-user-100 ml-6 shadow-sm'
                  : msg.senderModelType === 'online'
                  ? 'bg-[#151226] border border-role-architect-500/40 text-role-architect-100 mr-2 shadow-md shadow-role-architect-950/30'
                  : msg.senderModelType === 'offline'
                  ? 'bg-[#0d1c1a] border border-role-worker-500/40 text-role-worker-100 mr-2 shadow-md shadow-role-worker-950/30'
                  : 'bg-studio-panel/75 border border-studio-border text-slate-200 mr-2 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between text-micro text-slate-400 mb-1.5 font-mono">
                <span className="font-semibold text-slate-300 flex items-center space-x-1.5">
                  {msg.role === 'user' ? (
                    <span>You</span>
                  ) : msg.senderModelType === 'online' || msg.senderRole === 'architect' ? (
                    <div className="flex items-center space-x-1.5">
                      <div className="w-4 h-4 rounded-control bg-role-architect-500/25 border border-role-architect-500/50 flex items-center justify-center">
                        <Cpu size={11} className="text-role-architect-300" />
                      </div>
                      <span className="text-role-architect-300 font-bold font-mono">
                        {msg.senderName || 'Local Architect (Brain 1 • General Model)'}
                      </span>
                      {msg.addressedTo && (
                        <span className="text-micro px-1.5 py-0.5 rounded-control bg-role-architect-500/20 text-role-architect-200 border border-role-architect-500/30 font-sans">
                          ➔ {msg.addressedTo}
                        </span>
                      )}
                    </div>
                  ) : msg.senderModelType === 'offline' || msg.senderRole === 'worker' ? (
                    <div className="flex items-center space-x-1.5">
                      <div className="w-4 h-4 rounded-control bg-state-ok-500/25 border border-state-ok-500/50 flex items-center justify-center">
                        <Zap size={11} className="text-state-ok-300" />
                      </div>
                      <span className="text-state-ok-300 font-bold font-mono">
                        {msg.senderName || 'Local Coder Worker (Brain 2 • Local GPU)'}
                      </span>
                      {msg.addressedTo && (
                        <span className="text-micro px-1.5 py-0.5 rounded-control bg-state-ok-500/20 text-state-ok-200 border border-state-ok-500/30 font-sans">
                          ➔ {msg.addressedTo}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <img src={STRATA_ICON} alt="Strata" className="w-3.5 h-3.5 object-contain inline-block" />
                      <span>Strata Assistant</span>
                      {msg.model?.includes('Architect') ? (
                        <span className="inline-flex items-center space-x-1 text-micro px-2 py-0.5 rounded-control bg-role-architect-500/15 border border-role-architect-500/30 text-role-architect-300 font-mono font-medium shadow-sm">
                          <Cpu size={10} className="text-role-architect-400" />
                          <span>{msg.model}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center space-x-1 text-micro px-1.5 py-0.5 rounded bg-studio-bg border border-studio-border text-state-ok-400/90 font-mono">
                          <HardDrive size={10} className="text-state-ok-400" />
                          <span>{msg.model || activeModel}</span>
                        </span>
                      )}
                    </>
                  )}
                </span>
                <span>{msg.timestamp}</span>
              </div>

              <div className="font-sans text-xs leading-relaxed">
                {msg.images && msg.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {msg.images.map((img, idx) => {
                      const imgKey = `img_${msg.id}_${idx}`;
                      return (
                        <div key={idx} className="relative group rounded-card overflow-hidden border border-studio-border bg-black/40 shadow-md">
                          <img
                            src={img}
                            alt="Attachment"
                            className="max-h-48 max-w-xs object-cover rounded cursor-pointer hover:opacity-90 transition"
                            onClick={() => setLightboxImage(img)}
                          />
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyImageToClipboard(img, imgKey);
                            }}
                            className="absolute top-1.5 right-1.5 px-2 py-1 rounded bg-black/75 hover:bg-black text-micro text-white opacity-0 group-hover:opacity-100 transition flex items-center space-x-1 shadow"
                            title="Copy Image to Clipboard"
                          >
                            {copiedImageId === imgKey ? <Check size={10} className="text-state-ok-400" /> : <Copy size={10} />}
                            <span>{copiedImageId === imgKey ? 'Copied!' : 'Copy Image'}</span>
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <FormattedContent content={msg.content} />
                {isBusy && msg.role === 'assistant' && msg.id === lastMsg?.id && (
                  <span className="inline-block w-1.5 h-3.5 ml-1 bg-role-user-400 animate-pulse align-middle rounded-control" />
                )}
              </div>

              {/* Tool Calls & Outputs */}
              {msg.tools && msg.tools.length > 0 && (
                <div className="mt-2.5 space-y-2 pt-2 border-t border-studio-border/60">
                  {msg.tools.map(tool => (
                    <div
                      key={tool.id}
                      className="rounded-card bg-studio-bg/70 border border-studio-border p-2.5 text-micro"
                    >
                      <div className="flex items-center justify-between font-mono">
                        <div className="flex items-center space-x-1.5 text-role-user-300 font-semibold">
                          <Wrench size={13} className="text-role-user-400" />
                          <span>{tool.name}</span>
                        </div>
                        {tool.status === 'running' && (
                          <span className="text-role-tool-400 text-micro flex items-center space-x-1">
                            <Loader2 size={11} className="animate-spin" />
                            <span>executing...</span>
                          </span>
                        )}
                        {tool.status === 'success' && (
                          <div className="flex items-center space-x-1 text-state-ok-400 text-micro">
                            <CheckCircle2 size={12} />
                            <span>done</span>
                          </div>
                        )}
                        {tool.status === 'failed' && (
                          <div className="flex items-center space-x-1 text-state-danger-400 text-micro">
                            <AlertCircle size={12} />
                            <span>rejected</span>
                          </div>
                        )}
                      </div>

                      <div className="text-slate-400 text-micro font-mono mt-1 truncate bg-black/30 px-1.5 py-0.5 rounded">
                        {JSON.stringify(tool.args)}
                      </div>

                      {tool.output && (
                        <div className="mt-1.5 p-2 bg-black/50 border border-studio-border/50 rounded font-mono text-micro text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
                          {tool.output}
                        </div>
                      )}

                      {tool.diff && onOpenDiff && (
                        <button
                          type="button"
                          onClick={() => onOpenDiff(tool.diff!)}
                          className="mt-2 flex items-center space-x-1.5 px-2.5 py-1 rounded bg-role-tool-500/20 hover:bg-role-tool-500/30 text-role-tool-300 border border-role-tool-500/40 text-micro font-medium transition cursor-pointer"
                          title="Open side-by-side diff in code editor"
                        >
                          <GitCompare size={12} className="text-role-tool-400" />
                          <span>View Side-by-Side Diff</span>
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {/* Thinking & working card - disappears immediately when answer generation begins */}
        {isThinking && (
          <div className="rounded-card p-3 bg-gradient-to-r from-role-tool-500/10 via-role-architect-500/10 to-role-user-500/10 border border-role-tool-500/30 text-xs shadow-lg shadow-role-tool-500/5 mr-3 animate-in fade-in">
            <div className="flex items-center space-x-2.5">
              <div className="relative flex items-center justify-center w-5 h-5 flex-shrink-0">
                <div className="absolute w-6 h-6 rounded-full bg-role-tool-400/30 blur-sm animate-pulse-glow" />
                <Sparkles size={16} className="text-role-tool-400 animate-spin-slow relative z-10" />
              </div>

              <div className="flex-1 flex items-center justify-between overflow-hidden">
                <div className="flex items-center space-x-1.5 truncate">
                  <BrainCircuit size={13} className="text-role-tool-300 animate-pulse" />
                  <span className="font-semibold text-xs animate-shimmer">
                    {status.state === 'thinking' 
                      ? `Thinking with ${activeModel}...` 
                      : status.state === 'executing' 
                      ? 'Applying changes to workspace...' 
                      : 'Working on solution...'}
                  </span>
                </div>

                <div className="flex items-center space-x-2 ml-2 flex-shrink-0">
                  <span className="text-micro font-mono text-role-tool-300/90 bg-role-tool-500/20 px-2 py-0.5 rounded-full border border-role-tool-500/30">
                    {elapsed.toFixed(1)}s
                  </span>

                  <button
                    onClick={onStop}
                    className="flex items-center space-x-1 px-2 py-0.5 rounded-control bg-state-danger-500/20 hover:bg-state-danger-500/30 text-state-danger-300 border border-state-danger-500/40 text-micro font-medium transition cursor-pointer"
                    title="Stop (Press Esc)"
                  >
                    <Square size={9} className="fill-current text-state-danger-400" />
                    <span>Stop</span>
                    <kbd className="px-1 py-0.5 bg-black/40 rounded text-micro text-state-danger-200">Esc</kbd>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-2.5 w-full h-[2px] bg-role-tool-500/20 rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-role-tool-400 via-role-architect-400 to-role-user-400 rounded-full animate-shimmer w-full" />
            </div>
          </div>
        )}

        {/* Pending Approval Diff Card */}
        {pendingApproval && (
          <div className="rounded-card p-3.5 bg-role-tool-500/10 border border-role-tool-500/40 text-role-tool-200 animate-in fade-in mr-2 shadow-lg shadow-role-tool-500/10">
            <div className="flex items-center space-x-1.5 text-xs font-semibold mb-2 text-role-tool-300">
              <ShieldAlert size={15} />
              <span>Permission Request: {pendingApproval.name}</span>
            </div>

            <div className="text-micro text-slate-300 mb-2">
              The model wants to execute:
              <div className="bg-black/60 p-2 rounded-card font-mono text-micro mt-1 text-slate-200 border border-role-tool-500/20 max-h-32 overflow-y-auto">
                {JSON.stringify(pendingApproval.args, null, 2)}
              </div>
            </div>

            <div className="flex items-center space-x-2 mt-3">
              <button
                onClick={() => onApprove(pendingApproval.id, true)}
                className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-card bg-state-ok-600 hover:bg-state-ok-500 text-white font-medium text-xs transition shadow-md shadow-state-ok-600/20"
              >
                <Check size={14} />
                <span>Approve</span>
              </button>
              <button
                onClick={() => onApprove(pendingApproval.id, false)}
                className="flex-1 flex items-center justify-center space-x-1.5 py-1.5 rounded-card bg-state-danger-600/80 hover:bg-state-danger-600 text-white font-medium text-xs transition"
              >
                <X size={14} />
                <span>Reject</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Input box */}
      <form 
        onSubmit={handleSubmit} 
        className="p-3 border-t border-studio-border bg-studio-surface/60 backdrop-blur flex-shrink-0"
      >
        <div className={`flex flex-col space-y-2 ${!isEditorOpen ? 'max-w-4xl mx-auto' : ''}`}>
          {/* Quick Task Pill bar right above input */}
          <div className="flex items-center justify-between text-micro text-slate-400 px-1">
            <div className="flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => onSelectTaskMode('coding')}
                className={`flex items-center space-x-1 px-2 py-0.5 rounded transition ${
                  taskMode === 'coding'
                    ? 'bg-role-user-600/20 text-role-user-300 font-medium border border-role-user-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Code2 size={11} />
                <span>Coding Task</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectTaskMode('general')}
                className={`flex items-center space-x-1 px-2 py-0.5 rounded transition ${
                  taskMode === 'general'
                    ? 'bg-role-architect-600/20 text-role-architect-300 font-medium border border-role-architect-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <MessageSquare size={11} />
                <span>General Task</span>
              </button>
            </div>

            <div className="flex items-center space-x-2 font-mono text-micro text-slate-400 truncate">
              {isHybrid ? (
                /* Local Dual-Brain Mode: Architect + Coder on the local GPU (Pure Local, 0 Cloud Tokens) */
                <div 
                  className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-role-architect-950/40 border border-role-architect-500/30 text-micro font-mono shadow-sm select-none"
                  title="Local Dual-Brain Architecture: Brain 1 (General Architect) + Brain 2 (Coder Worker) on the local GPU ($0.00 Cost)"
                >
                  <span className="px-1.5 py-0.5 rounded bg-role-architect-500/25 text-role-architect-300 font-bold uppercase text-micro border border-role-architect-500/40 tracking-wider">
                    DUAL-BRAIN • {hybridTier}
                  </span>
                  <span className="text-role-architect-300 font-medium">🧠 Architect: {architectModel || 'qwen3.8:27b'}</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-state-ok-300 font-medium">⚡ Local Coder: {localTokensTotal.toLocaleString()} tok</span>
                  <span className="text-slate-600">•</span>
                  <span className="text-role-tool-300 font-bold">100% OFFLINE ($0.00)</span>
                </div>
              ) : (
                /* Pure Local Mode: ONLY Local Tokens */
                /* Local Single Mode: ONLY Local Tokens */
                <div 
                  className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-state-ok-950/40 border border-state-ok-500/30 text-state-ok-300 text-micro font-mono shadow-sm select-none"
                  title="Pure Local Sovereign Mode: 100% local GPU execution (Zero Cloud Tokens)"
                >
                  <HardDrive size={10} className="text-state-ok-400" />
                  <span className="font-medium">⚡ Local Tokens: {localTokensTotal.toLocaleString()} tok</span>
                  <span className="text-state-ok-400/60 font-semibold">(Local GPU)</span>
                </div>
              )}

              <div className="flex items-center space-x-1 truncate max-w-[150px]">
                <Cpu size={11} className={taskMode === 'coding' ? 'text-role-user-400' : 'text-role-architect-400'} />
                <span className="truncate">{activeModel}</span>
              </div>
            </div>
          </div>

          {/* Attached file context badges */}
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 px-1">
              <span className="text-micro font-semibold uppercase tracking-wider text-role-user-400 flex items-center space-x-1 mr-1">
                <Paperclip size={10} />
                <span>Context:</span>
              </span>
              {attachedFiles.map(filePath => (
                <span 
                  key={filePath} 
                  className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-control bg-role-user-600/20 border border-role-user-500/40 text-micro font-mono text-role-user-300 shadow-sm"
                >
                  <FileCode size={11} className="text-role-user-400" />
                  <span className="max-w-[140px] truncate">{filePath.split(/[\\/]/).pop()}</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttached(filePath)}
                    className="hover:text-white p-0.5 rounded-full ml-0.5"
                    title="Remove attached context"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Real-Time Live Collaboration Bar: Hybrid vs Local Single */}
          {collaborateStep && (
            <div className={`mb-2 p-2.5 rounded-card border text-xs shadow-lg animate-in fade-in select-none ${
              isHybrid
                ? 'bg-gradient-to-r from-state-info-950/50 via-role-worker-950/40 to-slate-900/90 border-role-worker-500/40'
                : 'bg-studio-panel/90 border-state-ok-500/30'
            }`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center space-x-2 truncate">
                  {isHybrid && collaborateStep.activeRole === 'architect' ? (
                    <div className="flex items-center space-x-1.5 text-state-info-300 font-semibold font-mono text-micro">
                      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-state-info-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-state-info-500"></span>
                      </span>
                      <Cpu size={13} className="text-role-architect-400 flex-shrink-0" />
                      <span className="truncate">Local Architect ({collaborateStep.architectModel || 'qwen3.8:27b'}) • <span className="text-role-architect-300 font-bold uppercase text-micro">{collaborateStep.hybridTier || hybridTier}</span></span>
                    </div>
                  ) : (
                    <div className="flex items-center space-x-1.5 text-state-ok-300 font-semibold font-mono text-micro">
                      <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-state-ok-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-state-ok-500"></span>
                      </span>
                      <HardDrive size={13} className="text-state-ok-400 flex-shrink-0" />
                      <span className="truncate">Local Coder ({collaborateStep.workerModel || activeModel})</span>
                    </div>
                  )}

                  <span className="text-slate-600 hidden sm:inline">•</span>
                  <span className="text-micro text-slate-300 font-sans truncate hidden sm:inline">
                    {collaborateStep.title || collaborateStep.message}
                  </span>
                </div>

                {/* Real-Time Local Execution Metrics */}
                <div className="flex items-center space-x-1.5 font-mono text-micro flex-shrink-0 ml-auto">
                  <span className="px-2 py-0.5 rounded bg-state-ok-900/40 text-state-ok-300 border border-state-ok-500/30 font-medium" title="Local tokens executed on your GPU">
                    ⚡ Local: {collaborateStep.localTokens.toLocaleString()} tok (100% GPU)
                  </span>
                  <span className="px-2 py-0.5 rounded bg-role-architect-500/15 text-role-architect-300 border border-role-architect-500/30 font-bold" title="100% Sovereign Offline Execution">
                    🛡️ 100% Offline • $0.00
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Live activity ticker - hidden while the assistant is actively streaming the answer */}
          {isBusy && !isAnswering && (
            <div className="flex items-center justify-between px-3 py-1.5 mb-2 rounded-card bg-studio-panel/90 border border-role-user-500/30 text-xs text-slate-200 animate-in fade-in select-none">
              <div className="flex items-center space-x-2 truncate">
                <span className="relative flex h-2 w-2 flex-shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-state-info-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-state-info-500"></span>
                </span>
                <span className="font-mono text-micro text-state-info-300 font-medium truncate">
                  {currentActivity}
                </span>
                <span className="text-micro text-slate-500 font-mono flex-shrink-0">({elapsed}s)</span>
              </div>
              <button
                type="button"
                onClick={() => setIsInspectorOpen(prev => !prev)}
                className="flex items-center space-x-1.5 px-2 py-0.5 rounded bg-black/40 hover:bg-black/60 border border-white/10 text-micro font-mono text-slate-300 hover:text-white transition cursor-pointer flex-shrink-0 ml-2"
                title="Toggle the activity inspector (Ctrl+O)"
              >
                <span>Ctrl+O</span>
                <span className="text-slate-400 font-sans hidden xs:inline">{isInspectorOpen ? 'Hide' : 'Inspect'}</span>
              </button>
            </div>
          )}

          {/* Active Open File Context Badge */}
          {activeFile && (
            <div className="flex items-center space-x-2 mb-2 px-2.5 py-1 rounded-card bg-studio-panel/75 border border-studio-border text-micro text-slate-300 w-fit select-none animate-in fade-in">
              <div className="flex items-center space-x-1.5 text-role-worker-300 font-medium">
                <FileCode size={12} className="text-role-worker-400" />
                <span className="font-mono text-role-worker-200">{activeFile.split(/[\\/]/).pop()}</span>
              </div>
              <span className="text-slate-600">•</span>
              <span className="text-micro text-slate-400 font-sans">
                Active tab synced to {activeModel}
              </span>
              {openTabs && openTabs.length > 1 && (
                <span className="text-micro text-slate-500 font-mono">
                  ({openTabs.length} open tabs)
                </span>
              )}
            </div>
          )}

          {/* Attached Images Preview Strip */}
          {attachedImages.length > 0 && (
            <div className="flex items-center space-x-2 px-1.5 py-1.5 overflow-x-auto bg-black/40 rounded-card border border-role-user-500/30 mb-2 animate-in fade-in">
              {attachedImages.map((img, idx) => (
                <div key={idx} className="relative group rounded-card overflow-hidden border border-role-user-500/40 bg-black/50 flex-shrink-0">
                  <img 
                    src={img} 
                    alt="Thumbnail" 
                    className="w-14 h-14 object-cover cursor-pointer hover:opacity-90 transition" 
                    onClick={() => setLightboxImage(img)} 
                  />
                  <button
                    type="button"
                    onClick={() => setAttachedImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/80 hover:bg-state-danger-600 text-white flex items-center justify-center text-micro transition cursor-pointer"
                    title="Remove Image"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setAttachedImages([])}
                className="text-micro text-slate-400 hover:text-state-danger-400 underline font-mono px-1 flex-shrink-0 cursor-pointer ml-auto"
              >
                Clear
              </button>
            </div>
          )}

          {/* Active Auto Mode / Review Status Bar */}
          <div className="flex items-center justify-between text-micro font-mono px-1 mb-1.5 select-none text-slate-400">
            <div className="flex items-center space-x-1.5">
              {autoMode ? (
                <span className="flex items-center space-x-1 text-role-tool-300">
                  <Zap size={10} className="fill-role-tool-400 text-role-tool-400 animate-pulse" />
                  <span className="font-semibold">Auto Mode:</span>
                  <span>Autonomous Read & Write Access (Zero manual approvals)</span>
                </span>
              ) : (
                <span className="flex items-center space-x-1 text-slate-400">
                  <Shield size={10} />
                  <span>Review Mode: Manual confirmation required before actions</span>
                </span>
              )}
            </div>
            {onToggleAutoMode && (
              <button
                type="button"
                onClick={onToggleAutoMode}
                className="underline hover:text-slate-200 transition cursor-pointer text-micro"
              >
                {autoMode ? 'Switch to Review' : 'Switch to Auto'}
              </button>
            )}
          </div>

          <div className="flex items-end space-x-2">
            {/* (+) Plus Button to Attach Images & Screenshots */}
            <input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={e => {
                handleSelectImageFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isBusy}
              className="p-3 rounded-card bg-role-user-600/20 hover:bg-role-user-600/35 border border-role-user-500/40 hover:border-role-user-400 text-role-user-200 hover:text-white transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 shadow-sm mb-0.5 group"
              title="Attach Images / Screenshots (+) • or paste with Ctrl+V"
            >
              <Plus size={16} className="text-role-user-300 group-hover:text-white group-hover:scale-110 transition font-bold" />
            </button>

            {/* New Chat Button directly to the left of the chat box */}
            {onNewChat && (
              <button
                type="button"
                onClick={onNewChat}
                disabled={isBusy}
                className="p-3 rounded-card bg-studio-panel hover:bg-studio-surface border border-studio-border hover:border-slate-500 text-slate-400 hover:text-slate-200 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center flex-shrink-0 shadow-sm mb-0.5"
                title="New Chat (Clear context & chat history)"
              >
                <RotateCcw size={15} />
              </button>
            )}

            <div className="relative flex-1 flex items-center">
              {/* Floating @file Suggestion Popover */}
              {showFileSuggestions && filteredFiles.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-studio-surface border border-role-user-500/50 rounded-card shadow-2xl overflow-hidden z-50 text-xs animate-in fade-in slide-in-from-bottom-2">
                  <div className="px-3 py-1.5 bg-studio-panel/90 border-b border-studio-border text-micro font-semibold uppercase tracking-wider text-role-user-400 flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <Paperclip size={11} />
                      <span>Attach Workspace File (@)</span>
                    </div>
                    <span className="text-slate-400 font-mono">↑↓ Navigate • Enter/Tab to Select</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-studio-border/30">
                    {filteredFiles.map((file, idx) => (
                      <div
                        key={file.relPath}
                        onClick={() => handleSelectSuggestedFile(file)}
                        onMouseEnter={() => setSuggestIndex(idx)}
                        className={`px-3 py-2 flex items-center justify-between cursor-pointer transition ${
                          idx === suggestIndex
                            ? 'bg-role-user-600/25 text-white'
                            : 'text-slate-300 hover:bg-studio-panel/60'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <FileCode size={13} className={idx === suggestIndex ? 'text-role-user-400' : 'text-slate-400'} />
                          <span className="font-medium text-xs text-slate-100">{file.name}</span>
                          <span className="text-micro font-mono text-slate-400 truncate">{file.relPath}</span>
                        </div>
                        <span className="text-micro text-role-user-400 font-mono opacity-70">Enter</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Floating Slash Commands Popover */}
              {showSlashCommands && filteredSlashCommands.length > 0 && (
                <div className="absolute bottom-full left-0 mb-2 w-full max-w-md bg-studio-surface border border-role-architect-500/50 rounded-card shadow-2xl overflow-hidden z-50 text-xs animate-in fade-in slide-in-from-bottom-2">
                  <div className="px-3 py-1.5 bg-gradient-to-r from-role-architect-950/80 to-studio-panel border-b border-studio-border text-micro font-semibold uppercase tracking-wider text-role-architect-300 flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <Sparkles size={11} className="text-role-tool-300" />
                      <span>Slash Commands</span>
                    </div>
                    <span className="text-slate-400 font-mono">↑↓ Navigate • Enter to Run</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y divide-studio-border/30">
                    {filteredSlashCommands.map((cmdItem, idx) => (
                      <div
                        key={cmdItem.cmd}
                        onClick={() => {
                          cmdItem.action();
                          setShowSlashCommands(false);
                          setInput('');
                        }}
                        onMouseEnter={() => setSlashIndex(idx)}
                        className={`px-3 py-2 flex items-center justify-between cursor-pointer transition ${
                          idx === slashIndex
                            ? 'bg-role-architect-600/30 text-white'
                            : 'text-slate-300 hover:bg-studio-panel/60'
                        }`}
                      >
                        <div className="flex items-center space-x-2 truncate">
                          <span className="font-mono font-bold text-xs text-role-architect-300">{cmdItem.label}</span>
                          <span className="text-micro text-slate-400 truncate">{cmdItem.desc}</span>
                        </div>
                        <span className="text-micro text-role-architect-300 font-mono opacity-70">Enter</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <textarea
                ref={textareaRef}
                rows={2}
                value={input}
                onChange={handleInputChange}
                onPaste={handlePasteImages}
                onKeyDown={(e) => {
                  if (showSlashCommands && filteredSlashCommands.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSlashIndex((prev) => (prev + 1) % filteredSlashCommands.length);
                      return;
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSlashIndex((prev) => (prev - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
                      return;
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      if (filteredSlashCommands[slashIndex]) {
                        filteredSlashCommands[slashIndex].action();
                        setShowSlashCommands(false);
                        setInput('');
                      }
                      return;
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowSlashCommands(false);
                      return;
                    }
                  }

                  if (showFileSuggestions && filteredFiles.length > 0) {
                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setSuggestIndex((prev) => (prev + 1) % filteredFiles.length);
                      return;
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setSuggestIndex((prev) => (prev - 1 + filteredFiles.length) % filteredFiles.length);
                      return;
                    } else if (e.key === 'Enter' || e.key === 'Tab') {
                      e.preventDefault();
                      if (filteredFiles[suggestIndex]) {
                        handleSelectSuggestedFile(filteredFiles[suggestIndex]);
                      }
                      return;
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setShowFileSuggestions(false);
                      return;
                    }
                  }

                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit(e);
                  }
                }}
                placeholder={
                  isBusy 
                    ? `${activeModel} is working... (Press Esc to interrupt)` 
                    : taskMode === 'coding'
                    ? 'Ask Qwen to code, debug... (Type /model to select models, @ to attach files)'
                    : 'Ask for reasoning, architecture... (Type /model to select models, @ to attach files)'
                }
                disabled={isBusy}
                className="w-full bg-studio-panel border border-studio-border focus:border-role-user-500/80 rounded-card p-2.5 pr-24 text-xs text-slate-200 placeholder-slate-400 focus:outline-none resize-none transition shadow-inner"
              />

              {isBusy ? (
                <button
                  type="button"
                  onClick={onStop}
                  className="absolute right-2.5 top-3 px-2.5 py-1.5 rounded-card bg-state-danger-600/20 hover:bg-state-danger-600/30 text-state-danger-300 border border-state-danger-500/40 text-xs font-medium flex items-center space-x-1.5 transition cursor-pointer"
                  title="Interrupt Generation (Esc)"
                >
                  <Square size={11} className="fill-current text-state-danger-400" />
                  <span>Stop</span>
                  <kbd className="px-1 py-0.5 bg-black/40 rounded text-micro text-state-danger-200 font-mono">Esc</kbd>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() && attachedImages.length === 0}
                  className={`absolute right-2.5 top-3.5 p-1.5 rounded-card text-white disabled:opacity-40 transition shadow-md ${
                    taskMode === 'coding'
                      ? 'bg-role-user-600 hover:bg-role-user-500 shadow-role-user-600/30'
                      : 'bg-role-architect-600 hover:bg-role-architect-500 shadow-role-architect-600/30'
                  }`}
                  title="Send (Enter)"
                >
                  <Send size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* Live activity inspector (Ctrl + O) */}
      <ActivityInspector
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        activeModel={activeModel}
        status={status}
        currentThought={currentThought}
        activityHistory={activityHistory}
        tools={lastMsg?.tools || []}
        elapsedSeconds={elapsed}
      />

      {/* Image Lightbox Zoom Modal */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-150"
          onClick={() => setLightboxImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <img src={lightboxImage} alt="Zoomed view" className="max-w-full max-h-[85vh] object-contain rounded-card shadow-2xl border border-role-user-500/40" />
            <div className="mt-2.5 flex items-center space-x-3 bg-slate-900/90 border border-slate-700 px-3 py-1.5 rounded-full shadow-lg">
              <button
                type="button"
                onClick={() => handleCopyImageToClipboard(lightboxImage, 'lightbox_chat')}
                className="flex items-center space-x-1.5 text-xs text-role-user-200 hover:text-white cursor-pointer font-medium"
              >
                {copiedImageId === 'lightbox_chat' ? <Check size={13} className="text-state-ok-400" /> : <Copy size={13} />}
                <span>{copiedImageId === 'lightbox_chat' ? 'Copied Image!' : 'Copy Image'}</span>
              </button>
              <span className="text-slate-600">|</span>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="flex items-center space-x-1 text-xs text-slate-300 hover:text-state-danger-300 cursor-pointer"
              >
                <X size={13} />
                <span>Close</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
