const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 'win32' | 'darwin' | 'linux' - the renderer picks shell labels and shortcut hints from it.
  platform: process.platform,
  // Window controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  // Whether any editor buffer is unsaved; the main process prompts on close when true.
  setDirty: (dirty) => ipcRenderer.send('window:set-dirty', !!dirty),

  // Workspace
  openDirectory: () => ipcRenderer.invoke('workspace:open-dialog'),
  getCurrentWorkspace: () => ipcRenderer.invoke('workspace:get-current'),

  // Tester License Agreement (EULA.md). The agent refuses to run until accepted.
  getAgreement: () => ipcRenderer.invoke('legal:get-agreement'),
  acceptAgreement: () => ipcRenderer.invoke('legal:accept'),
  declineAgreement: () => ipcRenderer.invoke('legal:decline'),
  getFiles: (dirPath) => ipcRenderer.invoke('workspace:get-files', dirPath),
  readFile: (filePath) => ipcRenderer.invoke('workspace:read-file', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('workspace:save-file', filePath, content),
  createFile: (filePath) => ipcRenderer.invoke('workspace:create-file', filePath),

  // Ollama Model Management
  getModels: () => ipcRenderer.invoke('ollama:get-models'),
  getModelDetails: () => ipcRenderer.invoke('ollama:get-model-details'),
  pullModel: (modelName) => ipcRenderer.invoke('ollama:pull-model', modelName),
  cancelPull: () => ipcRenderer.invoke('ollama:cancel-pull'),
  deleteModel: (modelName) => ipcRenderer.invoke('ollama:delete-model', modelName),
  onPullProgress: (callback) => {
    const handler = (_e, progress) => callback(progress);
    ipcRenderer.on('ollama:pull-progress', handler);
    return () => ipcRenderer.removeListener('ollama:pull-progress', handler);
  },

  // Ollama Daemon & Health Management
  checkOllamaHealth: () => ipcRenderer.invoke('ollama:health-check'),
  startOllamaService: () => ipcRenderer.invoke('ollama:start-service'),
  restartOllamaService: () => ipcRenderer.invoke('ollama:restart-service'),

  // Agent with taskMode & reset
  startAgent: (prompt, model, autoMode, taskMode, editorContext, images) =>
    ipcRenderer.invoke('agent:start', prompt, model, autoMode, taskMode, editorContext, images),
  stopAgent: () => ipcRenderer.invoke('agent:stop'),
  resetHistory: () => ipcRenderer.invoke('agent:reset-history'),
  respondApproval: (approvalId, approved) =>
    ipcRenderer.invoke('agent:approval-response', approvalId, approved),

  // System Hardware Info (Dynamic GPU / CPU / RAM Detection)
  getSystemInfo: () => ipcRenderer.invoke('system:get-info'),

  // Inline AI Precision Generation (Ctrl+K)
  inlineGenerate: (payload) => ipcRenderer.invoke('ai:inline-generate', payload),

  // Interactive Terminal Runner
  runTerminalCommand: (command) => ipcRenderer.invoke('terminal:run-command', command),

  // Leak-free listeners with cleanup functions
  onAgentToken: (callback) => {
    const handler = (_e, token) => callback(token);
    ipcRenderer.on('agent:token', handler);
    return () => ipcRenderer.removeListener('agent:token', handler);
  },
  onAgentStatus: (callback) => {
    const handler = (_e, status) => callback(status);
    ipcRenderer.on('agent:status', handler);
    return () => ipcRenderer.removeListener('agent:status', handler);
  },
  onAgentToolStart: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('agent:tool-start', handler);
    return () => ipcRenderer.removeListener('agent:tool-start', handler);
  },
  onAgentToolFinish: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('agent:tool-finish', handler);
    return () => ipcRenderer.removeListener('agent:tool-finish', handler);
  },
  onAgentError: (callback) => {
    const handler = (_e, err) => callback(err);
    ipcRenderer.on('agent:error', handler);
    return () => ipcRenderer.removeListener('agent:error', handler);
  },
  onMessageAdded: (callback) => {
    const handler = (_e, msg) => callback(msg);
    ipcRenderer.on('agent:message-added', handler);
    return () => ipcRenderer.removeListener('agent:message-added', handler);
  },
  onAgentThought: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('agent:thought', handler);
    return () => ipcRenderer.removeListener('agent:thought', handler);
  },
  onAgentStep: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('agent:step', handler);
    return () => ipcRenderer.removeListener('agent:step', handler);
  },

  // Provider config and the local engines (Ollama & llama-server)
  getEngineStatus: (force) => ipcRenderer.invoke('engine:status', !!force),
  // Explicit, user-initiated: unload every Ollama model (including another
  // app's) and start the coder server. Never called automatically.
  takeGpu: () => ipcRenderer.invoke('engine:take-gpu'),
  stopCoderServer: () => ipcRenderer.invoke('engine:stop-coder'),
  // Coder server lifecycle pushes: {kind: 'starting'|'up'|'exited'|'error'|'stopped', detail}.
  // The status bar shows `detail` instead of a bare "coder offline".
  onCoderEvent: (callback) => {
    const handler = (_e, data) => callback(data);
    ipcRenderer.on('coder:event', handler);
    return () => ipcRenderer.removeListener('coder:event', handler);
  },
  getProviderConfig: () => ipcRenderer.invoke('provider:get-config'),
  saveProviderConfig: (config) => ipcRenderer.invoke('provider:save-config', config),
  openExternalUrl: (url) => ipcRenderer.invoke('shell:open-external', url),

  onAgentMessageStart: (callback) => {
    const handler = (_e, meta) => callback(meta);
    ipcRenderer.on('agent:message-start', handler);
    return () => ipcRenderer.removeListener('agent:message-start', handler);
  }
});
