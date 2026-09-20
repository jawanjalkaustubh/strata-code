import React, { useState, useEffect, useCallback, useRef } from 'react';
import { TitleBar } from './components/TitleBar';
import { FileTree } from './components/FileTree';
import { CodeEditor } from './components/CodeEditor';
import { ChatPanel } from './components/ChatPanel';
import { AboutModal } from './components/AboutModal';
import { AgreementModal } from './components/AgreementModal';
import { ModelManagerModal } from './components/ModelManagerModal';
import { DualBrainModal } from './components/DualBrainModal';
import { TerminalDrawer } from './components/TerminalDrawer';
import { StatusBar } from './components/StatusBar';
import { 
  FileNode, OpenTab, ChatMessage, ToolCallItem, TaskMode, OllamaModelDetail, PullProgressData, SystemInfo, ActiveDiff, OllamaHealthStatus, CollaborateStepData, ProviderConfig, HybridTier 
} from './types';
import { STRATA_ICON } from './assets/logo';
import { useEventCallback } from './hooks';

export const App: React.FC = () => {
  const api = (window as any).api;

  // Filled from the main process on the first getFiles() round-trip; the
  // renderer must not assume the developer's folder layout.
  const [workspace, setWorkspace] = useState('');
  const [files, setFiles] = useState<FileNode[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [tabs, setTabs] = useState<OpenTab[]>([]);

  // System Hardware Info (Dynamic GPU / CPU / RAM Detection)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  // Ollama Process & Daemon Health State
  const [ollamaHealth, setOllamaHealth] = useState<OllamaHealthStatus | null>(null);
  const [isRestartingOllama, setIsRestartingOllama] = useState<boolean>(false);

  // Side-by-Side Diff State
  const [activeDiff, setActiveDiff] = useState<ActiveDiff | null>(null);

  // Terminal Drawer State
  const [isTerminalOpen, setIsTerminalOpen] = useState<boolean>(false);
  
  // Task Mode and Model Mapping with LocalStorage
  const [taskMode, setTaskMode] = useState<TaskMode>(() => {
    return (localStorage.getItem('strata_task_mode') as TaskMode) || (localStorage.getItem('apex_task_mode') as TaskMode) || 'coding';
  });
  const [codingModel, setCodingModel] = useState<string>(() => {
    const saved = localStorage.getItem('strata_coding_model') || localStorage.getItem('apex_coding_model');
    if (saved && !saved.includes('gemini') && !saved.includes('hybrid') && (saved.toLowerCase().includes('coder'))) {
      return saved;
    }
    return 'Qwen3-Coder-30B-A3B-Instruct';
  });
  const [generalModel, setGeneralModel] = useState<string>(() => {
    const saved = localStorage.getItem('strata_general_model') || localStorage.getItem('apex_general_model');
    if (saved && !saved.includes('gemini') && !saved.includes('hybrid')) {
      return saved;
    }
    return 'qwen3.8:27b';
  });
  const [models, setModels] = useState<string[]>(['Qwen3-Coder-30B-A3B-Instruct', 'qwen3.8:27b']);
  const [modelDetails, setModelDetails] = useState<OllamaModelDetail[]>([]);
  const [pullProgress, setPullProgress] = useState<PullProgressData | null>(null);
  const [isModelManagerOpen, setIsModelManagerOpen] = useState<boolean>(false);
  const [isDualBrainModalOpen, setIsDualBrainModalOpen] = useState<boolean>(false);

  const activeModel = taskMode === 'coding' ? codingModel : generalModel;
  const activeModelRef = useRef(activeModel);
  const taskModeRef = useRef(taskMode);
  const activeFileRef = useRef(activeFile);

  useEffect(() => {
    activeModelRef.current = activeModel;
    taskModeRef.current = taskMode;
    activeFileRef.current = activeFile;
  }, [activeModel, taskMode, activeFile]);

  const handleSelectModel = useEventCallback((model: string) => {
    if (taskMode === 'coding') {
      setCodingModel(model);
      localStorage.setItem('strata_coding_model', model);
    } else {
      setGeneralModel(model);
      localStorage.setItem('strata_general_model', model);
    }
  });

  const handleSelectTaskMode = useEventCallback((mode: TaskMode) => {
    setTaskMode(mode);
    localStorage.setItem('strata_task_mode', mode);
  });

  const [autoMode, setAutoMode] = useState<boolean>(() => {
    const saved = localStorage.getItem('strata_auto_mode');
    return saved !== null ? saved === 'true' : true;
  });

  const handleToggleAutoMode = useEventCallback(() => {
    setAutoMode(prev => {
      const next = !prev;
      localStorage.setItem('strata_auto_mode', String(next));
      return next;
    });
  });
  const [isAboutOpen, setIsAboutOpen] = useState<boolean>(false);
  const [isReady, setIsReady] = useState<boolean>(false);
  // Non-null while the License Agreement still needs acceptance.
  const [agreement, setAgreement] = useState<{ text: string; version: string } | null>(null);

  // The loading screen is dismissed by the real boot gates - workspace,
  // provider config, agreement state and the file tree round-trips - raced
  // against 3 s, never by a fixed timer with invented stage text.
  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
    const gate = (p: any) => (p && typeof p.then === 'function' ? p : Promise.resolve());
    const gates = Promise.allSettled([
      gate(api?.getCurrentWorkspace?.()),
      gate(api?.getProviderConfig?.()),
      gate(api?.getAgreement?.()),
      gate(api?.getFiles?.())
    ]);
    Promise.race([gates, sleep(3000)]).then(() => { if (!cancelled) setIsReady(true); });
    return () => { cancelled = true; };
  }, [api]);

  // Tell the main process whether any buffer is unsaved, so closing the
  // window prompts instead of discarding the edit.
  const anyDirty = tabs.some(t => t.isDirty);
  useEffect(() => {
    api?.setDirty?.(anyDirty);
  }, [anyDirty, api]);

  // Panel sizing and visibility
  const [isEditorOpen, setIsEditorOpen] = useState<boolean>(true);
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(240);
  const [chatPanelWidth, setChatPanelWidth] = useState<number>(460);
  const [isDragging, setIsDragging] = useState<'fileTree' | 'chatPanel' | null>(null);

  // 100% Fully Local Sovereign AI Studio on your local GPU
  const [isHybrid, setIsHybrid] = useState<boolean>(() => {
    const saved = localStorage.getItem('strata_hybrid_mode');
    return saved !== null ? saved === 'true' : false;
  });

  const [hybridTier, setHybridTier] = useState<HybridTier>(() => {
    const saved = localStorage.getItem('strata_hybrid_tier') as HybridTier;
    return (saved === 'low' || saved === 'medium' || saved === 'high') ? saved : 'medium';
  });

  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({
    activeProvider: 'ollama',
    hybridMode: false,
    hybridTier: 'high',
    hybridArchitectModel: 'local'
  });

  const handleSelectArchitectModel = useEventCallback((modelId: string) => {
    setProviderConfig(prev => {
      const updated: ProviderConfig = {
        ...prev,
        hybridArchitectModel: modelId,
        generalModel: modelId,
        activeProvider: 'ollama'
      };
      api?.saveProviderConfig?.(updated);
      return updated;
    });
    setMessages(prev => [
      ...prev,
      {
        id: `sys_${Date.now()}`,
        role: 'assistant',
        content: `🧠 **Local Dual-Brain Architecture**: Switched active architect model to **${modelId}** (100% Local GPU)!`,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);
  });

  const handleToggleHybrid = useEventCallback(() => {
    setIsHybrid(prev => {
      const next = !prev;
      localStorage.setItem('strata_hybrid_mode', String(next));
      const updated: ProviderConfig = {
        ...providerConfig,
        hybridMode: next,
        activeProvider: next ? 'hybrid' : 'ollama'
      };
      setProviderConfig(updated);
      api?.saveProviderConfig?.(updated);
      return next;
    });
  });

  const handleSelectHybridTier = useEventCallback((tier: HybridTier) => {
    setHybridTier(tier);
    localStorage.setItem('strata_hybrid_tier', tier);
    const updated: ProviderConfig = {
      ...providerConfig,
      hybridTier: tier
    };
    setProviderConfig(updated);
    api?.saveProviderConfig?.(updated);
  });

  useEffect(() => {
    if (api?.getProviderConfig) {
      api.getProviderConfig().then((cfg: any) => {
        if (cfg) {
          setProviderConfig(cfg);
          if (cfg.hybridMode !== undefined) {
            setIsHybrid(cfg.hybridMode);
            localStorage.setItem('strata_hybrid_mode', String(cfg.hybridMode));
          }
          if (cfg.hybridTier) {
            setHybridTier(cfg.hybridTier);
          }
        }
      });
    }
  }, [api]);

  // Keep ProviderConfig synced with isHybrid, hybridTier, codingModel, generalModel
  useEffect(() => {
    setProviderConfig(prev => {
      const updated: ProviderConfig = {
        ...prev,
        hybridMode: isHybrid,
        hybridTier: hybridTier,
        codingModel: codingModel,
        generalModel: generalModel,
        activeProvider: isHybrid ? 'hybrid' : 'ollama'
      };
      api?.saveProviderConfig?.(updated);
      return updated;
    });
  }, [isHybrid, hybridTier, codingModel, generalModel, api]);

  // Chat and Agent
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<{ state: string; turn?: number }>({ state: 'idle' });
  const [pendingApproval, setPendingApproval] = useState<ToolCallItem | null>(null);
  const [collaborateStep, setCollaborateStep] = useState<CollaborateStepData | null>(null);

  const isBusy = status.state !== 'idle' && status.state !== 'stopped';

  // Mouse drag handler for resizing panels
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging === 'fileTree') {
        const newWidth = Math.max(160, Math.min(480, e.clientX));
        setFileTreeWidth(newWidth);
        window.dispatchEvent(new Event('resize'));
      } else if (isDragging === 'chatPanel') {
        const newWidth = Math.max(340, Math.min(window.innerWidth - fileTreeWidth - 200, window.innerWidth - e.clientX));
        setChatPanelWidth(newWidth);
        window.dispatchEvent(new Event('resize'));
      }
    };

    const handleMouseUp = () => {
      setIsDragging(null);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
    };

    if (isDragging) {
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, fileTreeWidth]);

  const handleStop = useEventCallback(() => {
    if (api?.stopAgent) {
      api.stopAgent();
      setStatus({ state: 'idle' });
      setPendingApproval(null);
      setMessages(prev => [
        ...prev,
        {
          id: `stop_${Date.now()}`,
          role: 'assistant',
          content: '⏹️ Generation interrupted by user (Esc).',
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    }
  });

  // Global ESC shortcut to stop/interrupt agent from anywhere
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isAboutOpen) {
          setIsAboutOpen(false);
        } else if (isModelManagerOpen) {
          setIsModelManagerOpen(false);
        } else if (isBusy) {
          e.preventDefault();
          e.stopPropagation();
          handleStop();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isBusy, isAboutOpen, isModelManagerOpen, handleStop]);

  // Global Ctrl+S shortcut to save active file from anywhere
  useEffect(() => {
    const handleGlobalSave = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (activeFile) {
          handleSave(activeFile);
        }
      }
    };
    window.addEventListener('keydown', handleGlobalSave);
    return () => window.removeEventListener('keydown', handleGlobalSave);
  }, [activeFile, tabs]);

  // Refresh installed models and details from Ollama
  const refreshModels = useEventCallback(async () => {
    if (api?.getModels) {
      const m = await api.getModels();
      if (m && m.length > 0) {
        setModels(m);
        // Automatically ensure active models point to an actually installed model.
        // Vision / embedding models are never auto-picked for either slot: a
        // freshly pulled qwen3-vl sorts first in Ollama's list and "m[0]" put it
        // in the coding slot.
        const isNonChat = (name: string) => /(^|[-_:/])(vl|vision|embed|embedding|rerank|whisper|clip)([-_:/]|$)/i.test(name);
        setCodingModel(prev => {
          if (m.includes(prev)) return prev;
          const fallback = m.find((name: string) => name.toLowerCase().includes('coder'))
            || m.find((name: string) => !isNonChat(name))
            || m[0];
          localStorage.setItem('strata_coding_model', fallback);
          return fallback;
        });
        setGeneralModel(prev => {
          if (m.includes(prev)) return prev;
          const fallback = m.find((name: string) => !name.toLowerCase().includes('coder') && !isNonChat(name))
            || m.find((name: string) => !name.toLowerCase().includes('coder'))
            || m[0];
          localStorage.setItem('strata_general_model', fallback);
          return fallback;
        });
      }
    }
    if (api?.getModelDetails) {
      const details = await api.getModelDetails();
      if (details) {
        setModelDetails(details);
      }
    }
  });

  // Check Ollama daemon health & connectivity
  const checkHealth = useEventCallback(async () => {
    if (api?.checkOllamaHealth) {
      try {
        const health: OllamaHealthStatus = await api.checkOllamaHealth();
        setOllamaHealth(prev => {
          if (prev && !prev.online && health.online) {
            refreshModels();
          }
          return health;
        });
        return health;
      } catch {
        setOllamaHealth({ online: false, binaryFound: false, error: 'Health check failed' });
      }
    }
    return null;
  });

  const handleStartOllama = useEventCallback(async () => {
    if (api?.startOllamaService) {
      setIsRestartingOllama(true);
      try {
        await api.startOllamaService();
        await checkHealth();
        await refreshModels();
      } finally {
        setIsRestartingOllama(false);
      }
    }
  });

  const handleRestartOllama = useEventCallback(async () => {
    if (api?.restartOllamaService) {
      setIsRestartingOllama(true);
      try {
        await api.restartOllamaService();
        await checkHealth();
        await refreshModels();
      } finally {
        setIsRestartingOllama(false);
      }
    }
  });

  // Heartbeat loop: ping Ollama daemon every 12s if online, every 3.5s if offline to auto-recover
  useEffect(() => {
    checkHealth();
    const intervalTime = ollamaHealth?.online ? 12000 : 3500;
    const interval = setInterval(() => {
      checkHealth();
    }, intervalTime);
    return () => clearInterval(interval);
  }, [checkHealth, ollamaHealth?.online]);

  // Load files and models on mount
  const refreshFiles = useEventCallback(async () => {
    if (api?.getFiles) {
      const res = await api.getFiles();
      setFiles(res.items || []);
      setWorkspace(res.root || workspace);
    }
  });

  useEffect(() => {
    refreshFiles();
    refreshModels();

    if (api?.getSystemInfo) {
      api.getSystemInfo().then((info: SystemInfo) => {
        if (info) setSystemInfo(info);
      });
    }

    // License Agreement: block the UI until accepted (the main process
    // also refuses agent:start until then, so this is belt and braces).
    if (api?.getAgreement) {
      api.getAgreement().then((st: any) => {
        if (st && st.available && !st.accepted) setAgreement({ text: st.text, version: st.version });
      }).catch(() => {});
    }

    // Global shortcuts: Ctrl+` (Terminal), Ctrl+O (Open Folder), Ctrl+N (New Chat), Ctrl+S (Save)
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '`' || e.key === '~') {
          e.preventDefault();
          setIsTerminalOpen(prev => !prev);
        } else if (e.key === 'o' || e.key === 'O') {
          e.preventDefault();
          handleOpenWorkspace();
        } else if (e.key === 'n' || e.key === 'N') {
          e.preventDefault();
          handleNewChat();
        } else if (e.key === 's' || e.key === 'S') {
          if (activeFileRef.current) {
            e.preventDefault();
            handleSave(activeFileRef.current);
          }
        }
      }
    };
    window.addEventListener('keydown', handleGlobalShortcuts);

    // Set up listeners with cleanups
    const unsubStatus = api?.onAgentStatus?.((s: any) => setStatus(s));
    const unsubError = api?.onAgentError?.((err: string) => {
      setMessages(prev => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          role: 'assistant',
          content: `⚠️ Error: ${err}`,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
      setStatus({ state: 'idle' });
    });

    const unsubMsgStart = api?.onAgentMessageStart?.((meta: any) => {
      setMessages(prev => [
        ...prev,
        {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          role: 'assistant',
          content: '',
          model: meta?.model || activeModelRef.current,
          senderModelType: meta?.senderModelType,
          senderRole: meta?.senderRole,
          senderName: meta?.senderName,
          addressedTo: meta?.addressedTo,
          taskMode: taskModeRef.current,
          timestamp: new Date().toLocaleTimeString()
        }
      ]);
    });

    const unsubToken = api?.onAgentToken?.((data: any) => {
      const token = typeof data === 'string' ? data : data?.token || '';
      const model = typeof data === 'object' && data?.model ? data.model : activeModelRef.current;
      const senderModelType = typeof data === 'object' ? data?.senderModelType : undefined;
      const senderRole = typeof data === 'object' ? data?.senderRole : undefined;
      const senderName = typeof data === 'object' ? data?.senderName : undefined;
      const addressedTo = typeof data === 'object' ? data?.addressedTo : undefined;

      // Ensure status immediately transitions from 'thinking' to 'responding' as tokens stream
      setStatus(prev => (prev.state === 'thinking' ? { ...prev, state: 'responding' } : prev));

      setMessages(prev => {
        const last = prev[prev.length - 1];
        const isSameSpeaker = last && last.role === 'assistant' &&
          (!senderModelType || !last.senderModelType || last.senderModelType === senderModelType) &&
          (!model || !last.model || last.model === model);

        if (isSameSpeaker) {
          return [
            ...prev.slice(0, -1),
            { 
              ...last, 
              content: last.content + token, 
              model: last.model || model,
              senderModelType: last.senderModelType || senderModelType,
              senderRole: last.senderRole || senderRole,
              senderName: last.senderName || senderName,
              addressedTo: last.addressedTo || addressedTo
            }
          ];
        } else {
          return [
            ...prev,
            {
              id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
              role: 'assistant',
              content: token,
              model: model,
              senderModelType,
              senderRole,
              senderName,
              addressedTo,
              taskMode: taskModeRef.current,
              timestamp: new Date().toLocaleTimeString()
            }
          ];
        }
      });
    });

    const unsubToolStart = api?.onAgentToolStart?.((tool: any) => {
      if (!tool.autoMode) {
        setPendingApproval({
          id: tool.id,
          name: tool.name,
          args: tool.args,
          status: 'pending'
        });
      }

      setMessages(prev => {
        const last = prev[prev.length - 1];
        const newTool: ToolCallItem = {
          id: tool.id,
          name: tool.name,
          args: tool.args,
          status: 'running'
        };
        if (last && last.role === 'assistant') {
          return [
            ...prev.slice(0, -1),
            { ...last, tools: [...(last.tools || []), newTool] }
          ];
        }
        return prev;
      });
    });

    const unsubToolFinish = api?.onAgentToolFinish?.((tool: any) => {
      setPendingApproval(null);
      refreshFiles();

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.tools) {
          const updatedTools = last.tools.map(t =>
            t.id === tool.id
              ? { ...t, status: (tool.success ? 'success' : 'failed') as any, output: tool.output, diff: tool.diff }
              : t
          );
          return [
            ...prev.slice(0, -1),
            { ...last, tools: updatedTools }
          ];
        }
        return prev;
      });
    });

    // Model Pull Progress listener
    const unsubPull = api?.onPullProgress?.((prog: PullProgressData) => {
      setPullProgress(prog);
      if (prog.done) {
        refreshModels();
        if (!prog.cancelled && !prog.error) {
          setTimeout(() => {
            setPullProgress(null);
          }, 3500);
        }
      }
    });

    const unsubCollaborate = api?.onAgentCollaborateStep?.((step: CollaborateStepData) => {
      setCollaborateStep(step);
    });

    const unsubHybridDisabled = api?.onHybridDisabled?.((data: any) => {
      console.warn('Hybrid mode disabled by agent:', data);
      setIsHybrid(false);
      localStorage.setItem('strata_hybrid_mode', 'false');
    });

    return () => {
      window.removeEventListener('keydown', handleGlobalShortcuts);
      unsubStatus?.();
      unsubError?.();
      unsubToken?.();
      unsubMsgStart?.();
      unsubToolStart?.();
      unsubToolFinish?.();
      unsubPull?.();
      unsubCollaborate?.();
      unsubHybridDisabled?.();
    };
  }, [refreshModels]);

  const handlePullModel = useEventCallback(async (modelName: string) => {
    setPullProgress({
      modelName,
      status: 'Connecting to Ollama...',
      percent: 0,
      isPulling: true
    } as any);
    await api?.pullModel?.(modelName);
  });

  const handleCancelPull = useEventCallback(async () => {
    await api?.cancelPull?.();
    setPullProgress(null);
  });

  const handleDeleteModel = useEventCallback(async (modelName: string) => {
    await api?.deleteModel?.(modelName);
    await refreshModels();
  });

  const handleOpenWorkspace = useEventCallback(async () => {
    if (api?.openDirectory) {
      const selected = await api.openDirectory();
      if (selected) {
        setWorkspace(selected);
        refreshFiles();
      }
    }
  });

  const handleSelectFile = useEventCallback(async (filePath: string) => {
    setIsEditorOpen(true);
    setActiveFile(filePath);
    const existing = tabs.find(t => t.path === filePath);
    if (!existing) {
      const content = await api?.readFile(filePath) || '';
      const name = filePath.split(/[\\/]/).pop() || 'file';
      setTabs(prev => [...prev, { path: filePath, name, content }]);
    }
  });

  const handleCloseTab = useEventCallback((path: string) => {
    const remaining = tabs.filter(t => t.path !== path);
    setTabs(remaining);
    if (activeFile === path) {
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
    // If all tabs are closed, collapse the editor and expand Agent Studio!
    if (remaining.length === 0) {
      setIsEditorOpen(false);
    }
  });

  const handleChangeContent = useEventCallback((path: string, content: string) => {
    setTabs(prev => prev.map(t => t.path === path ? { ...t, content, isDirty: true } : t));
  });

  const handleSave = useEventCallback(async (path: string) => {
    const tab = tabs.find(t => t.path === path);
    if (tab && api?.saveFile) {
      await api.saveFile(path, tab.content);
      setTabs(prev => prev.map(t => t.path === path ? { ...t, isDirty: false } : t));
      refreshFiles();
    }
  });

  const handleCreateFile = useEventCallback(async (name: string) => {
    if (api?.createFile) {
      const res = await api.createFile(name);
      if (res.success) {
        refreshFiles();
        handleSelectFile(res.path);
      }
    }
  });

  const handleSendMessage = useEventCallback((prompt: string, images?: string[]) => {
    setMessages(prev => [
      ...prev,
      {
        id: `user_${Date.now()}`,
        role: 'user',
        content: prompt,
        images: images,
        model: activeModel,
        taskMode: taskMode,
        timestamp: new Date().toLocaleTimeString()
      }
    ]);

    const activeTab = tabs.find(t => t.path === activeFile);
    const editorContext = {
      activeFile: activeFile,
      activeFileContent: activeTab ? activeTab.content : null,
      openTabs: tabs.map(t => ({ path: t.path, name: t.name, isDirty: t.isDirty })),
      isEditorOpen: isEditorOpen
    };

    api?.startAgent(prompt, activeModel, autoMode, taskMode, editorContext, images).then((res: any) => {
      if (res && res.started === false && res.error) {
        setMessages(prev => [...prev, {
          id: `err_${Date.now()}`, role: 'assistant', content: `⚠️ ${res.error}`, timestamp: new Date().toLocaleTimeString()
        }]);
        setStatus({ state: 'idle' });
      }
    }).catch(() => {});
  });

  const acceptAgreement = useEventCallback(async () => {
    const res = await api?.acceptAgreement?.();
    if (res?.success) setAgreement(null);
  });
  const declineAgreement = useEventCallback(async () => {
    await api?.declineAgreement?.();
  });

  const handleNewChat = useEventCallback(async () => {
    if (isBusy) {
      handleStop();
    }
    if (api?.resetHistory) {
      await api.resetHistory();
    }
    setMessages([]);
    setPendingApproval(null);
    setCollaborateStep(null);
    setStatus({ state: 'idle' });
  });

  const handleApprove = useEventCallback((approvalId: string, approved: boolean) => {
    api?.respondApproval(approvalId, approved);
    setPendingApproval(null);
  });

  // Side-by-side Monaco Diff Handlers
  const handleOpenDiff = useEventCallback((diff: { path: string; oldContent: string; newContent: string }) => {
    setActiveDiff(diff);
    setIsEditorOpen(true);
  });

  const handleCloseDiff = useEventCallback(() => {
    setActiveDiff(null);
  });

  const handleAcceptDiff = useEventCallback(async (diff: ActiveDiff) => {
    if (api?.saveFile) {
      await api.saveFile(diff.path, diff.newContent);
      setTabs(prev => prev.map(t => t.path === diff.path ? { ...t, content: diff.newContent, isDirty: false } : t));
      refreshFiles();
    }
    setActiveDiff(null);
  });

  const handleRevertDiff = useEventCallback(async (diff: ActiveDiff) => {
    if (api?.saveFile) {
      await api.saveFile(diff.path, diff.oldContent);
      setTabs(prev => prev.map(t => t.path === diff.path ? { ...t, content: diff.oldContent, isDirty: false } : t));
      refreshFiles();
    }
    setActiveDiff(null);
  });

  // These MUST stay above the splash-screen early return below. Declared after
  // it, they were skipped on the first render and executed on the next - 45
  // extra hooks, React error #310, and a blank window on every launch.
  // --- stable UI handlers -------------------------------------------------
  // Previously inline arrows in JSX. A new function identity on every render
  // silently defeats React.memo on the children below, so memoizing them
  // without this would have achieved nothing.
  const openAbout = useEventCallback(() => setIsAboutOpen(true));
  const closeAbout = useEventCallback(() => setIsAboutOpen(false));
  const openModelManager = useEventCallback(() => setIsModelManagerOpen(true));
  const closeModelManager = useEventCallback(() => setIsModelManagerOpen(false));
  const openDualBrain = useEventCallback(() => setIsDualBrainModalOpen(true));
  const closeDualBrain = useEventCallback(() => setIsDualBrainModalOpen(false));
  const toggleEditor = useEventCallback(() => setIsEditorOpen((v: boolean) => !v));
  const closeEditor = useEventCallback(() => setIsEditorOpen(false));
  const toggleTerminal = useEventCallback(() => setIsTerminalOpen((v: boolean) => !v));
  const closeTerminal = useEventCallback(() => setIsTerminalOpen(false));
  const startFileTreeDrag = useEventCallback(() => setIsDragging('fileTree'));
  const startChatPanelDrag = useEventCallback(() => setIsDragging('chatPanel'));
  const saveActiveFile = useEventCallback(() => { if (activeFile) handleSave(activeFile); });
  const closeActiveTab = useEventCallback(() => { if (activeFile) handleCloseTab(activeFile); });
  const clearPullProgress = useEventCallback(() => setPullProgress(null));

  if (!isReady) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-studio-bg select-none animate-in fade-in duration-300">
        <div className="w-20 h-20 flex items-center justify-center relative">
          <img 
            src={STRATA_ICON} 
            alt="Strata" 
            className="w-20 h-20 object-contain drop-shadow-[0_0_24px_rgba(45,212,191,0.5)] animate-pulse" 
          />
        </div>
        <div className="mt-4 flex flex-col items-center">
          <h1 className="text-3xl font-extrabold tracking-widest text-white">
            STRATA
          </h1>
          <span className="text-xs font-semibold tracking-[0.3em] text-slate-400 mt-0.5">
            CODE
          </span>
        </div>
        <div className="mt-2.5 px-3 py-1 rounded-full bg-role-worker-500/10 border border-role-worker-500/30 text-micro font-semibold tracking-wider text-role-worker-400 uppercase">
          {systemInfo?.gpu ? `${systemInfo.gpu.replace(/^NVIDIA\s+|GeForce\s+/i, '')} • Local AI Studio` : 'Hardware Accelerated • Local AI Studio'}
        </div>
        <div className="mt-6 w-[300px] h-1.5 bg-white/10 rounded-full overflow-hidden border border-white/5">
          <div className="h-full w-full bg-gradient-to-r from-role-worker-500 via-state-info-500 to-state-info-500 rounded-full animate-pulse shadow-[0_0_12px_rgba(45,212,191,0.6)]"></div>
        </div>
        <div className="mt-3 text-micro font-mono text-slate-400 flex items-center space-x-2">
          <span>Loading workspace and settings…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-studio-bg overflow-hidden text-studio-text select-none">
      <TitleBar
        workspace={workspace}
        onOpenWorkspace={handleOpenWorkspace}
        models={models}
        taskMode={taskMode}
        onSelectTaskMode={handleSelectTaskMode}
        activeModel={activeModel}
        onSelectModel={handleSelectModel}
        autoMode={autoMode}
        onToggleAutoMode={handleToggleAutoMode}
        onOpenAbout={openAbout}
        onOpenModelManager={openModelManager}
        isBusy={isBusy}
        onStop={handleStop}
        isEditorOpen={isEditorOpen}
        onToggleEditor={toggleEditor}
        isTerminalOpen={isTerminalOpen}
        onToggleTerminal={toggleTerminal}
        systemInfo={systemInfo}
        ollamaHealth={ollamaHealth}
        isRestartingOllama={isRestartingOllama}
        onStartOllama={handleStartOllama}
        onRestartOllama={handleRestartOllama}
        onNewChat={handleNewChat}
        onSaveActiveFile={saveActiveFile}
        onCloseActiveTab={closeActiveTab}
        onRefreshFiles={refreshFiles}
        activeFile={activeFile}
        isHybrid={isHybrid}
        onToggleHybrid={handleToggleHybrid}
        hybridTier={hybridTier}
        onSelectHybridTier={handleSelectHybridTier}
        codingModel={codingModel}
        generalModel={generalModel}
        architectModel={providerConfig.hybridArchitectModel || generalModel || 'qwen3.8:27b'}
        onOpenDualBrainModal={openDualBrain}
      />

      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: Explorer */}
        <FileTree
          files={files}
          activeFile={activeFile}
          onSelectFile={handleSelectFile}
          onRefresh={refreshFiles}
          onCreateFile={handleCreateFile}
          width={fileTreeWidth}
        />

        {/* Resizer 1: Between FileTree and Editor/Studio */}
        <div
          onMouseDown={startFileTreeDrag}
          className="w-1 hover:w-1.5 bg-studio-border hover:bg-role-user-500 cursor-col-resize transition-all duration-150 flex items-center justify-center group select-none relative z-20 flex-shrink-0"
          title="Drag to resize explorer"
        >
          <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
          <div className="hidden group-hover:block w-0.5 h-6 bg-role-user-300 rounded" />
        </div>

        {/* Middle: Code Editor (collapsible) */}
        {isEditorOpen && (
          <>
            <CodeEditor
              tabs={tabs}
              activeTabPath={activeFile}
              onSelectTab={setActiveFile}
              onCloseTab={handleCloseTab}
              onCloseEditor={closeEditor}
              onChangeContent={handleChangeContent}
              onSave={handleSave}
              activeDiff={activeDiff}
              onCloseDiff={handleCloseDiff}
              onAcceptDiff={handleAcceptDiff}
              onRevertDiff={handleRevertDiff}
              activeModel={activeModel}
            />

            {/* Resizer 2: Between Code Editor and Agent Studio */}
            <div
              onMouseDown={startChatPanelDrag}
              className="w-1 hover:w-1.5 bg-studio-border hover:bg-role-user-500 cursor-col-resize transition-all duration-150 flex items-center justify-center group select-none relative z-20 flex-shrink-0"
              title="Drag to resize Agent Studio"
            >
              <div className="absolute inset-y-0 -left-1.5 -right-1.5 cursor-col-resize" />
              <div className="hidden group-hover:block w-0.5 h-6 bg-role-user-300 rounded" />
            </div>
          </>
        )}

        {/* Right: Agent Studio (expands to fill middle space when editor is closed) */}
        <ChatPanel
          messages={messages}
          status={status}
          pendingApproval={pendingApproval}
          onSendMessage={handleSendMessage}
          onStop={handleStop}
          onApprove={handleApprove}
          onNewChat={handleNewChat}
          isEditorOpen={isEditorOpen}
          onToggleEditor={toggleEditor}
          width={chatPanelWidth}
          taskMode={taskMode}
          onSelectTaskMode={handleSelectTaskMode}
          activeModel={activeModel}
          files={files}
          systemInfo={systemInfo}
          onOpenDiff={handleOpenDiff}
          activeFile={activeFile}
          openTabs={tabs.map(t => ({ path: t.path, name: t.name }))}
          collaborateStep={collaborateStep}
          onOpenModelManager={openModelManager}
          isHybrid={isHybrid}
          onToggleHybrid={handleToggleHybrid}
          hybridTier={hybridTier}
          onSelectHybridTier={handleSelectHybridTier}
          autoMode={autoMode}
          onToggleAutoMode={handleToggleAutoMode}
          codingModel={codingModel}
          generalModel={generalModel}
          architectModel={providerConfig.hybridArchitectModel || generalModel || 'qwen3.8:27b'}
          onOpenDualBrainModal={openDualBrain}
          onSelectArchitectModel={handleSelectArchitectModel}
        />
      </div>

        {/* Transparent mouse drag overlay to prevent Monaco Editor or iframes from intercepting drag events */}
        {isDragging && (
          <div 
            className="fixed inset-0 z-50 cursor-col-resize select-none"
            style={{ pointerEvents: 'auto', userSelect: 'none' }}
          />
        )}

      <StatusBar workspace={workspace} />

      {/* Integrated Interactive Terminal (PowerShell on Windows, zsh/bash on macOS) Drawer */}
      <TerminalDrawer
        isOpen={isTerminalOpen}
        onClose={closeTerminal}
        workspace={workspace}
      />

      {agreement && (
        <AgreementModal
          text={agreement.text}
          version={agreement.version}
          onAccept={acceptAgreement}
          onDecline={declineAgreement}
        />
      )}

      <AboutModal
        isOpen={isAboutOpen}
        onClose={closeAbout}
        selectedModel={activeModel}
        systemInfo={systemInfo}
        isHybrid={isHybrid}
        hybridTier={hybridTier}
        architectModel={providerConfig.hybridArchitectModel || generalModel || 'qwen3.8:27b'}
      />

      <ModelManagerModal
        isOpen={isModelManagerOpen}
        onClose={closeModelManager}
        installedModels={modelDetails}
        activeCodingModel={codingModel}
        activeGeneralModel={generalModel}
        onSelectCodingModel={(m) => {
          setCodingModel(m);
          localStorage.setItem('strata_coding_model', m);
        }}
        onSelectGeneralModel={(m) => {
          setGeneralModel(m);
          localStorage.setItem('strata_general_model', m);
        }}
        pullProgress={pullProgress}
        onPullModel={handlePullModel}
        onCancelPull={handleCancelPull}
        onDeleteModel={handleDeleteModel}
        onRefreshModels={refreshModels}
        systemInfo={systemInfo}
        ollamaHealth={ollamaHealth}
        isRestartingOllama={isRestartingOllama}
        onStartOllama={handleStartOllama}
        onRestartOllama={handleRestartOllama}
        onClearPullProgress={clearPullProgress}
      />

      <DualBrainModal
        isOpen={isDualBrainModalOpen}
        onClose={closeDualBrain}
        activeArchitectModel={providerConfig.hybridArchitectModel || generalModel || 'qwen3.8:27b'}
        onSelectArchitectModel={handleSelectArchitectModel}
        activeLocalModel={activeModel}
        onSelectLocalModel={handleSelectModel}
        installedLocalModels={models}
        isHybrid={isHybrid}
      />
    </div>
  );
};
