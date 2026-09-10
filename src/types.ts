export interface FileNode {
  name: string;
  path: string;
  relPath: string;
  isDir: boolean;
  children?: FileNode[];
}

export interface OpenTab {
  path: string;
  name: string;
  content: string;
  isDirty?: boolean;
}

export type TaskMode = 'coding' | 'general';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  model?: string;
  taskMode?: TaskMode;
  tools?: ToolCallItem[];
  timestamp: string;
  senderModelType?: 'online' | 'offline' | 'user';
  senderRole?: 'architect' | 'worker' | 'user';
  senderName?: string;
  addressedTo?: string;
  images?: string[];
  documents?: Array<{ name: string; size?: number; type?: string; content?: string }>;
}

export interface ToolCallItem {
  id: string;
  name: string;
  args: any;
  status: 'pending' | 'running' | 'success' | 'failed';
  output?: string;
  diff?: {
    path: string;
    oldContent: string;
    newContent: string;
  };
}

export interface OllamaModelDetail {
  name: string;
  size: number;
  modified_at: string;
  digest: string;
  details?: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface PullProgressData {
  modelName: string;
  status: string;
  total?: number;
  completed?: number;
  percent?: number;
  done?: boolean;
  cancelled?: boolean;
  error?: string;
}

export interface SystemInfo {
  gpu: string;
  vram?: string;
  cpu: string;
  ram: string;
  os: string;
}

export interface ActiveDiff {
  path: string;
  oldContent: string;
  newContent: string;
  toolId?: string;
}

export interface TerminalHistoryItem {
  id: string;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  timestamp: string;
}

export type ModelProvider = 'ollama' | 'local' | 'hybrid';

export interface ModelUsageStats {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUsed?: string;
}

export type HybridTier = 'low' | 'medium' | 'high';

export interface CollaborateStepData {
  stage: 'plan' | 'executing' | 'escalate' | 'verified' | 'fallback';
  architectModel: string;
  workerModel: string;
  activeRole: 'architect' | 'worker';
  title?: string;
  message: string;
  cloudTokens?: number;
  localTokens: number;
  quotaSavedPercent?: number;
  hybridTier?: HybridTier;
}

export interface ProviderConfig {
  activeProvider: ModelProvider;
  hybridMode?: boolean;
  hybridTier?: HybridTier;
  hybridArchitectModel?: string;
  hybridWorkerModel?: string;
  ollamaModel?: string;
  codingModel?: string;
  generalModel?: string;
  openaiBaseUrl?: string;
  localServerApiKey?: string;
  disableVramArbiter?: boolean;
  ollamaKeepAlive?: string;
  allowPaidApis?: boolean;
  /** Run the project's typecheck/test after the worker edits files and feed failures back. Default true. */
  verificationGate?: boolean;
  /** Let a thinking-capable Ollama architect think: 'auto' = high tier + stall re-plans (default). */
  architectThinking?: 'off' | 'auto' | 'on';
  /** How many times the architect may send the worker back after review. Default 1. */
  maxReviewRounds?: number;
}

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

export interface OllamaHealthStatus {
  online: boolean;
  version?: string;
  binaryFound: boolean;
  binaryPath?: string;
  error?: string;
}
