import { ToolExecutor, OLLAMA_TOOLS } from './tools';
import {
  buildProjectProfile, buildRetrievalBlock, chooseVerifyCommands, compactVerifyOutput,
  outlineSource as outlineSourceText, summarizeDiff, ProjectProfile
} from './grounding';
import {
  TaskPlan, parseBlueprint, renderChecklist, pendingTasks, applyToolOutcome, applyCompletionClaims,
  closeTasksClaimedDone, detectCompletionClaim, detectNarratedIntent, extractEmbeddedToolCalls, parseReviewVerdict,
  isAdvisoryRequest
} from './plan';
import { WebContents } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';

export interface AgentMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    function: { name: string; arguments: any };
  }>;
  images?: string[];
}

export interface ModelUsageStats {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  lastUsed?: string;
}

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
  hybridTier?: 'low' | 'medium' | 'high';
}

export interface ProviderConfig {
  activeProvider: 'ollama' | 'local' | 'hybrid';
  hybridMode?: boolean;
  hybridArchitectModel?: string;
  hybridArchitectProvider?: ArchitectProvider;
  allowPaidApis?: boolean;
  hybridWorkerModel?: string;
  hybridTier?: 'low' | 'medium' | 'high';
  ollamaModel?: string;
  codingModel?: string;
  generalModel?: string;
  openaiBaseUrl?: string;
  /** Set true to disable automatic VRAM-aware routing between llama-server and Ollama. */
  disableVramArbiter?: boolean;
  /** Ollama keep_alive for loaded models. Default adapts to whether llama-server is resident. */
  ollamaKeepAlive?: string;
  /** Shared secret for the local llama-server (`--api-key`). */
  localServerApiKey?: string;
  /** Run the project's typecheck/test after the worker edits files and feed failures back. Default true. */
  verificationGate?: boolean;
  /** Let a thinking-capable Ollama architect think: 'auto' = high tier + stall re-plans (default). */
  architectThinking?: 'off' | 'auto' | 'on';
  /** How many times the architect may send the worker back after review. Default 1. */
  maxReviewRounds?: number;
}

/** Local dual-brain architect provider. */
export type ArchitectProvider = 'local';

export interface ArchitectModelOption {
  id: string;
  name: string;
  provider: ArchitectProvider;
  live: boolean;
}

export type HybridBand = 'trivial' | 'moderate' | 'complex' | 'deep';

export interface TaskClassification {
  score: number;
  band: HybridBand;
  signals: string[];
}

export interface HybridPlan {
  band: HybridBand;
  useArchitect: boolean;
  tier: 'low' | 'medium' | 'high';
  escalateOnStall: boolean;
  quotaDemoted: boolean;
  reason: string;
  classification: TaskClassification;
}

/** What is actually resident on the GPU right now. */
export interface LocalEngineStatus {
  checkedAt: number;
  /** `loading`: the llama-server process exists but is not answering yet - it is already holding VRAM. */
  llamaServer: { up: boolean; loading?: boolean; alias?: string; nCtx?: number };
  ollamaLoaded: { name: string; vramBytes: number }[];
  gpu?: { totalMiB: number; usedMiB: number; freeMiB: number };
}

export interface EditorContext {
  activeFile?: string | null;
  activeFileContent?: string | null;
  openTabs?: { path: string; name: string; isDirty?: boolean }[];
  isEditorOpen?: boolean;
}


export class AgentEngine {
  workspaceDir: string;
  tools: ToolExecutor;
  sender: WebContents | null = null;
  abortController: AbortController | null = null;
  history: AgentMessage[] = [];
  pendingApprovals = new Map<string, (approved: boolean) => void>();
  gpuName: string = 'RTX 5090';
  providerConfig: ProviderConfig = {
    activeProvider: 'ollama',
    hybridMode: false,
    hybridArchitectModel: 'local',
    hybridArchitectProvider: 'local',
    allowPaidApis: false
  };
  static nonToolModels: Set<string> = new Set<string>(['gemma3:27b', 'gemma3', 'gemma:7b', 'gemma:2b', 'gemma']);

  constructor(workspaceDir: string) {
    this.workspaceDir = workspaceDir;
    this.tools = new ToolExecutor(workspaceDir);
  }

  setProviderConfig(config: ProviderConfig) {
    this.providerConfig = config || {
      activeProvider: 'ollama',
      hybridMode: false,
      hybridArchitectModel: 'qwen3.8:27b',
      generalModel: 'qwen3.8:27b',
      codingModel: 'Qwen3-Coder-30B-A3B-Instruct',
      allowPaidApis: false
    };
  }

  onConfigUpdate?: (config: ProviderConfig) => void;

  /**
   * Gracefully falls back to direct model execution if an engine error occurs.
   */
  handleQuotaExceeded(reason: string, workerModel: string): string {
    console.warn(`[Local Dual-Brain] Handled notice: ${reason}`);
    this.providerConfig.hybridMode = false;
    this.providerConfig.activeProvider = 'ollama';
    if (this.onConfigUpdate) {
      this.onConfigUpdate(this.providerConfig);
    }
    this.send('provider:config-updated', this.providerConfig);
    this.send('hybrid:disabled', { reason, fallbackModel: workerModel });

    return `> 🛡️ **Local Dual-Brain Notice**: ${reason}\n>\n` +
           `> Continuing 100% locally on your NVIDIA RTX 5090 GPU (\`${workerModel}\`) with zero interruption, zero cost, and unlimited local tokens!\n\n`;
  }

  recordGeminiUsage(
    _promptTokens = 0,
    _candidateTokens = 0,
    _localTokensOffloaded = 0,
    _modelName?: string,
    _advanceQuotaMeters = true
  ) {
    // Pure local dual-brain mode: zero cloud tokens tracked.
  }

  getGeminiQuota(): any {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      requestCount: 0,
      localTokensOffloaded: 0
    };
  }

  setGpuName(gpu: string) {
    if (gpu && gpu.trim()) {
      this.gpuName = gpu.trim();
    }
  }

  setWorkspace(dir: string) {
    this.workspaceDir = dir;
    this.tools.setWorkspace(dir);
  }

  setSender(sender: WebContents | null) {
    this.sender = sender;
  }

  // --- Streaming token coalescer -------------------------------------------
  // llama-server on port 8080 streams at ~237 tok/s. Forwarding one IPC message
  // per token forced ~237 React commits/sec in the renderer, each of which
  // re-ran the full message list and the markdown/code-fence parser over the
  // whole message (O(n^2) as the response grows). Tokens are now merged into a
  // single message per flush window; any non-token event flushes first so
  // ordering is preserved exactly.
  private static readonly TOKEN_FLUSH_MS = 40;
  private tokenBuffer: { key: string; payload: any } | null = null;
  private tokenFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private send(channel: string, ...args: any[]) {
    if (channel === 'agent:token') {
      this.queueToken(args[0]);
      return;
    }
    this.flushTokens();
    this.rawSend(channel, ...args);
  }

  private rawSend(channel: string, ...args: any[]) {
    try {
      if (this.sender && !this.sender.isDestroyed()) {
        this.sender.send(channel, ...args);
      }
    } catch {
      // Safe no-op if webContents is destroyed
    }
  }

  private queueToken(payload: any) {
    const token = typeof payload === 'string' ? payload : (payload?.token ?? '');
    if (!token) return;

    const meta: any = typeof payload === 'string' ? {} : { ...payload };
    delete meta.token;
    const key = JSON.stringify(meta);

    if (this.tokenBuffer && this.tokenBuffer.key === key) {
      this.tokenBuffer.payload.token += token;
    } else {
      // Speaker or metadata changed - emit what we have before starting a new run.
      this.flushTokens();
      this.tokenBuffer = { key, payload: { ...meta, token } };
    }

    if (!this.tokenFlushTimer) {
      this.tokenFlushTimer = setTimeout(() => {
        this.tokenFlushTimer = null;
        this.flushTokens();
      }, AgentEngine.TOKEN_FLUSH_MS);
    }
  }

  private flushTokens() {
    if (this.tokenFlushTimer) {
      clearTimeout(this.tokenFlushTimer);
      this.tokenFlushTimer = null;
    }
    const buffered = this.tokenBuffer;
    this.tokenBuffer = null;
    if (buffered && buffered.payload.token) {
      this.rawSend('agent:token', buffered.payload);
    }
  }

  /**
   * Engine notice shown in the transcript as its own "Strata Engine" bubble.
   *
   * These used to go out on `agent:error`, which the renderer turns into a
   * "⚠️ Error:" message AND flips the status to idle mid-run - so a routine
   * VRAM-arbiter routing note looked like a crash. The token path starts a new
   * bubble automatically whenever the model label changes.
   */
  private notice(text: string) {
    this.send('agent:token', {
      token: `> ${text}\n`,
      model: 'Strata Engine',
      senderModelType: 'local',
      senderName: 'Strata Engine',
      addressedTo: 'User'
    });
    this.flushTokens();
  }

  /**
   * Rough token estimate for budgeting. Counts tool-call arguments and image
   * payloads, not just `content` - a single write_file call carries the whole
   * file body inside tool_calls[].function.arguments, which the previous
   * estimator scored as zero tokens and which is how the context guard could be
   * satisfied right up to the moment the request overflowed.
   * ~3 chars/token is the realistic ratio for source code (prose is ~4).
   */
  private estimateMessageTokens(msgs: AgentMessage[]): number {
    let chars = 0;
    for (const m of msgs) {
      chars += m.content?.length || 0;
      const calls = (m.tool_calls || (m as any).toolCalls) as any[] | undefined;
      if (calls && calls.length) {
        for (const tc of calls) {
          const args = tc?.function?.arguments;
          chars += typeof args === 'string' ? args.length : JSON.stringify(args || {}).length;
          chars += (tc?.function?.name?.length || 0) + 16;
        }
      }
      if (m.images && m.images.length) {
        // Vision payloads are billed roughly per-tile, not per-character.
        chars += m.images.length * 1200 * 3;
      }
      chars += 8; // per-message role/delimiter overhead
    }
    return chars / 3;
  }

  writeLiveDialogue(type: 'USER' | 'ARCHITECT' | 'WORKER' | 'VERIFICATION', title: string, content: string) {
    try {
      const livePath = 'D:\\AntiGravity\\strata\\strata-live-session.md';
      const timeStr = new Date().toLocaleTimeString();
      let entry = '';
      if (type === 'USER') {
        entry = `\n\n---\n## 👤 User Prompt\n> **"${content}"**\n*(Architecture: Local Dual-Brain • Hardware: NVIDIA RTX 5090 • Time: ${timeStr})*\n`;
      } else if (type === 'ARCHITECT') {
        entry = `\n${content}\n`;
      } else if (type === 'WORKER') {
        if (content.startsWith('### 💻') || content.startsWith('> 🔧')) {
          entry = `\n${content}\n`;
        } else {
          entry = `\n### 💻 Local Coder Worker (RTX 5090) ➔ @Local Architect\n\n${content}\n`;
        }
      } else if (type === 'VERIFICATION') {
        entry = `\n${content}\n`;
      }
      // Asynchronous + serialized: appendFileSync blocked the Electron main
      // process (and therefore every IPC message and the whole UI) on a disk
      // write, once per worker turn and once per tool execution.
      this.liveDialogueQueue = this.liveDialogueQueue
        .then(() => fs.promises.appendFile(livePath, entry, 'utf-8'))
        .catch(() => {});
    } catch {}
  }

  private liveDialogueQueue: Promise<void> = Promise.resolve();

  resetHistory() {
    this.stop();
    this.history = [];
    this.send('agent:status', { state: 'idle' });
  }

  stop() {
    this.flushTokens();
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    for (const [, resolve] of this.pendingApprovals.entries()) {
      resolve(false);
    }
    this.pendingApprovals.clear();
    this.send('agent:status', { state: 'idle' });
  }

  resolveApproval(approvalId: string, approved: boolean) {
    const resolve = this.pendingApprovals.get(approvalId);
    if (resolve) {
      resolve(approved);
      this.pendingApprovals.delete(approvalId);
    }
  }

  /**
   * Pure Local Dual-Brain Dispatcher (zero cloud tokens / $0.00 cost)
   */
  async callGemini(
    messages: AgentMessage[],
    model: string,
    signal: AbortSignal,
    taskMode: string,
    useTools: boolean = true
  ): Promise<{ content: string; toolCalls: any[]; promptTokens: number; candidateTokens: number }> {
    const localModel = this.providerConfig.codingModel || 'Qwen3-Coder-30B-A3B-Instruct';
    const res = await this.callLocalModel(messages, localModel, signal, taskMode, undefined, useTools);
    return {
      content: res.content,
      toolCalls: res.toolCalls,
      promptTokens: 0,
      candidateTokens: 0
    };
  }

  /**
   * Direct Chat: 100% Sovereign Local Execution
   */
  async directGeminiChat(
    messages: { role: string; content: string; images?: string[] }[],
    model: string,
    abortController: AbortController,
    systemInstruction?: string,
    images?: string[]
  ): Promise<{ content: string; promptTokens: number; candidateTokens: number }> {
    const formattedMessages: AgentMessage[] = [];
    if (systemInstruction) {
      formattedMessages.push({ role: 'system', content: systemInstruction });
    }
    for (const m of messages) {
      formattedMessages.push({
        role: (m.role === 'user' ? 'user' : m.role === 'assistant' ? 'assistant' : 'system') as any,
        content: m.content,
        images: m.images
      });
    }

    if (images && images.length > 0) {
      const lastUser = formattedMessages.slice().reverse().find(m => m.role === 'user');
      if (lastUser) {
        lastUser.images = [...(lastUser.images || []), ...images];
      }
    }

    const targetModel = model || this.providerConfig.codingModel || 'Qwen3-Coder-30B-A3B-Instruct';
    const res = await this.callLocalModel(formattedMessages, targetModel, abortController.signal, 'coding', undefined, false);
    const content = res.content;
    const promptTokens = Math.max(50, Math.round(content.length / 7));
    const candidateTokens = Math.max(100, Math.round(content.length / 3.5));

    try {
      const lastUser = formattedMessages.slice().reverse().find(m => m.role === 'user');
      if (lastUser && lastUser.content) {
        this.writeLiveDialogue('USER', 'User Prompt', lastUser.content);
      }
      this.writeLiveDialogue('WORKER', `Local Model Response (${targetModel})`, `### 💻 Local Model (${targetModel}) ➔ @User\n\n${content}`);
    } catch {}

    return {
      content,
      promptTokens,
      candidateTokens
    };
  }

  /**
   * Pure Local Claude/Anthropic Compatibility Dispatcher
   */
  private async callAnthropic(
    messages: AgentMessage[],
    model: string,
    signal: AbortSignal,
    taskMode: string
  ): Promise<{ content: string; toolCalls: any[]; promptTokens: number; candidateTokens: number }> {
    const localModel = this.providerConfig.codingModel || 'Qwen3-Coder-30B-A3B-Instruct';
    const res = await this.callLocalModel(messages, localModel, signal, taskMode, undefined, true);
    return {
      content: res.content,
      toolCalls: res.toolCalls,
      promptTokens: 0,
      candidateTokens: 0
    };
  }

  /**
   * OpenAI / DeepSeek / OpenRouter compatible API caller
   */

  // =========================================================================
  // LOCAL ENGINE ARBITER
  //
  // llama-server (port 8080) and Ollama (port 11434) BOTH fully offload to the
  // same 32 GB of VRAM. Qwen3-Coder Q6_K is ~22 GB resident; qwen3.8:27b is
  // ~17 GB and qwen2.5-coder:32b is ~20 GB. Any two of them oversubscribe the
  // card.
  //
  // On Windows this does not fail cleanly. The NVIDIA driver spills the excess
  // into shared system memory over PCIe and generation collapses from ~200 tok/s
  // to low single digits, with no error anywhere - it just looks like a hang.
  // That is worse than an OOM, because nothing in the app can detect it.
  //
  // So: before any local turn, ask what is already resident and route to the
  // engine that is already holding its weights, rather than forcing a second
  // model into a card that cannot hold it.
  // =========================================================================
  private static readonly ENGINE_PROBE_TTL_MS = 10000;
  private engineStatus: LocalEngineStatus | null = null;
  private engineProbeInFlight: Promise<LocalEngineStatus> | null = null;
  private ollamaSizeCache: Map<string, number> | null = null;
  private serverAliasLower: string | null = null;

  /** Secret for the local llama-server. Never an upstream cloud key. */
  private localApiKey(): string {
    return this.providerConfig.localServerApiKey || 'strata-local';
  }

  private get localServerBase(): string {
    return (this.providerConfig.openaiBaseUrl || 'http://127.0.0.1:8080/v1').replace(/\/v1\/?$/, '');
  }

  private async fetchJson(url: string, timeoutMs = 1500, headers?: Record<string, string>): Promise<any | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private readGpuMemory(): Promise<{ totalMiB: number; usedMiB: number; freeMiB: number } | undefined> {
    return new Promise((resolve) => {
      try {
        execFile(
          'nvidia-smi',
          ['--query-gpu=memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
          { timeout: 2000, windowsHide: true },
          (err: any, stdout: any) => {
            if (err || !stdout) return resolve(undefined);
            // First line = first GPU.
            const parts = String(stdout).trim().split('\n')[0].split(',').map(v => parseInt(v.trim(), 10));
            if (parts.length < 3 || parts.some(v => !Number.isFinite(v))) return resolve(undefined);
            resolve({ totalMiB: parts[0], usedMiB: parts[1], freeMiB: parts[2] });
          }
        );
      } catch {
        resolve(undefined);
      }
    });
  }

  /** Snapshot of both local engines. Cached briefly so a tool-heavy turn does not re-probe per call. */
  async probeLocalEngines(force = false): Promise<LocalEngineStatus> {
    const now = Date.now();
    if (!force && this.engineStatus && now - this.engineStatus.checkedAt < AgentEngine.ENGINE_PROBE_TTL_MS) {
      return this.engineStatus;
    }
    if (this.engineProbeInFlight) return this.engineProbeInFlight;

    const probe = (async (): Promise<LocalEngineStatus> => {
      const status: LocalEngineStatus = {
        checkedAt: Date.now(),
        llamaServer: { up: false },
        ollamaLoaded: []
      };

      const [props, ps, gpu, serverProcess] = await Promise.all([
        this.fetchJson(`${this.localServerBase}/props`, 1500, { Authorization: `Bearer ${this.localApiKey()}` }),
        this.fetchJson('http://127.0.0.1:11434/api/ps'),
        this.readGpuMemory(),
        this.llamaServerProcessExists()
      ]);

      // A llama-server that is still loading its model does not answer /props,
      // but it already owns most of the card. Treating "not answering" as
      // "nothing resident" is how a 27B Ollama model got loaded on top of a
      // half-loaded 23 GB coder and froze the desktop. The "just launched"
      // window covers the seconds between spawning the launch script and the
      // process becoming visible - a prompt sent right after app start used
      // to slip through that gap.
      if (!props && (serverProcess || Date.now() < this.coderStartingUntil)) {
        status.llamaServer.loading = true;
      }

      if (props) {
        status.llamaServer.up = true;
        const nCtx = props?.default_generation_settings?.n_ctx ?? props?.n_ctx;
        if (typeof nCtx === 'number') status.llamaServer.nCtx = nCtx;
        const alias = props?.model_alias || props?.default_generation_settings?.model
          || (props?.model_path ? String(props.model_path).split(/[\\/]/).pop() : undefined);
        if (alias) {
          status.llamaServer.alias = String(alias);
          this.serverAliasLower = String(alias).toLowerCase();
        }
      }

      if (ps && Array.isArray(ps.models)) {
        status.ollamaLoaded = ps.models.map((m: any) => ({
          name: String(m.name || m.model || ''),
          vramBytes: Number(m.size_vram || 0)
        })).filter((m: any) => m.name);
      }

      status.gpu = gpu;
      this.engineStatus = status;
      return status;
    })();

    this.engineProbeInFlight = probe;
    try {
      return await probe;
    } finally {
      this.engineProbeInFlight = null;
    }
  }

  /** Until this time the coder server is assumed to be loading even if its process is not visible yet. */
  private coderStartingUntil = 0;
  markCoderServerStarting(graceMs = 90000) {
    this.coderStartingUntil = Date.now() + graceMs;
    this.engineStatus = null; // force the next probe to see it
  }

  /** True when a llama-server process is running on this machine (answering or not). */
  private llamaServerProcessExists(): Promise<boolean> {
    if (process.platform !== 'win32') return Promise.resolve(false);
    return new Promise((resolve) => {
      try {
        execFile('tasklist', ['/FI', 'IMAGENAME eq llama-server.exe', '/NH'], { timeout: 2500, windowsHide: true }, (err: any, stdout: any) => {
          resolve(!err && /llama-server\.exe/i.test(String(stdout || '')));
        });
      } catch {
        resolve(false);
      }
    });
  }

  /** Polls /props until the coder server answers or the deadline passes. Returns true when it is up. */
  async waitForLlamaServer(maxMs: number, onTick?: (elapsedMs: number) => void): Promise<boolean> {
    const started = Date.now();
    while (Date.now() - started < maxMs) {
      const status = await this.probeLocalEngines(true);
      if (status.llamaServer.up) return true;
      if (!status.llamaServer.loading) return false; // process gone - it died or was never there
      if (onTick) onTick(Date.now() - started);
      await new Promise(r => setTimeout(r, 3000));
    }
    return false;
  }

  /** Approximate VRAM an Ollama model needs, from its on-disk size plus KV/compute overhead. */
  private async estimateOllamaVramMiB(model: string): Promise<number | undefined> {
    if (!this.ollamaSizeCache) {
      const tags = await this.fetchJson('http://127.0.0.1:11434/api/tags', 2500);
      if (!tags || !Array.isArray(tags.models)) return undefined;
      this.ollamaSizeCache = new Map<string, number>();
      for (const m of tags.models) {
        const name = String(m.name || m.model || '').toLowerCase();
        if (name && typeof m.size === 'number') this.ollamaSizeCache.set(name, m.size);
      }
    }
    const bytes = this.ollamaSizeCache.get(model.toLowerCase());
    if (!bytes) return undefined;
    // Weights + ~1.5 GB for KV cache at 16K ctx and compute buffers.
    return Math.round((bytes / (1024 * 1024)) * 1.02) + 1536;
  }

  /** Ask Ollama to evict its loaded models immediately (keep_alive: 0). */
  async releaseOllamaVram(): Promise<string[]> {
    const status = await this.probeLocalEngines(true);
    const freed: string[] = [];
    for (const loaded of status.ollamaLoaded) {
      if (!loaded.vramBytes) continue;
      try {
        await fetch('http://127.0.0.1:11434/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: loaded.name, keep_alive: 0 })
        });
        freed.push(loaded.name);
      } catch {
        // Ollama offline or already unloaded - nothing to free.
      }
    }
    if (freed.length) {
      this.engineStatus = null; // force a re-probe next time
      console.log(`[VRAM Arbiter] Evicted from Ollama: ${freed.join(', ')}`);
    }
    return freed;
  }

  /**
   * Picks the local engine for this turn based on what is already resident.
   * Returns the model to actually use, plus a human-readable notice when the
   * choice differs from what was requested.
   */
  async resolveLocalWorker(preferredModel: string): Promise<{ model: string; notice?: string }> {
    if (this.providerConfig.disableVramArbiter) return { model: preferredModel };

    let status = await this.probeLocalEngines();
    const wantsServer = this.isPort8080Model(preferredModel);

    // Case 0: the coder server is mid-load. It owns the card already; the only
    // safe move is to wait for it - never to load anything else beside it.
    if (!status.llamaServer.up && status.llamaServer.loading) {
      const cameUp = await this.waitForLlamaServer(90000);
      status = await this.probeLocalEngines(true);
      if (!cameUp && !status.llamaServer.up) {
        throw new Error('The llama-server on port 8080 has been loading for over 90 seconds and is still not answering. It may be stuck (VRAM spilled into system RAM). Stop it with C:\\AI_dev\\llama.cpp\\stop-server-8080.bat and start it again, then retry.');
      }
      const serverModel = status.llamaServer.alias || 'Qwen3-Coder-30B-A3B-Instruct';
      if (!wantsServer) {
        return {
          model: serverModel,
          notice: `The coder server was still loading when this turn started, so the turn waited for it and is using **${serverModel}** instead of loading **${preferredModel}** beside it.`
        };
      }
    }

    // Case A: the request already targets llama-server.
    if (wantsServer) {
      if (status.llamaServer.up) {
        // If Ollama is squatting on VRAM it does not need, reclaim it.
        const ollamaVramMiB = status.ollamaLoaded.reduce((a, m) => a + m.vramBytes, 0) / (1024 * 1024);
        if (ollamaVramMiB > 512 && status.gpu && status.gpu.freeMiB < 2048) {
          const freed = await this.releaseOllamaVram();
          if (freed.length) {
            return {
              model: preferredModel,
              notice: `Freed ~${Math.round(ollamaVramMiB / 1024)} GB of VRAM by unloading ${freed.join(', ')} from Ollama so the coder model has room.`
            };
          }
        }
        return { model: preferredModel };
      }
      return { model: preferredModel }; // server down; callOpenAICompatible reports it properly
    }

    // Case B: an Ollama model was requested.
    const alreadyLoaded = status.ollamaLoaded.some(m => m.name.toLowerCase() === preferredModel.toLowerCase());
    if (alreadyLoaded) return { model: preferredModel }; // already resident and working

    const needMiB = await this.estimateOllamaVramMiB(preferredModel);
    const freeMiB = status.gpu?.freeMiB;

    if (!status.llamaServer.up) {
      // Nothing of ours to collide with - but something else (a game, a
      // renderer, another app) may be holding the card. Ollama then offloads
      // layers to the CPU, which is slow and stutters the desktop. Warn once.
      if (typeof needMiB === 'number' && typeof freeMiB === 'number' && needMiB > freeMiB) {
        return {
          model: preferredModel,
          notice: `${preferredModel} needs ~${(needMiB / 1024).toFixed(1)} GB of VRAM but only ${(freeMiB / 1024).toFixed(1)} GB is free (another process is using the GPU). Ollama will offload part of the model to the CPU, which is much slower and can stutter the desktop. Close the other GPU workload or pick a smaller model.`
        };
      }
      return { model: preferredModel };
    }

    const serverModel = status.llamaServer.alias || 'Qwen3-Coder-30B-A3B-Instruct';

    // Reroute when we know it will not fit, or when we cannot measure and
    // llama-server is holding the card (the common case on this machine).
    const wontFit = typeof needMiB === 'number' && typeof freeMiB === 'number' && needMiB > freeMiB - 768;
    const cannotMeasure = typeof freeMiB !== 'number';

    if (wontFit || cannotMeasure) {
      const detail = wontFit
        ? `needs ~${(needMiB! / 1024).toFixed(1)} GB, only ${(freeMiB! / 1024).toFixed(1)} GB free`
        : `llama-server is resident and free VRAM could not be measured`;
      return {
        model: serverModel,
        notice: `Routed to the already-loaded **${serverModel}** on llama-server instead of **${preferredModel}** (${detail}). Loading both would spill into shared system memory and drop generation to a few tokens/sec. Stop the port-8080 server if you specifically want ${preferredModel}.`
      };
    }

    return { model: preferredModel };
  }

  // =========================================================================
  // CLOUD ARCHITECT PROVIDER
  //
  // The hybrid architect used to be hardwired to Gemini in four separate places
  // (blueprint, verification, stall re-plan, direct chat), each with its own
  // inline `isRealGoogleApiKey` check. Everything now goes through one entry
  // point so the architect can be Claude or Gemini interchangeably.
  // =========================================================================

  /** True when per-token APIs are permitted. */
  paidApisAllowed(): boolean {
    return this.providerConfig.allowPaidApis === true;
  }

  /**
   * Refuses a metered call before it reaches the network.
   */
  private assertPaidAllowed(_provider: string) {
    if (this.paidApisAllowed()) return;
    throw new Error(
      `PAID_API_BLOCKED: Pure Local mode is active ($0.00 cost). Paid APIs are disabled.`
    );
  }

  /** Which service backs an architect model id. Always local. */
  architectProviderFor(_modelId?: string): ArchitectProvider {
    return 'local';
  }

  /**
   * The model that plays the architect when running local dual-brain mode.
   * Defaults to generalModel (qwen3.8:27b).
   */
  localArchitectModel(_workerModel?: string): string {
    return this.providerConfig.generalModel
      || this.providerConfig.hybridArchitectModel
      || 'qwen3.8:27b';
  }

  /** The architect model actually in effect. */
  architectModelId(): string {
    return this.providerConfig.hybridArchitectModel
      || this.providerConfig.generalModel
      || 'qwen3.8:27b';
  }

  /** Human-facing name for the architect, used in transcript labels. */
  architectLabel(modelId?: string): string {
    const id = modelId || this.architectModelId();
    return `Local Architect (${id} • RTX 5090)`;
  }

  /** True when the local architect is available (always true). */
  hasArchitectKey(_modelId?: string): boolean {
    return true;
  }

  /** Single entry point for every architect call. */
  private async callArchitect(
    messages: AgentMessage[],
    model: string,
    signal: AbortSignal,
    taskMode: string,
    localFallbackModel?: string
  ): Promise<{ content: string; promptTokens: number; candidateTokens: number; provider: ArchitectProvider }> {
    const targetModel = (model && model !== 'local') ? model : this.localArchitectModel(localFallbackModel);
    // useTools=false: the architect writes a blueprint, it does not execute tools directly.
    const res = await this.callLocalModel(
      messages,
      targetModel,
      signal,
      taskMode,
      undefined,
      false
    );
    return { content: res.content, promptTokens: 0, candidateTokens: 0, provider: 'local' };
  }

  private recordArchitectUsage(
    _provider: ArchitectProvider,
    _promptTokens: number,
    _candidateTokens: number,
    _modelName?: string
  ) {
    // Pure local mode
  }

  /**
   * Architect models offered in the dual-brain picker (100% local).
   */
  async listArchitectModels(): Promise<ArchitectModelOption[]> {
    return AgentEngine.STATIC_ARCHITECT_MODELS.map(m => ({ ...m }));
  }

  static EXCLUDED_ARCHITECT_MODELS = ['fable'];

  static STATIC_ARCHITECT_MODELS: ArchitectModelOption[] = [
    { id: 'qwen3.8:27b', name: 'Qwen 3.8 (27B) — General Architect (Ollama)', provider: 'local', live: true },
    { id: 'deepseek-r1:32b', name: 'DeepSeek R1 (32B Reasoning)', provider: 'local', live: true },
    { id: 'Qwen3-Coder-30B-A3B-Instruct', name: 'Qwen3-Coder (30B) — Specialist Coder (Port 8080)', provider: 'local', live: true }
  ];

  // =========================================================================
  // HYBRID INTELLIGENCE
  //
  // Hybrid mode used to call the cloud architect on EVERY run at a fixed,
  // user-set tier, plan before anything had looked at the workspace, track quota
  // percentages it never consulted, and throw away its own stall detection.
  // This layer makes those four decisions instead of hardcoding them - all of it
  // from local heuristics, so classification itself costs nothing.
  // =========================================================================

  /**
   * Scores a request's complexity from the prompt and editor state alone.
   * No model call: this runs before we decide whether a model call is warranted.
   */
  classifyTask(prompt: string, editorContext?: EditorContext, taskMode: string = 'coding'): TaskClassification {
    const p = (prompt || '').trim();
    const lower = p.toLowerCase();
    const signals: string[] = [];
    let score = 30; // neutral baseline

    const words = p.split(/\s+/).filter(Boolean).length;
    if (words <= 8) { score -= 12; signals.push('very short request'); }
    else if (words <= 25) { score -= 4; }
    else if (words > 80) { score += 12; signals.push('long, detailed request'); }
    else if (words > 45) { score += 6; }

    if (/\b(rename|renaming|typo|re-?format|reformatting|formatting|run (prettier|eslint|the linter)|prettier|semicolons?|add (a )?comment|comment out|uncomment|bump (the )?version|change (the )?(colou?r|string|text|label|title)|remove (the )?console\.log|delete (the )?(line|import)|add (an? )?import|capitali[sz]e|spelling|re-?indent)\b/.test(lower)) {
      score -= 25; signals.push('mechanical edit');
    }

    if (/\b(what does|what is|explain|describe|summari[sz]e|walk me through|how does .{0,40}work|show me|list the|where is)\b/.test(lower)) {
      score -= 15; signals.push('explanatory / read-only');
    }

    if (/\b(architect|architecture|refactor|redesign|re-?write|migrate|migration|restructure|decouple|abstraction|design pattern|end-?to-?end|pipeline|integrate|integration|scaffold|from scratch|whole (app|project|codebase)|across (the )?(app|project|codebase|files)|all (the )?files|multi-?file|inspect|review|audit|critique|improve|improvements?|analyze|assessment)\b/.test(lower)) {
      score += 28; signals.push('architectural scope');
    }

    if (/\b(implement|build|create|introduce|support for|add (an? )?([\w-]+ )?(feature|system|module|component|service|endpoint|panel|screen|view|tab))\b/.test(lower)) {
      score += 14; signals.push('new implementation');
    }

    // Naming a subsystem is a strong complexity tell independent of the verb.
    if (/\b(system|framework|engine|protocol|runtime|scheduler|loader|parser|compiler|pipeline|plugin|abstraction)\b/.test(lower)) {
      score += 12; signals.push('subsystem-level noun');
    }

    // Several comma-separated deliverables in one request.
    if ((p.match(/,/g) || []).length >= 2) { score += 6; signals.push('multiple deliverables'); }

    if (/\b(bug|broken|failing|fails|crash(es|ing)?|error|exception|stack ?trace|regression|not working|doesn'?t work|why (is|does|isn'?t))\b/.test(lower)) {
      score += 12; signals.push('debugging / investigation');
    }
    if (/\bat [\w$.]+ \(.*:\d+:\d+\)/.test(p) || /Traceback \(most recent call last\)/.test(p)) {
      score += 10; signals.push('stack trace supplied');
    }

    if (/\b(somehow|figure out|best way|what'?s the best|should i|trade-?offs?|recommend|not sure|any ideas|options for)\b/.test(lower)) {
      score += 16; signals.push('open-ended / needs judgment');
    }

    const numbered = (p.match(/^\s*\d+[.)]\s+/gm) || []).length;
    if (numbered >= 4) { score += 20; signals.push(`${numbered} enumerated steps`); }
    else if (numbered === 3) { score += 14; signals.push('3 enumerated steps'); }
    else if (numbered === 2) { score += 6; }
    if (/\b(then|after that|and also|finally|next,|followed by)\b/.test(lower)) {
      score += 6; signals.push('sequential steps');
    }

    const fileRefs = new Set(
      (p.match(/[\w\-./\\]+\.(tsx?|jsx?|json|css|html?|py|ps1|bat|md|ya?ml|rs|go|java|cs)\b/gi) || [])
        .map(f => f.toLowerCase())
    );
    if (fileRefs.size >= 3) { score += 16; signals.push(`${fileRefs.size} files referenced`); }
    else if (fileRefs.size === 1) { score -= 6; signals.push('single file referenced'); }

    if (/\b(this (file|function|line|selection|component|method)|selected|highlighted)\b/.test(lower) && editorContext?.activeFile) {
      score -= 12; signals.push('scoped to active editor');
    }

    if (taskMode === 'general') score -= 6;

    score = Math.max(0, Math.min(100, Math.round(score)));
    const band: HybridBand =
      score < 22 ? 'trivial' :
      score <= 45 ? 'moderate' :
      score <= 72 ? 'complex' : 'deep';

    return { score, band, signals };
  }

  /**
   * Pure Local Dual-Brain Router:
   * Coordinates Brain 1 (General Architect) and Brain 2 (Coder Worker)
   * with zero cloud tokens and $0.00 cost on RTX 5090.
   */
  planHybridRun(
    prompt: string,
    editorContext: EditorContext | undefined,
    taskMode: string,
    userTier: 'low' | 'medium' | 'high',
    _architectProvider: ArchitectProvider = 'local'
  ): HybridPlan {
    const classification = this.classifyTask(prompt, editorContext, taskMode);
    const band = classification.band;
    const reasons: string[] = [];

    const p = (prompt || '').trim();
    const words = p.split(/\s+/).filter(Boolean).length;
    const isSingleWordAck = words <= 2 && /^(ok|okay|yes|yep|sure|continue|proceed|go ahead|thanks|thank you|no|nope)$/i.test(p);
    // A question gets a direct answer, not a blueprint. Sending "does this
    // hybrid mode work" to the architect produced a prose reply, which the
    // engine then treated as a failed plan and retried.
    const editVerb = /\b(fix|implement|add|create|write|refactor|update|change|remove|delete|rename|build|make|generate|design|migrate|convert|replace|move|extract|introduce|set up|setup|install|configure|optimi[sz]e|rework|improve)\b/i.test(p);
    const isQuestion = (/\?\s*$/.test(p) || /^(does|do|is|are|can|could|should|will|would|what|which|why|how|where|when|who|explain|describe|tell me|summari[sz]e|what's|whats|show me)\b/i.test(p)) && !editVerb;
    const advisory = isAdvisoryRequest(p);
    const direct = isSingleWordAck || isQuestion || advisory || band === 'trivial';
    const useArchitect = !direct;
    const tier = userTier;
    if (isQuestion) reasons.push('question - direct answer, no blueprint');
    else if (advisory) reasons.push('analysis request - inspect and answer in chat, no file changes');
    else if (band === 'trivial' && !isSingleWordAck) reasons.push('mechanical task - direct worker');

    const head = useArchitect
      ? `${band} task (score ${classification.score}) - Local Dual-Brain Architect (RTX 5090 • $0.00)`
      : `${band} task (score ${classification.score}) - direct local coder execution`;

    return {
      band,
      useArchitect,
      tier,
      escalateOnStall: true,
      quotaDemoted: false,
      reason: reasons.length ? `${head}; ${reasons.join(', ')}` : head,
      classification
    };
  }

  /** Cheap structural outline of a source file - declarations only, never the body. */
  private outlineSource(content: string, maxLines = 60): string {
    return outlineSourceText(content, maxLines);
  }

  /**
   * Real workspace facts for the architect, gathered locally.
   *
   * The architect used to plan blind and invent plausible-looking file paths,
   * which the worker then burned turns discovering were wrong. This costs zero
   * cloud tokens and is the single highest-leverage input to blueprint quality.
   */
  private async buildWorkspaceGrounding(
    editorContext?: EditorContext,
    extras: { profile?: ProjectProfile; retrievalBlock?: string } = {}
  ): Promise<string> {
    const parts: string[] = [];

    if (extras.profile && extras.profile.summary) {
      parts.push(`PROJECT PROFILE: ${extras.profile.summary}`);
    }

    try {
      const listing = await this.tools.listFiles('.', 2);
      if (listing.success && listing.output) {
        const lines = listing.output.split('\n');
        const shown = lines.length > 160
          ? [...lines.slice(0, 150), `... [${lines.length - 150} more entries omitted]`]
          : lines;
        parts.push(`WORKSPACE TREE (depth 2, rooted at "${this.workspaceDir}"):\n${shown.join('\n')}`);
      }
    } catch {
      // Listing is best-effort; a blind plan is still better than no plan.
    }

    if (editorContext?.activeFile && editorContext.activeFileContent) {
      const outline = this.outlineSource(editorContext.activeFileContent);
      if (outline) {
        parts.push(`DECLARATION OUTLINE OF THE ACTIVE FILE (${editorContext.activeFile}):\n${outline}`);
      }
    }

    if (editorContext?.openTabs && editorContext.openTabs.length > 0) {
      parts.push(`OPEN EDITOR TABS: ${editorContext.openTabs.map(t => t.path || t.name).join(', ')}`);
    }

    if (extras.retrievalBlock) {
      parts.push(extras.retrievalBlock);
    }

    if (parts.length === 0) return '';

    return `[WORKSPACE GROUND TRUTH - read from disk locally at zero cloud cost]
Use these REAL paths. Do not invent file names or guess at project layout; everything you need to reference is below.

${parts.join('\n\n')}`;
  }

  /**
   * Helper: checks if a model name targets the local llama-server on Port 8080
   */
  isPort8080Model(modelName?: string): boolean {
    if (!modelName) return false;
    const m = modelName.toLowerCase();
    // Match the server's live alias too, so a renamed model still routes correctly.
    if (this.serverAliasLower && m === this.serverAliasLower) return true;
    return m.includes('qwen3-coder') || m.includes('8080') || m.includes('coder-30b');
  }

  /**
   * Universal Local Model Dispatcher:
   * Routes Qwen3-Coder to llama-server on Port 8080 (237 tok/s)
   * Routes qwen3.8:27b and others to Ollama on Port 11434
   */
  async callLocalModel(
    messages: AgentMessage[],
    model: string,
    signal: AbortSignal,
    taskMode: string,
    onToken?: (token: string) => void,
    useTools: boolean = true,
    extra: { think?: boolean } = {}
  ): Promise<{ content: string; toolCalls: any[]; streamed: boolean }> {
    if (this.isPort8080Model(model)) {
      return this.callOpenAICompatible(messages, model, signal, 'openai', taskMode, onToken, useTools);
    }
    return this.callOllama(messages, model, signal, taskMode, onToken, useTools, extra);
  }

  /** Whether an Ollama model advertises the `thinking` capability. Cached per model. */
  private thinkingCapability = new Map<string, boolean>();
  private async ollamaSupportsThinking(model: string): Promise<boolean> {
    const key = (model || '').toLowerCase();
    if (!key) return false;
    const cached = this.thinkingCapability.get(key);
    if (typeof cached === 'boolean') return cached;
    let supports = false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch('http://127.0.0.1:11434/api/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
        signal: controller.signal
      });
      clearTimeout(timer);
      if (res.ok) {
        const data: any = await res.json();
        supports = Array.isArray(data?.capabilities) && data.capabilities.includes('thinking');
      }
    } catch {
      supports = false;
    }
    this.thinkingCapability.set(key, supports);
    return supports;
  }

  /** Project facts (language, verify commands) - cached until package.json or the workspace changes. */
  private profileCache: { key: string; profile: ProjectProfile } | null = null;
  getProjectProfile(): ProjectProfile {
    let mtime = 0;
    try {
      const pkg = path.join(this.workspaceDir, 'package.json');
      if (fs.existsSync(pkg)) mtime = fs.statSync(pkg).mtimeMs;
    } catch {}
    const key = `${this.workspaceDir}|${mtime}`;
    if (this.profileCache && this.profileCache.key === key) return this.profileCache.profile;
    const profile = buildProjectProfile(this.workspaceDir);
    this.profileCache = { key, profile };
    return profile;
  }

  /**
   * OpenAI / DeepSeek / OpenRouter / Port 8080 llama-server compatible API caller
   */
  private async callOpenAICompatible(
    messages: AgentMessage[],
    model: string,
    signal: AbortSignal,
    _provider: string = 'openai',
    taskMode: string = 'coding',
    onToken?: (token: string) => void,
    useTools: boolean = true,
    retryAttempt: boolean = false
  ): Promise<{ content: string; toolCalls: any[]; streamed: boolean }> {
    const is8080 = true;
    const provider = 'llama-server';
    const endpoint = `${this.providerConfig.openaiBaseUrl || 'http://127.0.0.1:8080/v1'}/chat/completions`;
    const apiKey = this.localApiKey();
    const actualModel = 'Qwen3-Coder-30B-A3B-Instruct';

    const maxTokensBudget = await this.getLocalContextBudget(endpoint);
    const safeMessages = this.getPrunedHistory(messages, maxTokensBudget);

    // Sanitize message sequence: convert Architect directives from assistant to user instruction
    const formattedMessages: any[] = [];
    for (const m of safeMessages) {
      let role = m.role;
      let content = m.content || '';
      const hasToolCalls = (m.tool_calls && m.tool_calls.length > 0) || ((m as any).toolCalls && (m as any).toolCalls.length > 0);

      // Legacy blueprints were stored as assistant turns; new ones are pushed as
      // user directives directly (see run()), so only the old header shape is
      // re-roled. Matching on loose phrases like "Local Architect" used to
      // catch the architect's *verification* message too and turn it into a
      // fresh directive on the next run.
      if (role === 'assistant' && !hasToolCalls && content.startsWith('### 🧠 Local Architect (Brain 1')) {
        role = 'user';
        content = `[LEAD ARCHITECT DIRECTIVE (Brain 1 • General Model)]:\n${content}\n\n[MANDATORY WORKER EXECUTION INSTRUCTION]:\nYou are the Autonomous Implementation Worker running locally on this NVIDIA RTX 5090 workstation.\nImmediately execute the architectural blueprint above by calling workspace tools (search_codebase, read_file, write_file, edit_file, run_command, list_files). Do NOT echo or repeat the blueprint. Do NOT output conversational pleasantries. Directly invoke the required tool.`;
      }

      if (m.role === 'user' && m.images && m.images.length > 0) {
        const parts: any[] = [];
        if (content) parts.push({ type: 'text', text: content });
        for (const img of m.images) {
          const url = img.startsWith('data:') ? img : `data:image/png;base64,${img}`;
          parts.push({ type: 'image_url', image_url: { url } });
        }
        formattedMessages.push({ role, content: parts });
        continue;
      }

      const msgObj: any = { role, content };
      if (m.role === 'tool') {
        msgObj.tool_call_id = m.tool_call_id;
      }
      if (hasToolCalls) {
        msgObj.tool_calls = (m.tool_calls || (m as any).toolCalls).map((tc: any) => ({
          id: tc.id || `call_${Date.now()}`,
          type: 'function',
          function: {
            name: tc.function?.name || '',
            arguments: typeof tc.function?.arguments === 'string'
              ? tc.function.arguments
              : JSON.stringify(tc.function?.arguments || {})
          }
        }));
      }
      formattedMessages.push(msgObj);
    }

    // Prevent assistant echo trap: ensure history does NOT end on an assistant turn
    const lastMsg = formattedMessages[formattedMessages.length - 1];
    if (lastMsg && lastMsg.role === 'assistant' && !lastMsg.tool_calls) {
      formattedMessages.push({
        role: 'user',
        content: 'Please proceed with inspecting the workspace and implementing the required tasks.'
      });
    }

    const wantsStream = Boolean(onToken);
    const payload: any = {
      model: is8080 ? 'Qwen3-Coder-30B-A3B-Instruct' : (model && !model.includes(':') ? model : actualModel),
      messages: formattedMessages,
      temperature: taskMode === 'general' ? 0.7 : 0.2,
      stream: wantsStream
    };

    if (is8080) {
      // Qwen3-Coder-30B-A3B model-card sampling. Running an MoE coder at temp 0.2
      // with no top_k bound is the classic recipe for repetition/echo loops - the
      // exact failure the architect-directive sanitizer was working around.
      payload.temperature = taskMode === 'general' ? 0.7 : 0.7;
      payload.top_p = 0.8;
      payload.top_k = 20;
      payload.repetition_penalty = 1.05;
      // Hard cap so one runaway generation cannot eat the whole context window.
      // Planning/review calls (no tools) never need more than ~3K.
      payload.max_tokens = useTools ? 8192 : 3072;
    }

    if (useTools) {
      payload.tools = OLLAMA_TOOLS;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal
    });

    if (res.status === 429) {
      throw new Error(`QUOTA_EXCEEDED: ${provider.toUpperCase()} quota or rate limit exceeded.`);
    }

    if (!res.ok) {
      const errText = await res.text();
      // Auto-healing for exceed_context_size_error:
      const looksLikeContextOverflow =
        errText.includes('exceed_context_size_error') ||
        errText.includes('exceeds the available context size') ||
        errText.includes('context size') ||
        errText.includes('n_ctx') ||
        errText.includes('too large') ||
        res.status === 413;
      // A 400 that is NOT about context (bad tool schema, malformed message
      // sequence) used to be retried as if it were, masking the real error.
      const isRetryableStatus = res.status === 400 || res.status === 413 || res.status === 500;
      if (!retryAttempt && isRetryableStatus && (looksLikeContextOverflow || res.status === 400)) {
        console.warn(`[Context Guard] Context limit exceeded on ${endpoint} (${res.status}). Aggressively pruning history to 12000 tokens and retrying...`);
        const emergencyCompacted = this.getPrunedHistory(messages, 12000);
        return this.callOpenAICompatible(emergencyCompacted, model, signal, provider, taskMode, onToken, useTools, true);
      }
      throw new Error(`${provider.toUpperCase()} API Error (${res.status}): ${errText}`);
    }

    if (wantsStream && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedContent = '';
      const toolCallsMap = new Map<number, { id: string; name: string; args: string }>();
      let streamedAny = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;
          if (trimmed === 'data: [DONE]') continue;
          if (!trimmed.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(trimmed.substring(6));
            const choice = data.choices?.[0];
            const delta = choice?.delta;
            if (!delta) continue;

            if (delta.content) {
              streamedContent += delta.content;
              if (onToken) {
                onToken(delta.content);
                streamedAny = true;
              }
            }

            if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, {
                    id: tc.id || `call_${Date.now()}_${idx}`,
                    name: tc.function?.name || '',
                    args: tc.function?.arguments || ''
                  });
                } else {
                  const existing = toolCallsMap.get(idx)!;
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.args += tc.function.arguments;
                }
              }
            }
          } catch {}
        }
      }

      const parsedToolCalls: any[] = [];
      for (const [, item] of toolCallsMap) {
        let argsObj = {};
        try {
          argsObj = item.args ? JSON.parse(item.args) : {};
        } catch {
          argsObj = { raw: item.args };
        }
        parsedToolCalls.push({
          id: item.id,
          type: 'function',
          function: {
            name: item.name,
            arguments: argsObj
          }
        });
      }

      // Recover calls the server left in the text (<tool_call> XML / JSON fence).
      // Without --jinja, or with an odd template, llama-server emits them as
      // content and the structured field stays empty - which ended the run.
      let finalStreamed = streamedContent;
      if (parsedToolCalls.length === 0 && finalStreamed) {
        const embedded = extractEmbeddedToolCalls(finalStreamed);
        if (embedded.calls.length) {
          parsedToolCalls.push(...embedded.calls);
          finalStreamed = embedded.stripped;
        }
      }

      return {
        content: finalStreamed,
        toolCalls: parsedToolCalls,
        streamed: streamedAny
      };
    }

    // Non-streaming fallback
    const data: any = await res.json();
    const choice = data.choices?.[0];
    const msg = choice?.message;
    if (!msg) {
      throw new Error('Received empty response from API provider.');
    }

    if (msg.reasoning_content) {
      this.send('agent:thought', { thought: msg.reasoning_content });
    }

    let finalContent = msg.content || '';
    const thinkMatch = finalContent.match(/<(?:think|thought)>([\s\S]*?)<\/(?:think|thought)>/);
    if (thinkMatch) {
      this.send('agent:thought', { thought: thinkMatch[1].trim() });
      finalContent = finalContent.replace(/<(?:think|thought)>[\s\S]*?<\/(?:think|thought)>/, '').trim();
    }

    let finalToolCalls: any[] = msg.tool_calls || [];
    if (finalToolCalls.length === 0 && finalContent) {
      const embedded = extractEmbeddedToolCalls(finalContent);
      if (embedded.calls.length) {
        finalToolCalls = embedded.calls;
        finalContent = embedded.stripped;
      }
    }

    return {
      content: finalContent,
      toolCalls: finalToolCalls,
      streamed: false
    };
  }

  /**
   * Reads the real context window from llama-server's /props endpoint and reserves
   * ~65% of it for prompt history (the rest covers generation plus template
   * overhead). Cached for the life of the process; falls back to the old 22,000
   * budget if the server does not answer.
   */
  private localContextBudget: number | null = null;
  private async getLocalContextBudget(endpoint: string): Promise<number> {
    if (this.localContextBudget !== null) return this.localContextBudget;
    try {
      const base = endpoint.replace(/\/v1\/chat\/completions$/, '').replace(/\/chat\/completions$/, '');
      // Probe loopback only. `openaiBaseUrl` is user-settable, so without this a
      // remote base would receive an unsolicited authenticated request from a
      // routine context-window probe.
      if (!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/i.test(base)) {
        this.localContextBudget = 22000;
        return this.localContextBudget;
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${base}/props`, {
        signal: controller.signal,
        headers: { Authorization: `Bearer ${this.localApiKey()}` }
      });
      clearTimeout(timer);
      if (res.ok) {
        const props: any = await res.json();
        const nCtx = props?.default_generation_settings?.n_ctx ?? props?.n_ctx;
        if (typeof nCtx === 'number' && nCtx > 4096) {
          this.localContextBudget = Math.floor(nCtx * 0.65);
          console.log(`[Context Guard] llama-server n_ctx=${nCtx}; prompt budget set to ${this.localContextBudget} tokens.`);
          return this.localContextBudget;
        }
      }
    } catch {
      // Server offline or older build without /props - fall through to the default.
    }
    this.localContextBudget = 22000;
    return this.localContextBudget;
  }

  /**
   * Intelligently compacts conversation history so that local models (llama-server or Ollama)
   * never overflow their context window budget (32K on Port 8080, 8K/16K on Ollama).
   */
  private getPrunedHistory(messages: AgentMessage[], maxTokensBudget: number = 22000): AgentMessage[] {
    if (!messages || messages.length <= 1) return messages;

    const estimateTokens = (msgs: AgentMessage[]) => this.estimateMessageTokens(msgs);

    let currentTokens = estimateTokens(messages);
    if (currentTokens <= maxTokensBudget) return messages;

    // Deep clone to avoid mutating canonical this.history
    const pruned: AgentMessage[] = JSON.parse(JSON.stringify(messages));

    // Identify system and latest user message
    const systemMsg = pruned[0]?.role === 'system' ? pruned[0] : { role: 'system' as const, content: 'You are Strata Code assistant.' };
    const firstUserIdx = pruned.findIndex(m => m.role === 'user');

    // Pass 0: every user prompt carries its own [WORKSPACE CONTEXT] retrieval
    // block. Only the latest one is still load-bearing; older copies are the
    // first thing to go, before any tool output is touched.
    const lastUserIdxForCtx = (() => {
      for (let i = pruned.length - 1; i >= 0; i--) if (pruned[i].role === 'user') return i;
      return -1;
    })();
    pruned.forEach((m, idx) => {
      if (m.role !== 'user' || idx === lastUserIdxForCtx || !m.content) return;
      if (m.content.includes('[WORKSPACE CONTEXT')) {
        m.content = m.content.replace(/\n*\[WORKSPACE CONTEXT[^\]]*\][\s\S]*?\[\/WORKSPACE CONTEXT\]/g, '\n[workspace context omitted]');
      }
    });

    // Pass 1: Compact tool outputs from older turns.
    // The most recent tool result (the one right before the current turn) is kept pristine.
    // All older tool results (e.g. earlier file reads) are compressed to a compact snippet.
    const toolIndices: number[] = [];
    pruned.forEach((m, idx) => {
      if (m.role === 'tool') toolIndices.push(idx);
    });

    // Keep every tool result belonging to the CURRENT turn pristine, not just the
    // single most recent one. A turn that issues parallel tool calls (or reads two
    // files back to back) previously had all but the last result compacted before
    // the model ever saw them.
    const lastUserIdx = (() => {
      for (let i = pruned.length - 1; i >= 0; i--) {
        if (pruned[i].role === 'user') return i;
      }
      return -1;
    })();
    const currentTurnToolIndices = toolIndices.filter(idx => idx > lastUserIdx);
    const safeToolIndices = new Set(
      currentTurnToolIndices.length > 0 ? currentTurnToolIndices : toolIndices.slice(-1)
    );

    for (const idx of toolIndices) {
      if (safeToolIndices.has(idx)) continue;
      const msg = pruned[idx];
      if (msg.content && msg.content.length > 250) {
        const lines = msg.content.split('\n');
        if (lines.length > 8) {
          msg.content = `${lines.slice(0, 4).join('\n')}\n... [${lines.length - 6} lines compacted. File content previously inspected] ...\n${lines.slice(-2).join('\n')}`;
        } else {
          msg.content = msg.content.slice(0, 250) + '... [compacted]';
        }
      }
    }

    currentTokens = estimateTokens(pruned);
    if (currentTokens <= maxTokensBudget) return pruned;

    // Pass 2: Truncate large earlier assistant reasoning or conversational blocks (excluding the last assistant message)
    const assistantIndices = pruned.map((m, idx) => m.role === 'assistant' ? idx : -1).filter(idx => idx >= 0);
    const olderAssistantIndices = assistantIndices.slice(0, -1);
    for (const idx of olderAssistantIndices) {
      const msg = pruned[idx];
      if (msg.content && msg.content.length > 400 && (!msg.tool_calls || msg.tool_calls.length === 0)) {
        msg.content = msg.content.slice(0, 250) + '\n... [earlier response content summarized]';
      }
    }

    currentTokens = estimateTokens(pruned);
    if (currentTokens <= maxTokensBudget) return pruned;

    // Pass 3: Even the most recent tool result is too large! Compact it to 30 lines
    for (const idx of toolIndices) {
      const msg = pruned[idx];
      if (msg.content && msg.content.length > 1200) {
        const lines = msg.content.split('\n');
        if (lines.length > 40) {
          msg.content = `${lines.slice(0, 25).join('\n')}\n... [${lines.length - 35} lines compacted for context preservation] ...\n${lines.slice(-10).join('\n')}`;
        } else {
          msg.content = msg.content.slice(0, 800) + '... [compacted]';
        }
      }
    }

    currentTokens = estimateTokens(pruned);
    if (currentTokens <= maxTokensBudget) return pruned;

    // Pass 4 (Emergency sliding window): Retain system prompt, first user prompt, and the last 6 messages.
    const keepStart: AgentMessage[] = [systemMsg];
    if (firstUserIdx >= 0 && pruned[firstUserIdx] !== systemMsg) {
      keepStart.push(pruned[firstUserIdx]);
    }
    const tailCount = Math.min(6, pruned.length);
    const keepEnd = pruned.slice(pruned.length - tailCount).filter(m => !keepStart.includes(m));

    const result = [...keepStart, ...keepEnd];

    // Repair tool-call pairing broken by the sliding window.
    // OpenAI-compatible servers (llama-server included) reject a `tool` message
    // whose matching assistant `tool_calls` message was cut, and reject an
    // assistant `tool_calls` message whose results were cut. Either one produced
    // an HTTP 400 that the auto-heal path then misread as a context overflow,
    // pruned harder, and hit again - so a long session could fail permanently.
    const repaired: AgentMessage[] = [];
    const emittedCallIds = new Set<string>();
    for (const m of result) {
      if (m.role === 'tool') {
        // Drop tool results whose originating assistant turn is gone.
        if (!m.tool_call_id || !emittedCallIds.has(m.tool_call_id)) continue;
        repaired.push(m);
        continue;
      }
      if (m.role === 'assistant') {
        const calls = (m.tool_calls || (m as any).toolCalls) as any[] | undefined;
        if (calls && calls.length) {
          const idx = result.indexOf(m);
          const hasAnyResult = result
            .slice(idx + 1)
            .some(n => n.role === 'tool' && n.tool_call_id && calls.some((tc: any) => tc?.id === n.tool_call_id));
          if (!hasAnyResult) {
            // Keep the prose, drop the dangling call so the sequence stays valid.
            const stripped: AgentMessage = { role: 'assistant', content: m.content || '[tool call omitted during context compaction]' };
            repaired.push(stripped);
            continue;
          }
          for (const tc of calls) if (tc?.id) emittedCallIds.add(tc.id);
        }
      }
      repaired.push(m);
    }

    // Guarantee that at least one user query is present
    const hasUser = repaired.some(m => m.role === 'user');
    if (!hasUser) {
      repaired.splice(1, 0, {
        role: 'user',
        content: 'Please proceed with inspecting the workspace and executing the tasks.'
      });
    }

    return repaired;
  }

  /**
   * Formats agent messages into valid Ollama /api/chat payload messages.
   * Crucially preserves tool_calls, tool_call_id, images, and ensures at least
   * one user prompt exists so Ollama never throws "500 - no user query found".
   */
  private formatOllamaMessages(safeMessages: AgentMessage[]): any[] {
    const formatted = safeMessages.map((m) => {
      let role = m.role;
      let content = m.content || '';

      const hasToolCalls = (m.tool_calls && m.tool_calls.length > 0) ||
                           ((m as any).toolCalls && (m as any).toolCalls.length > 0);

      // Only convert a LEGACY assistant blueprint (old header shape) to a user
      // directive. New blueprints are already user-role; verification messages
      // must stay assistant-role or they become a fresh directive next run.
      if (role === 'assistant' && !hasToolCalls && content.startsWith('### 🧠 Local Architect (Brain 1')) {
        role = 'user';
        content = `[LEAD ARCHITECT DIRECTIVE]\n${content}\n\n[MANDATORY WORKER EXECUTION INSTRUCTION]:
You are the Autonomous Implementation Worker on this NVIDIA RTX 5090 workstation.
1. DO NOT thank the architect.
2. DO NOT summarize or re-explain the blueprint.
3. DO NOT output conversational pleasantries.
4. IMMEDIATELY start executing the blueprint by calling the appropriate tool (such as list_files, read_file, edit_file, write_file, or run_command) or producing the direct implementation code.`;
      }

      const msg: any = { role, content };

      if (hasToolCalls) {
        msg.tool_calls = m.tool_calls || (m as any).toolCalls;
      }

      if (m.tool_call_id) {
        msg.tool_call_id = m.tool_call_id;
      }

      if (m.images && m.images.length > 0) {
        msg.images = m.images.map(img => img.replace(/^data:[^;]+;base64,/, ''));
      }

      return msg;
    });

    // Ensure Ollama Jinja template always sees at least one user query
    const hasUserQuery = formatted.some(m => m.role === 'user');
    if (!hasUserQuery) {
      const insertAt = formatted.length > 1 ? 1 : 0;
      formatted.splice(insertAt, 0, {
        role: 'user',
        content: 'Please inspect the workspace and execute the required tasks.'
      });
    }

    return formatted;
  }

  /**
   * Local Ollama API caller (100% free, 0 quota) with real-time token streaming
   * and multi-layer auto-healing safeguards.
   */
  private async callOllama(
    messages: AgentMessage[],
    model: string,
    signal: AbortSignal,
    taskMode: string,
    onToken?: (token: string) => void,
    useToolsParam: boolean = true,
    extra: { think?: boolean } = {}
  ): Promise<{ content: string; toolCalls: any[]; streamed: boolean }> {
    // Intelligently prune and compact history so Ollama stays within safe CUDA limits
    const safeMessages = this.getPrunedHistory(messages, 9000);
    // Thinking is explicit, never implicit. A thinking-capable model (qwen3.x,
    // deepseek-r1) left to its default spends hundreds of tokens at ~30 tok/s
    // on hidden reasoning before every worker tool call - and the old code
    // never read `message.thinking`, so the user saw a silent stall. Worker
    // turns get think:false; the architect gets it on when the tier warrants.
    const thinkCapable = await this.ollamaSupportsThinking(model || 'qwen3.8:27b');
    const think: boolean | undefined = thinkCapable ? (extra.think === true) : undefined;
    // Pinned, NOT adaptive. Ollama reloads the model from scratch whenever
    // `num_ctx` changes between requests, so alternating 8192/16384 across turns
    // cost a full model reload (tens of seconds) mid-conversation. History is
    // already pruned to a 9K budget, so 16384 always fits.
    const numCtx = 16384;

    const cleanModelName = (model || 'qwen3.8:27b').trim().toLowerCase();
    const isKnownNonTool = AgentEngine.nonToolModels.has(cleanModelName) || AgentEngine.nonToolModels.has(cleanModelName.split(':')[0]);
    const useTools = useToolsParam && !isKnownNonTool;
    const formattedOllamaMessages = this.formatOllamaMessages(safeMessages);

    if (useToolsParam && isKnownNonTool) {
      // Provide prompt-based tool schema so non-tool models (e.g. gemma3) can still trigger tools via text
      const sysMsg = formattedOllamaMessages.find((m: any) => m.role === 'system');
      if (sysMsg && !sysMsg.content.includes('[WORKSPACE TOOLS]')) {
        sysMsg.content += `\n\n[WORKSPACE TOOLS]: If you need to inspect or modify files or run commands, output a JSON block:\n\`\`\`json\n{"name": "tool_name", "arguments": {"param": "val"}}\n\`\`\`\nAvailable tools: list_files, read_file, write_file, edit_file, run_command.`;
      }
    }

    const payload: any = {
      model: model || 'qwen3.8:27b',
      messages: formattedOllamaMessages,
      stream: true,
      // Release VRAM quickly when llama-server also needs the card. Ollama's
      // default (5m) meant a single fallback turn could leave 17 GB pinned long
      // after the turn ended.
      // 2m (was 5m) when the coder server is absent: long enough to avoid a
      // reload between turns, short enough that an app relaunch that
      // auto-starts the coder is not fighting a stale 17 GB tenant.
      keep_alive: this.providerConfig.ollamaKeepAlive
        || (this.engineStatus?.llamaServer.up ? '30s' : '2m'),
      options: {
        num_ctx: numCtx,
        temperature: taskMode === 'general' ? 0.7 : 0.2,
        num_predict: think ? 6144 : 4096
      }
    };
    if (typeof think === 'boolean') payload.think = think;

    if (useTools) {
      payload.tools = OLLAMA_TOOLS;
    }

    let res: Response;
    try {
      res = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal
      });
    } catch (err: any) {
      if (signal.aborted) throw err;
      // Auto-retry once after 1.5s in case Ollama daemon was waking up or reinitializing
      try {
        await new Promise(r => setTimeout(r, 1500));
        res = await fetch('http://127.0.0.1:11434/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal
        });
      } catch {
        throw new Error('Cannot connect to Ollama (127.0.0.1:11434). Ollama service appears to be offline. Click "Start Ollama" in the top bar to launch it.');
      }
    }

    if (!res.ok) {
      if (res.status === 400) {
        // 400 Auto-Recovery: Handle "does not support tools" (e.g. gemma3:27b, gemma models)
        let errDetails = '';
        try {
          const clone = res.clone();
          const errJson = await clone.json();
          errDetails = errJson.error || JSON.stringify(errJson);
        } catch {
          try {
            errDetails = await res.text();
          } catch {}
        }

        if (errDetails.toLowerCase().includes('does not support tools') ||
            errDetails.toLowerCase().includes('support tools') ||
            (errDetails.toLowerCase().includes('tool') && payload.tools)) {
          console.warn(`[Agent] Model ${payload.model} does not support native tools. Auto-healing by retrying without tools parameter.`);
          AgentEngine.nonToolModels.add(payload.model.toLowerCase());
          AgentEngine.nonToolModels.add(payload.model.toLowerCase().split(':')[0]);
          delete payload.tools;

          const sysMsg = payload.messages?.find((m: any) => m.role === 'system');
          if (sysMsg && !sysMsg.content.includes('[WORKSPACE TOOLS]')) {
            sysMsg.content += `\n\n[WORKSPACE TOOLS]: If you need to inspect or modify files or run commands, output a JSON block:\n\`\`\`json\n{"name": "tool_name", "arguments": {"param": "val"}}\n\`\`\`\nAvailable tools: list_files, read_file, write_file, edit_file, run_command.`;
          }

          try {
            res = await fetch('http://127.0.0.1:11434/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal
            });
          } catch (retryErr: any) {
            console.warn('[Agent] Auto-retry after 400 failed:', retryErr.message);
          }
        }
      } else if (res.status === 404) {
        // Model was deleted or not found; automatically fallback to an installed model
        try {
          const tagsRes = await fetch('http://127.0.0.1:11434/api/tags');
          if (tagsRes.ok) {
            const tagsData: any = await tagsRes.json();
            const installedModels: string[] = tagsData.models?.map((m: any) => m.name) || [];
            const fallbackModel = installedModels.find((m: string) => m.includes('qwen')) || installedModels[0];
            if (fallbackModel && fallbackModel !== payload.model) {
              this.send('agent:token', { token: `⚠️ Model *${payload.model}* was not found. Automatically switched to installed model **${fallbackModel}**.\n\n`, model: fallbackModel });
              payload.model = fallbackModel;
              res = await fetch('http://127.0.0.1:11434/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal
              });
            }
          }
        } catch {}
      } else if (res.status === 500) {
        // 500 Recovery: Reduce context to 8192 and compact history aggressively, then retry
        try {
          payload.options.num_ctx = 8192;
          const retryPruned = this.getPrunedHistory(messages, 4500);
          payload.messages = this.formatOllamaMessages(retryPruned);
          res = await fetch('http://127.0.0.1:11434/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal
          });
        } catch {}
      }

      if (!res.ok) {
        let errDetails = '';
        try {
          const errJson = await res.json();
          errDetails = errJson.error || JSON.stringify(errJson);
        } catch {
          errDetails = await res.text().catch(() => '');
        }
        throw new Error(`Ollama API error: ${res.status} ${res.statusText}${errDetails ? ` - ${errDetails}` : ''}`);
      }
    }

    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Response body is not readable.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let toolCalls: any[] = [];
    let inThink = false;
    let thinkBuffer = '';
    let streamedAny = false;
    let nativeThinking = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const data = JSON.parse(line);
          const msg = data.message;
          if (!msg) continue;

          // Native thinking channel (Ollama >= 0.9). Collected, surfaced once.
          if (typeof msg.thinking === 'string' && msg.thinking) {
            nativeThinking += msg.thinking;
          }

          if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
            toolCalls.push(...msg.tool_calls);
          }

          const chunk = msg.content || '';
          if (chunk) {
            content += chunk;

            if (chunk.includes('<think>')) inThink = true;
            if (inThink) {
              thinkBuffer += chunk;
              if (chunk.includes('</think>')) {
                inThink = false;
                const thought = thinkBuffer.replace(/<think>|<\/think>/g, '').trim();
                this.send('agent:thought', { thought });
                thinkBuffer = '';
              }
            } else {
              // Only stream conversational tokens in real time, not tool call JSON syntax
              const trimmed = content.trim();
              if (!trimmed.startsWith('{') && !trimmed.startsWith('```json')) {
                if (onToken) {
                  onToken(chunk);
                  streamedAny = true;
                }
              }
            }
          }
        } catch {
          // Ignore partial chunk parse error
        }
      }
    }

    // Extract thoughts from <think>...</think> tags if present in final content
    const thinkMatch = content.match(/<think>([\s\S]*?)<\/think>/);
    if (thinkMatch) {
      const thought = thinkMatch[1].trim();
      this.send('agent:thought', { thought });
      content = content.replace(/<think>[\s\S]*?<\/think>/, '').trim();
    }

    if (nativeThinking.trim()) {
      this.send('agent:thought', { thought: nativeThinking.trim() });
    }

    // Fallback: If Ollama didn't parse tool_calls into message.tool_calls,
    // but the model generated a JSON / <tool_call> block in msg.content
    if (toolCalls.length === 0 && content) {
      const embedded = extractEmbeddedToolCalls(content);
      if (embedded.calls.length) {
        toolCalls = embedded.calls;
        content = embedded.stripped;
      }
    }

    return { content, toolCalls, streamed: streamedAny };
  }

  async run(
    prompt: string,
    model: string = 'qwen2.5-coder:32b',
    autoMode: boolean = true,
    taskMode: string = 'coding',
    editorContext?: EditorContext,
    images?: string[]
  ) {
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const gpuDesc = this.gpuName || 'Hardware Accelerated GPU';

    const activeFileName = editorContext?.activeFile 
      ? editorContext.activeFile.split(/[\\/]/).pop() || editorContext.activeFile 
      : null;
    const activeFileDetail = editorContext?.activeFile
      ? `Active open editor tab: "${editorContext.activeFile}" (${activeFileName}). The user currently has this file open in the code editor.`
      : `Active open editor tab: None open.`;
    const openTabsDetail = editorContext?.openTabs && editorContext.openTabs.length > 0
      ? `Open editor tabs: ${editorContext.openTabs.map(t => t.name || t.path).join(', ')}.`
      : `Open editor tabs: None.`;
    const editorVisibility = editorContext?.isEditorOpen 
      ? `Code editor is currently open in split view.`
      : `Code editor is currently collapsed (full canvas mode).`;

    const modeDesc = autoMode
      ? `AUTO MODE: ACTIVE (Autonomous Read & Write Access).
You have full autonomous authority to read, write, edit, and create files and run terminal commands in the workspace ("${this.workspaceDir}").
CRITICAL DIRECTIVES:
1. You DO have complete filesystem tool access via: list_files, read_file, write_file, edit_file, run_command.
2. NEVER say "I don't have file-access tools available in this session" or claim you cannot read the local disk.
3. NEVER ask the user to manually paste files, directory trees, or run terminal commands themselves.
4. When asked to review, inspect, analyze, debug, or refactor code in "${this.workspaceDir}", IMMEDIATELY invoke list_files or read_file as your very first step!
5. All actions execute autonomously without pausing for manual approval.`
      : `REVIEW MODE: ACTIVE (Confirmation Required).
You have full tool access to the workspace ("${this.workspaceDir}").
CRITICAL DIRECTIVES:
1. You DO have real filesystem tools (list_files, read_file, write_file, edit_file, run_command).
2. NEVER claim you lack file access.
3. When asked to inspect or modify files, call the appropriate tool. The IDE will prompt the user to confirm before execution.`;

    const projectProfile = this.getProjectProfile();
    const verifyHint = projectProfile.verifyCommands.length
      ? `After editing code, verify with: ${projectProfile.verifyCommands.map(c => `\`${c}\``).join(' then ')}.`
      : `This project has no build/typecheck command; re-read the edited region to confirm the change.`;

    const systemPrompt = `You are Strata Code, an autonomous expert software engineering agent inside the "Strata Code" desktop IDE, accelerated by ${gpuDesc}.
IMPORTANT CONTEXT:
1. "Strata Code" (or "Strata") is the desktop IDE software running on the user's computer.
2. Active Workspace Directory: "${this.workspaceDir}".
3. ${modeDesc}
4. Real-time IDE State:
   - ${activeFileDetail}
   - ${openTabsDetail}
   - ${editorVisibility}
5. When the user refers to "this file", "the open file", or asks what they have open in the app, reference the active editor tab above.
6. When you need to inspect or act on files, invoke the corresponding tool directly via function calling. NEVER output raw JSON tool calls in conversational text.
7. Project: ${projectProfile.summary || 'unknown layout'}.

WORKING METHOD (follow exactly):
- Locate before reading: use search_codebase to find the symbol/string, then read_file with startLine/lineCount for just that region. Do not read whole large files.
- Edit surgically: edit_file with a short, unique targetContent copied verbatim from read_file output WITHOUT the "NN: " line-number prefixes. The result shows the edited region; do not re-read to confirm.
- Never describe an action instead of taking it. If the next step is a tool call, make the call in this turn.
- Inspection is preparation, not the result. If the request asks for a design, architecture, plan, proposal or document, write it to a NEW file with write_file (e.g. docs/<topic>.md); reading files and summarizing them does not complete such a request. Never overwrite existing files the user did not name.
- When the work is done, stop. Do not run more listing or inspection commands after the deliverable exists; reply "DONE:".
- ${verifyHint} Fix anything it reports before declaring completion.
- When the whole request is done, reply "DONE:" followed by a short summary of the files changed and how they were verified.`;

    if (this.history.length === 0) {
      this.history.push({ role: 'system', content: systemPrompt });
    } else if (this.history[0]?.role === 'system') {
      this.history[0].content = systemPrompt;
    }

    // Inspect prompt for @file context mentions to pre-inject for zero-latency turn-1 execution
    const fileTagRegex = /@("([^"]+)"|'([^']+)'|([a-zA-Z0-9_./\\-]+))/g;
    const attachedFiles: { path: string; content: string }[] = [];
    const seenPaths = new Set<string>();
    let tagMatch;

    while ((tagMatch = fileTagRegex.exec(prompt)) !== null) {
      const tagged = tagMatch[2] || tagMatch[3] || tagMatch[4];
      if (tagged && !seenPaths.has(tagged)) {
        seenPaths.add(tagged);
        const resolved = this.tools.resolvePath(tagged);
        if (fs.existsSync(resolved)) {
          try {
            const stats = fs.statSync(resolved);
            if (!stats.isDirectory() && stats.size <= 500 * 1024) {
              const content = fs.readFileSync(resolved, 'utf-8');
              attachedFiles.push({ path: tagged, content });
            }
          } catch {}
        }
      }
    }

    // Automatic Active File Context Injection:
    // If the user has a file open in their editor, automatically provide its content so the model sees it immediately!
    if (editorContext?.activeFile && !seenPaths.has(editorContext.activeFile)) {
      seenPaths.add(editorContext.activeFile);
      let activeContent = editorContext.activeFileContent;
      if (!activeContent) {
        const resolvedActive = this.tools.resolvePath(editorContext.activeFile);
        if (fs.existsSync(resolvedActive)) {
          try {
            const stats = fs.statSync(resolvedActive);
            if (!stats.isDirectory() && stats.size <= 300 * 1024) {
              activeContent = fs.readFileSync(resolvedActive, 'utf-8');
            }
          } catch {}
        }
      }

      if (activeContent) {
        const lines = activeContent.split('\n');
        let contentSnippet = activeContent;
        if (lines.length > 300) {
          const head = lines.slice(0, 220).join('\n');
          const tail = lines.slice(-60).join('\n');
          contentSnippet = `${head}\n\n... [${lines.length - 280} lines truncated for context. File has ${lines.length} lines total in editor] ...\n\n${tail}`;
        }
        attachedFiles.unshift({
          path: `${editorContext.activeFile} (CURRENTLY OPEN IN ACTIVE EDITOR TAB)`,
          content: contentSnippet
        });
      }
    }

    let contextualizedPrompt = prompt;
    if (attachedFiles.length > 0) {
      const contextBlocks = attachedFiles.map(f =>
        `[ATTACHED FILE CONTEXT: ${f.path}]\n${f.content}\n[/ATTACHED FILE CONTEXT]`
      ).join('\n\n');
      contextualizedPrompt = `${contextBlocks}\n\nUser Question/Instruction:\n${prompt}`;
    } else if (editorContext?.activeFile) {
      contextualizedPrompt = `[IDE State: User currently has active file "${editorContext.activeFile}" open in the editor]\n\n${prompt}`;
    }

    // =========================================================================
    // LOCAL GROUNDING (zero model cost)
    //
    // Before any model sees the request, grep the workspace for the identifiers
    // in it and hand over the matching files WITH line numbers. A local model
    // given real paths and line numbers makes its first tool call a targeted
    // read instead of a fishing expedition through list_files + whole-file reads.
    // =========================================================================
    const classification = this.classifyTask(prompt, editorContext, taskMode);
    const promptWords = (prompt || '').trim().split(/\s+/).filter(Boolean).length;
    const isSingleWordAck = promptWords <= 2 &&
      /^(ok|okay|yes|yep|sure|continue|proceed|go ahead|thanks|thank you|no|nope)$/i.test((prompt || '').trim());
    let retrievalBlock = '';
    if (!isSingleWordAck && (taskMode === 'coding' || classification.band !== 'trivial')) {
      try {
        const extraTerms = editorContext?.activeFile
          ? [editorContext.activeFile.split(/[\\/]/).pop() || ''].filter(Boolean)
          : [];
        const retrieved = await buildRetrievalBlock(this.workspaceDir, prompt, extraTerms, { maxChars: 5500, deadlineMs: 2500 });
        retrievalBlock = retrieved.block;
        if (retrieved.files.length) {
          console.log(`[Grounding] ${retrieved.files.length} relevant files for terms: ${retrieved.terms.slice(0, 8).map(t => t.term).join(', ')}`);
        }
      } catch {
        // Retrieval is best-effort.
      }
    }
    if (retrievalBlock) {
      contextualizedPrompt = `${contextualizedPrompt}\n\n${retrievalBlock}`;
    }

    // Advisory runs deliver an answer, never edits. The note goes to the model;
    // the tool refusal below enforces it regardless.
    const advisoryRun = !isSingleWordAck && isAdvisoryRequest(prompt);
    if (advisoryRun) {
      contextualizedPrompt = `${contextualizedPrompt}\n\n[ENGINE NOTE] This is an analysis request. Inspect with search_codebase / read_file / list_files, then answer in chat with concrete, specific findings (file and line, what is wrong, what to change). Do NOT modify any files - the user asked for suggestions, not changes. End with a short prioritized list.`;
    }

    this.history.push({
      role: 'user',
      content: contextualizedPrompt,
      images: images && images.length > 0 ? images : undefined
    });
    this.send('agent:message-added', { role: 'user', content: prompt, images });
    this.writeLiveDialogue('USER', 'User Prompt', prompt);

    // =========================================================================
    // RUN STATE
    // =========================================================================
    const MAX_TURNS = 60;
    const REVISE_TURNS = 14;
    // Turn count alone does not bound cost: one turn can carry a 48K-token prompt.
    // This is the actual ceiling on a runaway autonomous loop.
    const MAX_RUN_TOKENS = 120000;
    let turnCount = 0;
    let localTokensAccumulated = 0;
    const cloudTokensAccumulated = 0;
    let budgetExhausted = false;
    let hitTurnLimit = false;

    let activeProvider = this.providerConfig?.activeProvider || 'ollama';
    const isHybrid = this.providerConfig.hybridMode === true ||
                     (this.providerConfig.hybridMode !== false &&
                      (activeProvider === 'hybrid' ||
                       model === 'hybrid' ||
                       model.startsWith('hybrid:')));

    const codingModel = this.providerConfig.codingModel || 'qwen2.5-coder:32b';
    const generalModel = this.providerConfig.generalModel || 'qwen3.8:27b';

    // The user's setting is a CEILING on architect effort; the router may choose less.
    const userHybridTier: 'low' | 'medium' | 'high' = this.providerConfig.hybridTier || 'medium';
    let hybridTier: 'low' | 'medium' | 'high' = userHybridTier;
    let architectModel = this.architectModelId();
    if (model.startsWith('hybrid:')) {
      const parsed = model.replace('hybrid:', '').trim();
      if (parsed) architectModel = parsed;
    }
    let architectProvider = this.architectProviderFor(architectModel);
    if (architectProvider !== 'local' && !this.hasArchitectKey(architectModel)) {
      console.log(`[Hybrid] No ${architectProvider} key configured - architect runs locally on the RTX 5090 (free).`);
      architectProvider = 'local';
      architectModel = 'local';
    }
    const architectLabel = this.architectLabel(architectModel);

    // In Hybrid mode: pair worker by task mode (coding -> codingModel, general -> generalModel)
    let workerModel = this.providerConfig.hybridWorkerModel ||
      (isHybrid ? (taskMode === 'coding' ? codingModel : generalModel) :
       (model !== 'hybrid' && !model.startsWith('hybrid:') && !model.startsWith('gemini') ? model : (taskMode === 'coding' ? codingModel : generalModel)));

    // Route this run before spending anything on it.
    const hybridPlan = isHybrid
      ? this.planHybridRun(prompt, editorContext, taskMode, userHybridTier, architectProvider)
      : null;
    if (hybridPlan) {
      hybridTier = hybridPlan.tier;
      console.log(`[Hybrid Router] ${hybridPlan.reason} | signals: ${hybridPlan.classification.signals.join(', ') || 'none'}`);
    }
    let architectEscalations = 0;

    // "What model is this?" is answered by the engine from what it actually
    // knows - configured slots, what is resident on the GPU, and where this
    // turn would be routed. Sending it to the worker produced a directory
    // listing.
    const identityAsk = /^\s*(what|which)\s+(model|llm|ai|brain)s?\s*(is this|is that|are you|am i (talking|chatting|speaking) (to|with)|is (running|active|in use|loaded|being used)|do you use|are we using|is (the )?(worker|architect|coder))?\s*\??\s*$|^\s*(who|what) are you\s*\??\s*$/i;
    if (identityAsk.test((prompt || '').trim())) {
      let statusText = 'engine status unavailable';
      let routedText = '';
      try {
        const st = await this.probeLocalEngines(true);
        const server = st.llamaServer.up
          ? `llama-server :8080 serving **${st.llamaServer.alias || 'unknown alias'}**${st.llamaServer.nCtx ? ` (${Math.round(st.llamaServer.nCtx / 1024)}K context)` : ''}`
          : st.llamaServer.loading ? 'llama-server :8080 still loading' : 'llama-server :8080 not running';
        const ollama = st.ollamaLoaded.length
          ? `Ollama has **${st.ollamaLoaded.map(m => m.name).join(', ')}** loaded`
          : 'Ollama has no model loaded';
        const gpu = st.gpu ? ` • GPU ${(st.gpu.usedMiB / 1024).toFixed(1)} / ${(st.gpu.totalMiB / 1024).toFixed(1)} GB used` : '';
        statusText = `${server} • ${ollama}${gpu}`;
        const routed = await this.resolveLocalWorker(workerModel);
        routedText = routed.model === workerModel
          ? `**${routed.model}**`
          : `**${routed.model}** (VRAM arbiter: ${workerModel} cannot load beside the resident model)`;
      } catch {
        routedText = `**${workerModel}**`;
      }
      const answer = [
        `**Configured** — coding model: \`${codingModel}\` • general model: \`${generalModel}\` • architect: \`${architectModel}\` • mode: ${isHybrid ? `hybrid (${hybridTier})` : 'local'} • task mode: ${taskMode}`,
        `**Resident right now** — ${statusText}`,
        `**This turn would run on** — ${routedText}`,
        `Change the slots from the model picker in the title bar or the Model Manager. In hybrid mode the coding model is the worker and the general model is the architect.`
      ].join('\n\n');
      const sender = { model: 'Strata Engine', senderModelType: 'local', senderName: 'Strata Engine', addressedTo: 'User' };
      this.send('agent:message-start', sender);
      this.send('agent:token', { token: answer, ...sender });
      this.flushTokens();
      this.history.push({ role: 'assistant', content: answer });
      this.send('agent:collaborate-step', {
        stage: 'verified', architectModel: '', workerModel, activeRole: 'worker',
        title: 'Answered by the engine', message: 'Model identity resolved from engine state (no model call).',
        cloudTokens: 0, localTokens: 0, quotaSavedPercent: 0
      });
      this.send('agent:status', { state: 'idle' });
      return;
    }

    const gateEnabled = this.providerConfig.verificationGate !== false;
    const maxReviewRounds = typeof this.providerConfig.maxReviewRounds === 'number'
      ? Math.max(0, Math.min(this.providerConfig.maxReviewRounds, 3))
      : 1;
    const thinkMode = this.providerConfig.architectThinking || 'auto';
    const architectShouldThink = (phase: 'plan' | 'replan' | 'review'): boolean => {
      if (thinkMode === 'off') return false;
      if (thinkMode === 'on') return true;
      if (phase === 'replan') return hybridTier !== 'low';
      return hybridTier === 'high';
    };

    interface EditRecord { path: string; oldContent: string; newContent: string }
    interface VerifyRun { command: string; success: boolean; output: string }
    interface VerifyReport { round: number; results: VerifyRun[]; passed: boolean }

    const state = {
      plan: null as TaskPlan | null,
      toolCalls: 0,
      edited: new Map<string, EditRecord>(),
      readCounts: new Map<string, number>(),
      editFailures: new Map<string, number>(),
      nudges: 0,
      intentNudges: 0,
      lastNudgeKey: '',
      verifyRounds: 0,
      editsSinceVerify: 0,
      verifyReports: [] as VerifyReport[],
      reviewRounds: 0,
      consecutiveRepeat: 0,
      lastToolSig: '',
      currentBubble: '',
      /** Tool calls made after every edit/run task was already closed. */
      postDoneCalls: 0,
      postDoneNudged: false,
      inspectCmdStreak: 0,
      created: new Set<string>(),
      /** Set once the inspection budget is spent: the next model turn runs with tools disabled so it must answer. */
      forceAnswer: false
    };

    const countTokens = (text: string) => Math.round((text?.length || 0) / 3.5);

    // ---- transcript sender metadata --------------------------------------
    const workerSender = (m: string) => isHybrid
      ? {
          model: m,
          senderModelType: 'offline',
          senderRole: 'worker',
          senderName: `Local Coder Worker (${m} • RTX 5090)`,
          addressedTo: 'Local Architect'
        }
      : { model: m };

    const architectSender = (id: string, addressedTo: string) => ({
      model: `Local Architect (${id})`,
      senderModelType: 'local',
      senderRole: 'architect',
      senderName: `Local Architect (${id})`,
      addressedTo
    });

    const notice = (text: string) => {
      this.notice(text);
      state.currentBubble = 'notice';
    };

    // The arbiter re-evaluates every turn; the same routing decision must not
    // produce the same bubble 20 times in one run.
    let lastArbiterNotice = '';
    const arbiterNotice = (text: string) => {
      // Compare without the free/needed GB figures, which drift by a few
      // hundred MB between phases and made the same decision print twice.
      const key = text.replace(/\d+(\.\d+)?\s*GB/g, 'N GB');
      if (key === lastArbiterNotice) return;
      lastArbiterNotice = key;
      notice(`🎛️ VRAM Arbiter: ${text}`);
    };

    // =========================================================================
    // VRAM PRE-FLIGHT
    //
    // "The whole PC freezes and unfreezes in hybrid mode" is what a 30 GB card
    // looks like with llama-server (~26 GB) AND an Ollama 27B (~19 GB) both
    // resident: the driver pages VRAM through system RAM and the desktop
    // stalls in bursts until one model unloads. Refuse to start a run in that
    // state - evict Ollama first, then go.
    // =========================================================================
    if (!this.providerConfig.disableVramArbiter) {
      try {
        const status = await this.probeLocalEngines(true);
        const ollamaMiB = status.ollamaLoaded.reduce((a, m) => a + m.vramBytes, 0) / (1024 * 1024);
        if ((status.llamaServer.up || status.llamaServer.loading) && ollamaMiB > 512) {
          const freeMiB = status.gpu?.freeMiB;
          const dangerous = ollamaMiB > 8192 || (typeof freeMiB === 'number' && freeMiB < 3072);
          if (dangerous) {
            const names = status.ollamaLoaded.map(m => m.name).join(', ');
            const freed = await this.releaseOllamaVram();
            notice(`🧯 VRAM guard: llama-server (${status.llamaServer.alias || (status.llamaServer.loading ? 'still loading' : 'coder model')}) and Ollama (${names}) were both resident on the GPU — that is the configuration that freezes the desktop (VRAM spilling into system RAM). ${freed.length ? `Unloaded ${freed.join(', ')} from Ollama before starting.` : 'Could not unload Ollama automatically; stop one of them manually.'}`);
          }
        }
      } catch {
        // Pre-flight is best-effort.
      }
    }

    /** Tool cards attach to the LAST assistant bubble, so make sure that bubble is the worker's. */
    const ensureWorkerBubble = (effectiveModel: string) => {
      const key = `worker:${effectiveModel}`;
      if (state.currentBubble === key) return;
      this.send('agent:message-start', workerSender(effectiveModel));
      state.currentBubble = key;
    };

    const collab = (data: Partial<CollaborateStepData> & { stage: CollaborateStepData['stage']; title: string; message: string }) => {
      this.send('agent:collaborate-step', {
        architectModel: isHybrid ? architectModel : '',
        workerModel,
        activeRole: 'worker',
        cloudTokens: cloudTokensAccumulated,
        localTokens: localTokensAccumulated,
        quotaSavedPercent: isHybrid ? 100 : 0,
        hybridTier: isHybrid ? hybridTier : undefined,
        ...data
      });
    };

    // ---- architect call, streamed to the transcript ----------------------
    const callArchitectStreaming = async (
      messages: AgentMessage[],
      modelId: string,
      addressedTo: string,
      headerFor: string | ((modelUsed: string) => string),
      opts: { think?: boolean } = {}
    ): Promise<{ content: string; modelUsed: string }> => {
      let target = (modelId && modelId !== 'local') ? modelId : this.localArchitectModel(workerModel);
      // The architect goes through the VRAM arbiter too. Before this, only the
      // worker did - so a hybrid run with llama-server resident would load a
      // second 17 GB model into a card that could not hold it, spill into
      // shared memory, and crawl through the planning phase at 3 tok/s.
      try {
        const routed = await this.resolveLocalWorker(target);
        if (routed.notice) arbiterNotice(routed.notice);
        target = routed.model;
      } catch {}

      const sender = architectSender(target, addressedTo);
      // Headers name the model that actually answered, not the configured id
      // ('local' was showing up in the transcript as the architect's name).
      const header = typeof headerFor === 'function' ? headerFor(target) : headerFor;
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        this.send('agent:status', { state: 'responding' });
        this.send('agent:message-start', sender);
        state.currentBubble = `architect:${target}`;
        if (header) this.send('agent:token', { token: header, ...sender });
      };

      // Early stop. A coder model planning without tools sometimes writes a
      // fake python tool call and then re-emits the whole plan, seven times
      // over. The first repeat (or the first fake call after the task list)
      // ends the generation; the parser keeps the first copy.
      const local = new AbortController();
      const relay = () => local.abort();
      signal.addEventListener('abort', relay);
      let acc = '';
      let cut = false;
      const onTok = (tok: string) => {
        start();
        if (cut) return;
        acc += tok;
        const goals = (acc.match(/^#{1,3}\s*goal\b/gim) || []).length;
        const hasTasks = /^#{1,3}\s*tasks\b/im.test(acc);
        const fakeCall = hasTasks && /```(?:python|py|json|tool_call)?\s*\n\s*(?:list_files|read_file|edit_file|write_file|run_command|search_codebase)\s*\(/i.test(acc);
        if (goals >= 2 || fakeCall) {
          cut = true;
          local.abort();
          return;
        }
        this.send('agent:token', { token: tok, ...sender });
      };
      try {
        const res = await this.callLocalModel(messages, target, local.signal, taskMode, onTok, false, { think: opts.think });
        start();
        if (!res.streamed && res.content) {
          this.send('agent:token', { token: res.content, ...sender });
        }
        return { content: cut ? acc : (res.content || ''), modelUsed: target };
      } catch (err: any) {
        if (cut && !signal.aborted) {
          notice('✂️ Architect started repeating itself; stopped it and kept the first plan.');
          return { content: acc, modelUsed: target };
        }
        throw err;
      } finally {
        signal.removeEventListener('abort', relay);
      }
    };

    const emitArchitectToken = (text: string, addressedTo: string, id: string) => {
      this.send('agent:token', { token: text, ...architectSender(id, addressedTo) });
    };

    // ---- worker call ------------------------------------------------------
    const callWorker = async (effectiveModel: string) => {
      const sender = workerSender(effectiveModel);
      let first = false;
      const onTok = (token: string) => {
        if (!first) {
          first = true;
          this.send('agent:status', { state: 'responding', turn: turnCount });
          ensureWorkerBubble(effectiveModel);
        }
        this.send('agent:token', { token, ...sender });
      };
      // Once the inspection budget is spent the model gets no tools: it has to
      // write the answer it has been circling for 40 turns.
      const useTools = !state.forceAnswer;
      if (this.isPort8080Model(effectiveModel)) {
        return this.callOpenAICompatible(this.history, effectiveModel, signal, 'openai', taskMode, onTok, useTools);
      }
      return this.callOllama(this.history, effectiveModel, signal, taskMode, onTok, useTools, { think: false });
    };

    // ---- stall escalation ------------------------------------------------
    const escalateStall = async (toolName: string): Promise<void> => {
      const canEscalate = isHybrid && hybridPlan?.escalateOnStall === true && architectEscalations < 2;
      if (!canEscalate) return;
      architectEscalations++;
      try {
        collab({
          stage: 'escalate',
          activeRole: 'architect',
          title: `Worker Stalled — Escalating to Architect (${architectEscalations}/2)`,
          message: `Local coder worker repeated \`${toolName}\` three times without progress. Asking ${architectModel} to diagnose and re-plan.`
        });

        const stallGrounding = await this.buildWorkspaceGrounding(editorContext, { profile: projectProfile });
        const checklist = state.plan ? `\n\nCURRENT CHECKLIST:\n${renderChecklist(state.plan)}` : '';
        const stallMessages: AgentMessage[] = [
          {
            role: 'system',
            content: `You are the Lead Architect (Brain 1 • ${architectModel}). The local coder worker (${workerModel}) is STUCK: it has called \`${toolName}\` with identical arguments three times in a row and made no progress.

Diagnose why it is looping (wrong path? target block not matching? reading instead of editing?), then issue a CORRECTED plan that avoids the failing action. Be concrete: exact file paths and the single next tool call to make. Under 200 words.${checklist}${stallGrounding ? `\n\n${stallGrounding}` : ''}`
          },
          ...this.getPrunedHistory(this.history, 12000).filter(m => m.role !== 'system')
        ];

        const header = `### 🧭 Local Architect Re-plan (worker stalled on \`${toolName}\`)\n\n`;
        const replan = await callArchitectStreaming(stallMessages, architectModel, `Local Coder Worker (${workerModel})`, header, { think: architectShouldThink('replan') });
        localTokensAccumulated += countTokens(replan.content);

        if (replan.content) {
          this.writeLiveDialogue('ARCHITECT', 'Stall Re-plan', `${header}${replan.content}`);
          this.history.push({
            role: 'user',
            content: `[LOCAL ARCHITECT RE-PLAN — YOU WERE STUCK REPEATING ${toolName}]\n${replan.content}\n\n[MANDATORY]: Do NOT repeat that call. Follow the corrected plan above, starting from its first concrete step, by calling the tool now.`
          });
          state.consecutiveRepeat = 0;
          state.lastToolSig = '';
        }
      } catch (escErr: any) {
        console.warn('[Dual-Brain] Stall escalation failed:', escErr?.message);
      }
    };

    // ---- one tool call ----------------------------------------------------
    const executeToolCall = async (call: any, effectiveModel: string): Promise<'ok' | 'halt'> => {
      const toolName = call.function?.name || 'unknown';
      let toolArgs: any = call.function?.arguments || {};
      if (typeof toolArgs === 'string') {
        try {
          const trimmed = toolArgs.trim();
          toolArgs = trimmed === '' || trimmed === '{}' ? {} : JSON.parse(trimmed);
        } catch {
          toolArgs = {};
        }
      }
      const callId = call.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

      // Loop repetition breaker: track identical successive tool calls
      const toolSig = `${toolName}:${JSON.stringify(toolArgs)}`;
      if (toolSig === state.lastToolSig) {
        state.consecutiveRepeat++;
      } else {
        state.lastToolSig = toolSig;
        state.consecutiveRepeat = 1;
      }

      ensureWorkerBubble(effectiveModel);

      if (state.consecutiveRepeat >= 3) {
        this.send('agent:tool-finish', {
          id: callId,
          name: toolName,
          success: false,
          output: 'Action halted: Identical tool call repeated 3 times.'
        });
        this.history.push({
          role: 'tool',
          name: toolName,
          tool_call_id: callId,
          content: 'Action halted: identical tool call repeated 3 times. The result did not change; do something different (search_codebase for the exact text, read a different range, or edit with a shorter unique target).'
        });
        await escalateStall(toolName);
        return 'halt';
      }

      this.send('agent:tool-start', {
        id: callId,
        name: toolName,
        args: toolArgs,
        autoMode
      });

      // If NOT auto mode, prompt user for approval
      if (!autoMode) {
        this.send('agent:status', { state: 'waiting_approval' });
        const approved = await new Promise<boolean>((resolve) => {
          this.pendingApprovals.set(callId, resolve);
        });

        if (!approved) {
          this.history.push({
            role: 'tool',
            name: toolName,
            tool_call_id: callId,
            content: 'User rejected the execution of this action.'
          });
          this.send('agent:tool-finish', {
            id: callId,
            name: toolName,
            success: false,
            output: 'Action rejected by user'
          });
          return 'ok';
        }
      }

      // Execute the tool inside a protective sandbox
      this.send('agent:status', { state: 'executing' });
      let result: { success: boolean; output: string; diff?: EditRecord } = { success: false, output: 'Unknown tool' };

      // Overwrite guard. A local model given "update the docs" will happily
      // write_file a 191-line file it has only skimmed, replacing real content
      // with a padded rewrite. Replacing a file it has not read this run is
      // refused with instructions; new files and files it has read pass.
      let refused = false;
      // Re-read cap. The loop-guard note at read #3 was ignored seven times in
      // a row; from #4 the read is refused outright.
      if (toolName === 'read_file') {
        const rkey = String(toolArgs.path || '').replace(/\\/g, '/').toLowerCase();
        if (rkey && (state.readCounts.get(rkey) || 0) >= 4) {
          refused = true;
          result = {
            success: false,
            output: `Refused: ${toolArgs.path} has already been read ${state.readCounts.get(rkey)} times this run and nothing changed in between. Its content is in your context. Use search_codebase for a specific symbol, act on what you have, or write your answer now.`
          };
        }
      }
      if (!refused && advisoryRun && (toolName === 'write_file' || toolName === 'edit_file')) {
        refused = true;
        result = {
          success: false,
          output: `Refused: this is an analysis request ("suggest", "review", "inspect"...), so files must not be modified. Put your findings in your reply instead - concrete file:line references and what you would change. If the user wants the changes applied, they will ask.`
        };
      }
      if (!refused && toolName === 'write_file') {
        const wkey = String(toolArgs.path || '').replace(/\\/g, '/').toLowerCase();
        try {
          const resolved = this.tools.resolvePath(toolArgs.path || '');
          if (wkey && fs.existsSync(resolved) && !state.readCounts.has(wkey) && !state.edited.has(wkey) && !state.created.has(wkey)) {
            const existingLines = fs.readFileSync(resolved, 'utf-8').split('\n').length;
            if (existingLines > 30) {
              refused = true;
              result = {
                success: false,
                output: `Refusing to overwrite ${toolArgs.path} (${existingLines} lines): you have not read it in this run, so this write would replace content you have not seen. If the user asked you to change this file, read_file it first and then use edit_file for the specific change (or write_file after reading, if a full rewrite is really intended). If you meant to create a new document, choose a new path such as docs/<topic>.md.`
              };
            }
          }
        } catch {
          // Path outside the roots: the tool itself reports that.
        }
      }

      try {
        if (refused) throw null;
        switch (toolName) {
          case 'search_codebase':
            result = await this.tools.searchCodebase(toolArgs.query || '', {
              path: toolArgs.path,
              fileGlob: toolArgs.fileGlob,
              maxResults: toolArgs.maxResults
            });
            break;
          case 'read_file':
            result = await this.tools.readFile(toolArgs.path || '', toolArgs.startLine, toolArgs.lineCount);
            break;
          case 'write_file':
            result = await this.tools.writeFile(toolArgs.path || '', toolArgs.content || '');
            break;
          case 'edit_file':
            result = await this.tools.editFile(
              toolArgs.path || '',
              toolArgs.targetContent || '',
              toolArgs.replacementContent || ''
            );
            break;
          case 'list_files':
            result = await this.tools.listFiles(toolArgs.dirPath || toolArgs.path || '.', toolArgs.depth || 2);
            break;
          case 'run_command':
            result = await this.tools.runCommand(toolArgs.command || '');
            break;
          default:
            result = { success: false, output: `Unsupported tool: ${toolName}. Available: search_codebase, read_file, edit_file, write_file, list_files, run_command.` };
        }
      } catch (toolExecErr: any) {
        if (toolExecErr !== null) {
          result = { success: false, output: `Tool execution error: ${toolExecErr.message || String(toolExecErr)}` };
        }
      }

      // ---- loop guards & bookkeeping ------------------------------------
      const target = String(toolArgs.path || toolArgs.dirPath || '');
      const targetKey = target.replace(/\\/g, '/').toLowerCase();
      let guardNote = '';
      if (toolName === 'write_file' && result.success && targetKey) state.created.add(targetKey);

      // Inspection-command streak: twenty recursive directory listings in a
      // row is how a finished run burned its whole token budget.
      if (toolName === 'run_command') {
        const cmd = String(toolArgs.command || '').trim();
        const isInspection = /^\s*(get-childitem|gci|ls|dir|cat|type|get-content|gc|find|findstr|select-string|tree|wc|head|tail|measure-object|get-item|test-path)\b/i.test(cmd);
        state.inspectCmdStreak = isInspection ? state.inspectCmdStreak + 1 : 0;
        if (isInspection && state.inspectCmdStreak >= 3) {
          guardNote += `\n\n[Loop guard] That is ${state.inspectCmdStreak} inspection commands in a row. Listing and printing files through run_command is expensive; use search_codebase / list_files / read_file with a line range instead - or, if the deliverable already exists, stop and reply "DONE:".`;
        }
      } else if (toolName === 'edit_file' || toolName === 'write_file') {
        state.inspectCmdStreak = 0;
      }
      if (toolName === 'read_file' && result.success && targetKey) {
        const n = (state.readCounts.get(targetKey) || 0) + 1;
        state.readCounts.set(targetKey, n);
        if (n >= 3) {
          guardNote = `\n\n[Loop guard] This is read #${n} of ${target} with no edit in between. Its content is already in your context - act on it now (edit_file / write_file), or use search_codebase if you are looking for something specific.`;
        }
      }
      if (toolName === 'edit_file' || toolName === 'write_file') {
        if (result.success) {
          state.editFailures.delete(targetKey);
          state.readCounts.set(targetKey, 0);
          state.editsSinceVerify++;
          if (result.diff) {
            const prev = state.edited.get(targetKey);
            state.edited.set(targetKey, {
              path: result.diff.path,
              oldContent: prev ? prev.oldContent : result.diff.oldContent,
              newContent: result.diff.newContent
            });
          }
        } else {
          const f = (state.editFailures.get(targetKey) || 0) + 1;
          state.editFailures.set(targetKey, f);
          if (f >= 2) {
            guardNote = `\n\n[Hint] edit_file has failed ${f} times on ${target}. Use the closest-matching region shown above (or search_codebase) to get the CURRENT exact text, copy it verbatim into targetContent, and keep it short. If the block is hard to match, use write_file with the complete file content instead.`;
          }
        }
      }
      // The worker ran the project's own verify command and it passed: that IS
      // the gate. Re-running the same typecheck seconds later is pure latency.
      if (toolName === 'run_command' && result.success && state.editsSinceVerify > 0) {
        const cmd = String(toolArgs.command || '').trim().toLowerCase();
        const verifyCmds = chooseVerifyCommands(projectProfile, [...state.edited.values()].map(e => e.path)).map(c => c.toLowerCase());
        if (verifyCmds.includes(cmd) || projectProfile.verifyCommands.some(c => c.toLowerCase() === cmd)) {
          state.editsSinceVerify = 0;
          state.verifyReports.push({
            round: state.verifyRounds,
            results: [{ command: toolArgs.command, success: true, output: result.output }],
            passed: true
          });
        }
      }

      const finalOutput = `${result.output}${guardNote}`;

      this.send('agent:tool-finish', {
        id: callId,
        name: toolName,
        success: result.success,
        output: finalOutput,
        diff: result.diff
      });

      if (isHybrid && result.output) {
        const summarySnippet = result.output.length > 600 ? result.output.slice(0, 600) + '... [truncated]' : result.output;
        this.writeLiveDialogue('WORKER', `Tool Execution: ${toolName}`, `> 🔧 **Local Worker Tool Execution**: \`${toolName}\` (${result.success ? '✅ Success' : '❌ Failed'})\n\`\`\`\n${summarySnippet}\n\`\`\``);
      }

      this.history.push({
        role: 'tool',
        name: toolName,
        tool_call_id: callId,
        content: finalOutput
      });

      state.toolCalls++;
      const progressed = applyToolOutcome(state.plan, toolName, toolArgs, result.success);

      localTokensAccumulated += countTokens(result.output);
      // The prompt is resent in full every turn, so it dominates real cost.
      // Counting it is what makes MAX_RUN_TOKENS a meaningful ceiling.
      localTokensAccumulated += Math.round(this.estimateMessageTokens(this.history) / 10);

      const doneTask = progressed.changed && progressed.task && progressed.task.status === 'done' ? progressed.task : null;
      collab({
        stage: 'executing',
        title: doneTask ? `✓ Task ${doneTask.id}: ${doneTask.title.slice(0, 60)}` : `Executed: ${toolName}`,
        message: doneTask
          ? `${toolName} on ${target || 'workspace'} completed checklist task ${doneTask.id}`
          : `Processed ${toolName} ${isHybrid ? 'on local RTX 5090' : 'locally on RTX 5090'}`
      });
      return 'ok';
    };

    // ---- verification gate ----------------------------------------------
    /**
     * Runs the project's own verification after the worker edits files and
     * feeds a compact error list back as the next instruction. This is the
     * single biggest quality lever for a local model: it turns "I updated the
     * function" into "tsc says line 42 is not assignable, fix it".
     */
    const runVerificationGate = async (feedback: boolean): Promise<{ ran: boolean; passed: boolean }> => {
      if (!gateEnabled || state.editsSinceVerify === 0 || state.edited.size === 0 || signal.aborted) {
        return { ran: false, passed: true };
      }
      const changed = [...state.edited.values()].map(e => e.path);
      const cmds = chooseVerifyCommands(projectProfile, changed);
      if (!cmds.length) return { ran: false, passed: true };

      state.verifyRounds++;
      state.editsSinceVerify = 0;
      this.send('agent:status', { state: 'executing' });
      collab({
        stage: 'executing',
        title: `Verification Gate (round ${state.verifyRounds})`,
        message: `Running ${cmds.map(c => `\`${c}\``).join(' ; ')} against ${changed.length} changed file(s)`
      });

      const results: VerifyRun[] = [];
      for (const cmd of cmds) {
        if (signal.aborted) break;
        const id = `gate_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`;
        this.send('agent:tool-start', { id, name: 'run_command', args: { command: cmd, gate: true }, autoMode: true });
        const r = await this.tools.runCommand(cmd, 150000);
        this.send('agent:tool-finish', { id, name: 'run_command', success: r.success, output: r.output });
        results.push({ command: cmd, success: r.success, output: r.output });
        if (!r.success) break; // the first failure has to be fixed before the rest means anything
      }
      const passed = results.length > 0 && results.every(r => r.success);
      state.verifyReports.push({ round: state.verifyRounds, results, passed });

      if (passed) {
        notice(`✅ Verification gate passed: ${results.map(r => `\`${r.command}\``).join(', ')}`);
      } else {
        const failed = results.find(r => !r.success);
        const compact = compactVerifyOutput(failed?.output || '');
        if (feedback && failed) {
          this.history.push({
            role: 'user',
            content: `[VERIFICATION GATE — FAILED]\nThe engine ran \`${failed.command}\` after your edits and it failed:\n${compact}\n\nFix the errors above in the files you changed (use search_codebase / read_file with startLine to see the exact lines), then continue. Do not explain; call the tool.`
          });
        }
        notice(`❌ Verification gate failed on \`${failed?.command}\`${feedback ? ` — sending the errors back to the worker (round ${state.verifyRounds}/2)` : ''}.`);
      }
      return { ran: true, passed };
    };

    // ---- continuation controller -----------------------------------------
    /**
     * Called when the model returned no tool calls - the point where the old
     * loop simply ended. Decides whether the run is REALLY finished:
     *   1. edits pending verification -> run the gate; failures go back to the model
     *   2. the model narrated an action it did not take -> tell it to take it
     *   3. checklist tasks still open after real tool work -> ask it to finish or account for them
     * Every branch is bounded so a confused model cannot loop forever.
     */
    const shouldContinue = async (responseContent: string): Promise<boolean> => {
      if (signal.aborted) return false;
      applyCompletionClaims(state.plan, responseContent);
      if (detectCompletionClaim(responseContent)) {
        closeTasksClaimedDone(state.plan, [...state.edited.values()].map(e => e.path));
      }

      if (state.editsSinceVerify > 0 && state.verifyRounds < 2) {
        const gate = await runVerificationGate(true);
        if (gate.ran && !gate.passed) return true;
      }

      const codingRun = taskMode === 'coding' || !!state.plan;
      if (!codingRun) return false;

      if (detectNarratedIntent(responseContent) && state.intentNudges < 2) {
        state.intentNudges++;
        this.history.push({
          role: 'user',
          content: '[CONTINUATION] You described the next action but did not call a tool. Call it now (search_codebase / read_file / edit_file / write_file / run_command). Do not restate the plan.'
        });
        notice(`↻ Worker described an action without executing it — nudging (${state.intentNudges}/2).`);
        return true;
      }

      if (state.plan && state.toolCalls > 0 && state.nudges < 3) {
        const pending = pendingTasks(state.plan).filter(t => t.kind !== 'inspect');
        const key = pending.map(t => t.id).join(',');
        if (pending.length && key !== state.lastNudgeKey) {
          state.nudges++;
          state.lastNudgeKey = key;
          this.history.push({
            role: 'user',
            content: `[CONTINUATION] You stopped, but the checklist is not finished:\n${renderChecklist(state.plan, { withGoal: false })}\n\nFor each remaining task: either do it now by calling the next tool, or - if it is already complete or not needed - reply with one line per task in the form "TASK <n> DONE: <one-line evidence>" or "TASK <n> SKIP: <reason>". Do not restate the plan.`
          });
          notice(`↻ ${pending.length} checklist task(s) still open — asking the worker to finish or account for them (${state.nudges}/3).`);
          return true;
        }
      }
      return false;
    };

    // ---- the worker loop --------------------------------------------------
    const workerLoop = async (maxTurnsThisLoop: number): Promise<void> => {
      let looping = true;
      let turnsThisLoop = 0;
      while (looping && turnsThisLoop < maxTurnsThisLoop && turnCount < MAX_TURNS && !signal.aborted) {
        if (cloudTokensAccumulated + localTokensAccumulated >= MAX_RUN_TOKENS) {
          budgetExhausted = true;
          break;
        }
        turnCount++;
        turnsThisLoop++;
        this.send('agent:status', { state: 'thinking', turn: turnCount });

        try {
          let effectiveModel = isHybrid ? workerModel : model;

          // VRAM-aware local routing. Only engages for local providers; cloud
          // providers are never re-routed.
          if (activeProvider === 'ollama' || this.isPort8080Model(effectiveModel)) {
            try {
              const routed = await this.resolveLocalWorker(effectiveModel);
              if (routed.notice) arbiterNotice(routed.notice);
              if (routed.model !== effectiveModel) {
                effectiveModel = routed.model;
                if (isHybrid) workerModel = routed.model;
              }
            } catch {
              // Arbiter is best-effort; never block a turn on it.
            }
          }

          const res = await callWorker(effectiveModel);
          let responseContent = res.content;
          let toolCalls = res.toolCalls;
          const wasStreamed = res.streamed;

          // Calls that arrived as text rather than structured tool_calls.
          if (toolCalls.length === 0 && responseContent) {
            const embedded = extractEmbeddedToolCalls(responseContent);
            if (embedded.calls.length) {
              toolCalls = embedded.calls;
              responseContent = embedded.stripped;
            }
          }

          const assistantMsg: AgentMessage = {
            role: 'assistant',
            content: responseContent,
            tool_calls: toolCalls.length ? toolCalls : undefined
          };

          if (responseContent && !wasStreamed) {
            this.send('agent:status', { state: 'responding', turn: turnCount });
            ensureWorkerBubble(effectiveModel);
            this.send('agent:token', { token: responseContent, ...workerSender(effectiveModel) });
          }

          this.history.push(assistantMsg);
          if (responseContent && isHybrid) {
            this.writeLiveDialogue('WORKER', 'Local Worker Execution', responseContent);
          }
          localTokensAccumulated += countTokens(responseContent);

          if (toolCalls.length > 0) {
            for (const call of toolCalls) {
              if (signal.aborted) break;
              const outcome = await executeToolCall(call, effectiveModel);
              if (outcome === 'halt') break;
            }

            // Inspection budget. A run that has only read and searched for this
            // many calls, with nothing written, is circling. The next turn runs
            // without tools so the model has to produce the answer.
            const inspectionLimit = advisoryRun ? 10 : 18;
            if (!state.forceAnswer && state.edited.size === 0 && state.toolCalls >= inspectionLimit) {
              state.forceAnswer = true;
              this.history.push({
                role: 'user',
                content: `[CONTINUATION] Inspection budget reached: ${state.toolCalls} tool calls and no output yet. Tools are disabled for your next reply. Write your answer NOW from what you have already read: concrete findings with file and line references, what is wrong, what to change, in priority order. ${advisoryRun ? 'Do not propose to inspect further.' : 'If a file change is still required, state exactly which edit you would make and why; the user can ask you to apply it.'}`
              });
              notice(`⏹ Inspection budget reached (${state.toolCalls} tool calls, nothing produced) — tools off for the next turn so the worker must answer.`);
              continue;
            }

            // Post-completion guard. Once every edit/run task on the checklist
            // is closed, further tool calls are exploration, not work. Nudge
            // once, then end the run with an engine summary rather than let
            // the worker list node_modules until the token budget is gone.
            if (state.plan) {
              const openWork = state.plan.tasks.filter(t => t.status !== 'done' && (t.kind === 'edit' || t.kind === 'run'));
              if (openWork.length === 0) {
                state.postDoneCalls += toolCalls.length;
                if (state.postDoneCalls >= 10) {
                  const files = [...state.edited.values()].map(e => e.path);
                  const summary = `DONE (engine summary): every checklist task is complete but the worker kept exploring, so the run was ended here. Files changed: ${files.length ? files.join(', ') : 'none'}.`;
                  ensureWorkerBubble(effectiveModel);
                  this.send('agent:token', { token: `\n\n${summary}`, ...workerSender(effectiveModel) });
                  this.history.push({ role: 'assistant', content: summary });
                  notice(`⏹ Ended the worker loop: all checklist tasks were complete ${state.postDoneCalls} tool calls ago.`);
                  looping = false;
                  break;
                }
                if (state.postDoneCalls >= 4 && !state.postDoneNudged) {
                  state.postDoneNudged = true;
                  this.history.push({
                    role: 'user',
                    content: `[CONTINUATION] Every checklist task is complete. Stop exploring the workspace - do not run more listing or inspection commands. Reply now with "DONE:" followed by the files you changed and how they were verified.`
                  });
                  notice(`↻ All checklist tasks are complete but the worker is still exploring — asking it to wrap up.`);
                }
              }
            }
            continue;
          }

          // No tool calls: is the run really finished?
          const goOn = await shouldContinue(responseContent);
          if (goOn) continue;

          if (responseContent) {
            collab({
              stage: 'verified',
              title: 'Response Complete',
              message: isHybrid
                ? 'Completed by local worker on RTX 5090'
                : `Completed on RTX 5090 (${localTokensAccumulated.toLocaleString()} local tokens)`
            });
          }
          looping = false;
        } catch (err: any) {
          if (signal.aborted) {
            this.send('agent:status', { state: 'stopped' });
          } else {
            const userFriendlyMsg = `\n\n*(Notice: ${err.message || 'The model was unable to complete the request. Please check that your model server is running.'})*`;
            this.send('agent:token', { token: userFriendlyMsg, model });
            this.send('agent:error', err.message || 'Unknown agent error');
          }
          looping = false;
        }
      }
      if (turnCount >= MAX_TURNS) hitTurnLimit = true;
    };

    // =========================================================================
    // DUAL-BRAIN TURN 1: STRUCTURED BLUEPRINT (BRAIN 1 • GENERAL MODEL)
    //
    // The architect now returns a fixed markdown shape that the engine parses
    // into a checklist. The worker receives the checklist as a USER directive
    // (never an assistant turn that then has to be re-roled), plus the same
    // grounding the architect saw, so both brains reason from identical facts.
    // =========================================================================
    if (isHybrid && hybridPlan && !hybridPlan.useArchitect) {
      collab({
        stage: 'executing',
        title: advisoryRun
          ? 'Direct Worker — Analysis Request (answer in chat, no file changes)'
          : /question/.test(hybridPlan.reason) ? 'Direct Worker — Question' : 'Direct Worker Execution — Mechanical Task',
        message: `${hybridPlan.reason}. Running entirely on the RTX 5090 ($0.00 cost).`
      });
      activeProvider = 'ollama';
    } else if (isHybrid) {
      this.send('agent:status', { state: 'thinking', turn: 1 });
      collab({
        stage: 'plan',
        activeRole: 'architect',
        title: `Strategic Planning Phase (${hybridTier.toUpperCase()})`,
        message: `${architectLabel} • ${hybridTier.toUpperCase()} — reading the workspace and formulating the blueprint...`
      });

      try {
        const taskBudget = hybridTier === 'low' ? '2-3 tasks, under 120 words total'
          : hybridTier === 'high' ? '4-8 tasks, each with function/contract-level detail, and an explicit verification task'
          : '3-6 tasks';
        const tierProtocol = `COLLABORATIVE ARCHITECTURE PROTOCOL (${hybridTier.toUpperCase()} TIER):
You are the Lead Architect (Brain 1 • ${architectModel}) running locally on the user's NVIDIA RTX 5090, planning for the Specialist Coder Worker (Brain 2 • ${workerModel}). You do NOT execute tools; the worker does. You have the real workspace facts below - use those exact paths and line numbers, never invented ones.

Respond in EXACTLY this markdown structure and nothing else:
## Goal
<one sentence>
## Tasks
1. <imperative title> — files: <real/path.ext, ...> — done when: <observable criterion>
2. ...
## Verify
- \`<command>\` (use the project's verify command from the profile when one exists)
## Risks
- <one line each; omit the section if none>

Rules: ${taskBudget}. Every edit task names its file(s). If the WORKSPACE CONTEXT already pins down the exact lines, the first task is the edit itself - do not add a "read the file" task. Prefer edit_file over rewriting files. If the request asks for a design, architecture, plan, proposal or document, the deliverable is ONE NEW file the worker creates with write_file (e.g. docs/<topic>.md) - make that an explicit task with the path; inspection alone never completes such a request, and do NOT add implementation tasks the user did not ask for (a design request is done when the document is written). NEVER plan to overwrite or "update" existing documentation or source files the user did not name - existing docs are reference material, not the deliverable. Verify a document with a line count (e.g. \`(Get-Content docs/x.md).Count\`), never by printing it. You have no tools: never write "let me inspect" - plan from the facts above. No prose outside the sections, no code blocks except commands.`;

        // Read the workspace BEFORE planning, locally and for free.
        const grounding = await this.buildWorkspaceGrounding(editorContext, { profile: projectProfile, retrievalBlock });
        const historyForPlan = this.history
          .filter(m => m.role !== 'system')
          .map((m, i, arr) => {
            // The latest user prompt already carries the retrieval block; the
            // grounding above includes it, so send it once.
            if (i === arr.length - 1 && m.role === 'user' && retrievalBlock && m.content.includes(retrievalBlock)) {
              return { ...m, content: m.content.replace(retrievalBlock, '').trimEnd() };
            }
            return m;
          });
        const planMessages: AgentMessage[] = [
          {
            role: 'system',
            content: `${this.history[0]?.content || ''}\n\n${tierProtocol}${grounding ? `\n\n${grounding}` : ''}`
          },
          ...historyForPlan
        ];

        const tierTag = hybridTier === 'low' ? ' • LOW' : hybridTier === 'high' ? ' • HIGH' : ' • MED';
        const blueprintHeader = (m: string) => `### 🧠 Local Architect (Brain 1 • ${m}${tierTag}) ➔ @Local Coder Worker\n\n`;
        const planOpts = { prompt, verifyCommand: projectProfile.verifyCommands[0] };
        const planRes = await callArchitectStreaming(
          planMessages,
          architectModel,
          `Local Coder Worker (${workerModel})`,
          blueprintHeader,
          { think: architectShouldThink('plan') }
        );
        if (architectModel === 'local') architectModel = planRes.modelUsed;
        let planContent = planRes.content.trim();
        localTokensAccumulated += countTokens(planContent);
        let plan = parseBlueprint(planContent, 12, planOpts);

        // The architect has no tools, but a coder model asked to plan will
        // happily answer "Let me inspect the key files first" and stop. One
        // firm retry with the facts it already has fixes that most of the time.
        if (plan.synthesized && !signal.aborted) {
          notice(`↻ Architect returned no task list (it tried to inspect instead of plan) — asking again with the workspace facts it already has.`);
          const retryMessages: AgentMessage[] = [
            ...planMessages,
            ...(planContent ? [{ role: 'assistant' as const, content: planContent }] : []),
            {
              role: 'user' as const,
              content: `You have NO tools and cannot inspect anything - the worker does that. Using ONLY the PROJECT PROFILE and WORKSPACE CONTEXT already given, write the blueprint NOW in the required structure: ## Goal, ## Tasks (numbered, each with files), ## Verify. If the request asks for a design, plan, proposal or document, the deliverable is a file the worker creates with write_file (e.g. docs/<topic>.md) - make that an explicit task. No preamble, no questions.`
            }
          ];
          try {
            const retry = await callArchitectStreaming(
              retryMessages,
              architectModel,
              `Local Coder Worker (${workerModel})`,
              () => `**Blueprint (second attempt):**\n\n`,
              { think: architectShouldThink('plan') }
            );
            const retryContent = retry.content.trim();
            localTokensAccumulated += countTokens(retryContent);
            const plan2 = retryContent.length >= 30 ? parseBlueprint(retryContent, 12, planOpts) : null;
            if (plan2 && !plan2.synthesized) {
              plan = plan2;
              planContent = retryContent;
            }
          } catch (retryErr: any) {
            console.warn('[Dual-Brain] Architect retry failed:', retryErr?.message);
          }
        }

        if (plan.synthesized) {
          // Show the worker (and the user) the checklist the engine will hold it to.
          const fallbackText = `## Goal\n${plan.goal}\n## Tasks\n${plan.tasks.map(t => `${t.id}. ${t.title}${t.files.length ? ` — files: ${t.files.join(', ')}` : ''}${t.doneWhen ? ` — done when: ${t.doneWhen}` : ''}`).join('\n')}${plan.verify.length ? `\n## Verify\n${plan.verify.map(v => `- \`${v}\``).join('\n')}` : ''}`;
          emitArchitectToken(`\n\n**Engine-synthesized checklist** (the architect did not return a task list):\n${fallbackText}`, `Local Coder Worker (${workerModel})`, planRes.modelUsed);
          planContent = `${planContent}\n\n${fallbackText}`.trim();
        }

        state.plan = plan;
        const checklist = renderChecklist(plan);
        const footnote = `\n\n---\n*Checklist: ${plan.tasks.length} task(s)${plan.synthesized ? ' (synthesized — the architect returned no task list)' : ''}, tracked by the engine. @Local Coder Worker: execute in order.*`;
        emitArchitectToken(footnote, `Local Coder Worker (${workerModel})`, planRes.modelUsed);
        this.writeLiveDialogue('ARCHITECT', 'Architect Blueprint', `${blueprintHeader(planRes.modelUsed)}${planContent}${footnote}`);

        this.history.push({
          role: 'user',
          content: `[LEAD ARCHITECT DIRECTIVE — Brain 1 (${planRes.modelUsed})]\n${planContent}\n\n[ENGINE CHECKLIST]\n${checklist}\n\n[WORKER EXECUTION RULES]\n1. Start with task 1 immediately by calling a tool. Do not restate, summarize, or thank.\n2. Use search_codebase before reading whole files; read only the ranges you need. Inspection is preparation, not the deliverable - after at most 3-4 inspection calls, produce the output.\n3. If a task says write a document or file, create it with write_file - a design or plan is only done when the file exists on disk. Never overwrite an existing file the user did not name; write_file will refuse to replace a file you have not read this run.\n4. After edits, the engine's verification gate runs the verify command(s) and reports failures to you - fix them. Do not print whole files (cat / Get-Content) to verify; use a line count.\n5. When every task is done, STOP and reply "DONE:" with the files changed and how they were verified. Do not keep exploring the workspace after the checklist is complete.`
        });

        collab({
          stage: 'plan',
          activeRole: 'architect',
          title: `Local Blueprint Formulated (${hybridTier.toUpperCase()}) — ${plan.tasks.length} tasks`,
          message: `Local Architect (${planRes.modelUsed}) produced a ${plan.tasks.length}-task checklist. Local execution beginning on RTX 5090 ($0.00 cost).`
        });

        // Switch to local execution on subsequent turns
        activeProvider = 'ollama';
      } catch (planErr: any) {
        const errorMsg = `⚠️ **Local Architect Notice**: Architect blueprint generation failed (${planErr.message || 'unknown error'}). Continuing directly with Local Coder Worker (\`${workerModel}\`).`;
        notice(errorMsg);
        this.writeLiveDialogue('ARCHITECT', 'Architect Notice', `> ${errorMsg}\n`);
        collab({
          stage: 'fallback',
          title: 'Direct Local Execution Active',
          message: `Directly running locally on RTX 5090 (${workerModel}) ($0.00 cost)!`
        });
        activeProvider = 'ollama';
      }
    }

    // =========================================================================
    // WORKER EXECUTION
    // =========================================================================
    await workerLoop(MAX_TURNS);

    if (budgetExhausted && !signal.aborted) {
      const usedK = Math.round((cloudTokensAccumulated + localTokensAccumulated) / 1000);
      this.send('agent:token', {
        token: `\n\n*(Reached the ${Math.round(MAX_RUN_TOKENS / 1000)}K token budget for a single run — about ${usedK}K used across ${turnCount} turns. Stopping here rather than looping further. Ask me to continue if the work is unfinished.)*`,
        model
      });
    } else if (hitTurnLimit && !signal.aborted) {
      this.send('agent:token', {
        token: '\n\n*(Reached maximum automated steps limit. If you need more work done, please let me know to continue.)*',
        model
      });
    }

    // =========================================================================
    // DUAL-BRAIN TURN 3: EVIDENCE-BASED REVIEW (BRAIN 1)
    //
    // The architect used to "verify" from the worker's own description of what
    // it did, and it always approved. It now sees the actual diffs, the
    // verification gate's results, and the checklist state - and it can send
    // the worker back once with concrete issues.
    // =========================================================================
    const architectReview = async (): Promise<void> => {
      this.send('agent:status', { state: 'thinking' });
      collab({
        stage: 'verified',
        activeRole: 'architect',
        title: `Architect Reviewing Evidence (${hybridTier.toUpperCase()})`,
        message: `${architectModel} is reviewing the diffs and verification results...`
      });

      const editedRecords = [...state.edited.values()];
      const diffs = editedRecords.map(e => summarizeDiff(e.path, e.oldContent, e.newContent));
      const diffText = diffs.length
        ? diffs.map(d => `• ${d.path}: +${d.added} / -${d.removed} lines (unified diff: ' ' context, '-' removed, '+' added)\n${d.excerpt.split('\n').map(l => `    ${l}`).join('\n')}`).join('\n')
        : 'No files were modified.';
      // Small changed files are shown whole: a reviewer reasons far better
      // from the actual current file than from a hunk, and it is cheap.
      const fullFiles = editedRecords
        .filter(e => e.newContent && e.newContent.split('\n').length <= 150)
        .slice(0, 4)
        .map(e => `--- ${e.path} (current content, ${e.newContent.split('\n').length} lines) ---\n${e.newContent.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n')}`)
        .join('\n\n');
      const gateText = state.verifyReports.length
        ? state.verifyReports.map(r => {
            const line = `round ${r.round}: ${r.results.map(x => `${x.success ? 'PASS' : 'FAIL'} \`${x.command}\``).join(', ')}`;
            if (r.passed) return line;
            const failed = r.results.find(x => !x.success);
            return `${line}\n    ${compactVerifyOutput(failed?.output || '', 12, 1200).split('\n').join('\n    ')}`;
          }).join('\n')
        : (state.edited.size ? 'No verification command was available for this project.' : 'Nothing to verify (no edits were made).');
      const checklistText = state.plan ? renderChecklist(state.plan) : '(no checklist)';
      const workerFinal = [...this.history].reverse().find(m => m.role === 'assistant' && m.content && !m.content.startsWith('### 🧠'))?.content || '';
      const originalRequest = (this.history.find(m => m.role === 'user')?.content || '')
        .replace(/\[WORKSPACE CONTEXT[^\]]*\][\s\S]*?\[\/WORKSPACE CONTEXT\]/g, '')
        .replace(/\[ATTACHED FILE CONTEXT:[\s\S]*?\[\/ATTACHED FILE CONTEXT\]/g, '[attached file omitted]')
        .trim()
        .slice(0, 2000);

      const verifyProtocol = `COLLABORATIVE VERIFICATION PROTOCOL (${hybridTier.toUpperCase()} TIER):
You are the Lead Architect (Brain 1 • ${architectModel}) running locally on the user's NVIDIA RTX 5090. You gave the blueprint to the local coder worker (${workerModel}). Review the EVIDENCE below - the actual diffs and verification results - not the worker's description of its work.

Respond in EXACTLY this structure:
VERDICT: APPROVE   (or)   VERDICT: REVISE
## Issues
- <file:line — concrete problem>   (write "- none" if there are none)
## Next Steps
- <what the worker must do>   (only when REVISE)
## Summary
<2-4 sentences for the user: what changed, whether it verified, anything left>

Rules of evidence:
- The verification gate is authoritative. If it PASSED, the code compiles and typechecks: do NOT report syntax errors, unclosed braces, missing exports, or unresolved imports.
- Diffs are unified format: lines starting with '-' no longer exist, '+' lines are the new code, ' ' lines are unchanged context. When the current content of a file is shown, judge from that, not from the diff.
- A checklist task marked [x] with evidence is done. Do not invent requirements that are not in the original request.
Say REVISE only for a real defect visible in the evidence: a failed verification, an unfinished checklist task that matters, or an edit that is wrong or incomplete against the request. Never REVISE for style or for things you merely cannot see. Be concise.`;

      const verifyMessages: AgentMessage[] = [
        { role: 'system', content: verifyProtocol },
        {
          role: 'user',
          content: `### Original User Request\n${originalRequest}\n\n### Checklist State\n${checklistText}\n\n### Verification Gate\n${gateText}\n\n### Diffs Applied by the Worker\n${diffText}${fullFiles ? `\n\n### Current Content of Changed Files\n${fullFiles}` : ''}\n\n### Worker's Final Message\n${(workerFinal || '(none)').slice(0, 3000)}\n\nNow give your verdict.`
        }
      ];

      const verifyHeader = (m: string) => `### 🧠 Local Architect Verification (${m}) ➔ @User & @Local Coder Worker\n\n`;
      let reviewModel = architectModel;
      let verifyContent = '';
      try {
        const res = await callArchitectStreaming(verifyMessages, architectModel, 'User & Local Coder Worker', verifyHeader, { think: architectShouldThink('review') });
        verifyContent = res.content.trim();
        reviewModel = res.modelUsed;
        localTokensAccumulated += countTokens(verifyContent);
      } catch (err: any) {
        console.warn('[Dual-Brain] Verification call failed:', err?.message);
      }

      const lastGateFailed = state.verifyReports.length > 0 && !state.verifyReports[state.verifyReports.length - 1].passed;
      if (!verifyContent || verifyContent.length < 20) {
        verifyContent = lastGateFailed
          ? `VERDICT: REVISE\n## Issues\n- The verification gate is still failing (see above).\n## Next Steps\n- Fix the reported errors and re-run the verify command.\n## Summary\nThe worker edited ${state.edited.size} file(s) but the project does not verify cleanly yet.`
          : `VERDICT: APPROVE\n## Issues\n- none\n## Summary\n${state.edited.size ? `The worker edited ${state.edited.size} file(s)${state.verifyReports.length ? ' and the verification gate passed' : ''}.` : 'No files were changed; the worker answered directly.'}`;
        emitArchitectToken(verifyContent, 'User & Local Coder Worker', reviewModel);
      }

      const verdict = parseReviewVerdict(verifyContent);
      const needsRevise = (verdict.verdict === 'revise' || lastGateFailed)
        && state.reviewRounds < maxReviewRounds
        && !signal.aborted;

      const footer = `\n\n---\n*⚡ Pure Local Dual-Brain • 100% Offline ($0.00) • NVIDIA RTX 5090${needsRevise ? ' • sending the worker back for one revision round' : ''}*`;
      emitArchitectToken(footer, 'User & Local Coder Worker', reviewModel);
      const fullVerifyMsg = `${verifyHeader(reviewModel)}${verifyContent}${footer}`;
      this.history.push({ role: 'assistant', content: fullVerifyMsg });
      this.writeLiveDialogue('ARCHITECT', 'Architect Verification', fullVerifyMsg);

      if (!needsRevise) {
        collab({
          stage: 'verified',
          activeRole: 'architect',
          title: verdict.verdict === 'approve' && !lastGateFailed ? 'Task Verified (Local Dual-Brain • 100% Free)' : 'Review Complete — Issues Noted',
          message: `Local Architect (${reviewModel}) reviewed ${state.edited.size} changed file(s) and ${state.verifyReports.length} verification round(s). 100% local GPU execution, $0.00 cost.`
        });
        return;
      }

      state.reviewRounds++;
      const steps = [...verdict.nextSteps, ...verdict.issues].slice(0, 8);
      this.history.push({
        role: 'user',
        content: `[ARCHITECT REVIEW — REVISE (round ${state.reviewRounds}/${maxReviewRounds})]\n${steps.length ? steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : 'Fix the failed verification reported above.'}\n\nYou MUST act with tools in your next turn (write_file / edit_file / run_command). A text-only reply counts as no progress. When finished, reply "DONE:" with a summary.`
      });
      // The revision round gets a fresh continuation budget: the nudge keys
      // from the first pass would otherwise silence every reminder, and the
      // round could end three seconds later having done nothing.
      const toolCallsAtRevise = state.toolCalls;
      state.lastNudgeKey = '';
      state.nudges = Math.min(state.nudges, 1);
      state.intentNudges = Math.min(state.intentNudges, 1);
      collab({
        stage: 'escalate',
        activeRole: 'architect',
        title: `Architect Requested Revisions (${state.reviewRounds}/${maxReviewRounds})`,
        message: steps[0] ? steps[0].slice(0, 140) : 'Verification must pass before sign-off.'
      });

      await workerLoop(REVISE_TURNS);
      if (!signal.aborted) {
        const gate = await runVerificationGate(false);
        const stillFailing = gate.ran && !gate.passed;
        const didWork = state.toolCalls > toolCallsAtRevise;
        const signoff = !didWork
          ? `⚠️ Revision round ended without any tool calls - the worker replied in text only, so the architect's issues above are still open. Ask me to continue and I will start from the first one.`
          : stillFailing
            ? `⚠️ Revision round complete, but the verification gate is still failing. The remaining errors are shown above - ask me to continue and I will keep fixing them.`
            : `✅ Revision round complete${gate.ran ? ' and the verification gate passed' : ''}: ${state.edited.size} file(s) changed in total.`;
        notice(signoff);
        collab({
          stage: 'verified',
          activeRole: 'architect',
          title: !didWork ? 'Revision Round Made No Changes' : stillFailing ? 'Revisions Applied — Verification Still Failing' : 'Task Verified After Revision (Local Dual-Brain • 100% Free)',
          message: signoff
        });
      }
    };

    if (isHybrid && !signal.aborted) {
      const didWork = state.toolCalls > 0 || state.edited.size > 0;
      const reviewWanted = (hybridTier === 'medium' || hybridTier === 'high') && hybridPlan?.useArchitect !== false && didWork;
      if (reviewWanted) {
        try {
          await architectReview();
        } catch (verifyErr: any) {
          console.warn('Architect verification notice:', verifyErr.message);
          collab({
            stage: 'verified',
            title: `Task Completed (${hybridTier.toUpperCase()})`,
            message: 'Local RTX 5090 worker delivered the solution; the architect review could not run.'
          });
        }
      } else {
        const directRun = hybridPlan?.useArchitect === false;
        collab({
          stage: 'verified',
          title: directRun
            ? (advisoryRun ? 'Analysis Delivered' : 'Response Complete')
            : didWork ? `Task Completed (${hybridTier.toUpperCase()})` : 'Response Complete',
          message: directRun
            ? `Answered directly by the local worker on RTX 5090 (${state.toolCalls} inspection call(s), ${state.edited.size} file(s) changed).`
            : didWork
              ? 'Local RTX 5090 worker delivered the solution based on the architect directive.'
              : 'Answered directly by the local worker on RTX 5090 (no edits, so no review round).'
        });
      }
    } else if (!isHybrid && !signal.aborted && localTokensAccumulated > 0) {
      collab({
        stage: 'verified',
        title: 'Local Execution Complete',
        message: `Task completed 100% locally on NVIDIA RTX 5090${state.verifyReports.length ? ` • verification ${state.verifyReports[state.verifyReports.length - 1].passed ? 'passed' : 'failed'}` : ''}`
      });
    }

    this.send('agent:status', { state: 'idle' });
  }
}
