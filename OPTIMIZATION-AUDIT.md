# Strata Code + Local Inference — Optimization Audit
**Date:** 2026-09-10 · **Scope:** `D:\AntiGravity\strata`, `D:\AntiGravity\local-code-studio`, `C:\AI_dev\llama.cpp`

Backups of every file touched are in `backup-2026-09-10\` next to the originals.

---

## Part 1 — Applied

### Local inference (`C:\AI_dev\llama.cpp`)

| Change | Why |
|---|---|
| `--jinja` added to both launch scripts | llama-server needs the model's native Jinja template to render OpenAI-style `tools` into the prompt and parse tool calls back out. Without it, Strata's 5-tool schema was being handled by the generic fallback template. |
| `-c 32768` → `-c 65536` (param: `-Ctx`) | Qwen3-30B-A3B has 4 KV heads × 128 dim × 48 layers → **~51 KB/token** at q8_0. 64K KV = ~3.3 GB. Weights (~22 GB) + KV + compute lands near 26 GB of 32 GB. Doubles usable history. |
| `-b 4096 -ub 1024` | Default ubatch is 512. Prefill, not generation, is the bottleneck for an agent that resends a long history every turn. |
| `--cache-reuse 256` | History compaction rewrites *middle* messages, which invalidates the KV prefix cache and forces a full reprocess of ~20K tokens every turn. This lets the server salvage blocks after the edit point. |
| `--temp 0.7 --top-p 0.8 --top-k 20 --repeat-penalty 1.05` | Qwen3-Coder model-card values. |
| `--metrics` | Enables `/metrics` for real throughput monitoring. |
| Port-in-use guard on launch | Prevents two servers silently fighting over the same 32 GB. |
| **8081:** `--flash-attn` → `--flash-attn on` | Current llama.cpp builds require the explicit value; bare `--flash-attn` fails to parse. The 8081 script could not start. Also added q8_0 KV cache to match 8080. |
| **stop-server:** `taskkill /F /IM llama-server.exe` → kill by port | The old script killed **every** llama-server, including the 8081 reasoning server. New `stop-server.ps1 -Port N` targets only the listener on that port. |
| **benchmark:** rewritten | Two bugs: `$res` was assigned *inside* a `Measure-Command` block, which runs in a child scope — so `$res` was always `$null` afterward and the whole results section was dead. And wall-clock timing counted prefill as generation. Now reads llama.cpp's own `timings` block, which separates `prompt_per_second` from `predicted_per_second`. |

> The reported **237 tok/s** came from the old script's `completion_tokens / wall_clock`, so it *understates* real generation speed. Re-run `benchmark-8080.ps1` for the true split.

### Agent engine (`electron/agent.ts`)

1. **Token IPC coalescing.** `send('agent:token')` fired once per token — ~237 IPC messages/sec, each carrying 5 constant metadata fields, each triggering a React commit. Tokens are now merged into one message per 40 ms window (~25/sec). Any non-token event flushes the buffer first, so ordering is exact and no token is lost. *Verified: lossless reassembly + preserved event ordering across speaker changes.*
2. **Token estimator counted only `content`.** A `write_file` call carries the entire file body in `tool_calls[].function.arguments` — scored as **zero tokens**. The context guard could report "under budget" right up to the moment the request overflowed. Now counts tool-call arguments and image payloads, at 3 chars/token (was 3.5, optimistic for source code).
3. **Orphaned tool messages after the emergency sliding window.** Pass 4 kept "system + first user + last 6", which routinely cut an assistant `tool_calls` message away from its `tool` results. OpenAI-compatible servers reject that with **HTTP 400** — which the auto-heal path then misread as a context overflow, pruned harder, and hit again. A long session could fail permanently. Added a repair pass that drops dangling results and strips unanswered calls. *Verified against 4 sequence shapes.*
4. **Pass 1 compacted the current turn's own tool results.** Only the single last tool message was kept pristine; a turn with parallel tool calls had the rest compacted before the model ever read them. Now every tool result after the last user message is preserved.
5. **Context budget is now read from the server.** `getLocalContextBudget()` queries `/props` once, reads the real `n_ctx`, and reserves 65% for history. Raising `-c` on the launch script now widens usable history automatically instead of leaving it pinned at the hardcoded 22,000.
6. **Sampling for port 8080** set to model-card values (was `temperature: 0.2`, no `top_k`). Running an MoE coder that cold is a classic repetition-loop trigger — plausibly part of what the architect-directive sanitizer was working around. Plus `max_tokens: 8192` so one runaway generation can't eat the window.
7. **Ollama `num_ctx` pinned to 16384.** It was flipping between 8192 and 16384 based on prompt size — and **Ollama reloads the model from scratch whenever `num_ctx` changes**, costing a full reload mid-conversation. Added `num_predict: 4096`.
8. **`writeLiveDialogue` was `fs.appendFileSync`** on the main process — a blocking disk write per worker turn and per tool execution, stalling all IPC. Now async and serialized through a promise queue.
9. **Auto-heal narrowed.** Any HTTP 400 was retried as if it were a context error, masking real failures (bad tool schema, malformed sequence). Now inspects the error text and also covers 413/500.

### Tools (`electron/tools.ts`)

1. **`edit_file` silently corrupted content.** `normOld.replace(normTarget, normReplacement)` — with a *string* replacement, JS interprets `$&`, `$1`, `` $` `` and `$'` as capture patterns. Any generated code containing those (regex literals, PowerShell/shell variables, sed scripts) was mangled on write. Now uses a function replacer. **This is the highest-severity bug found.**
2. `edit_file` now warns when the target block appears more than once — only the first was ever replaced, silently editing the wrong site.
3. **`run_command` switched to `execFile` with `-NoProfile -NonInteractive`.** Loading your PowerShell profile cost ~0.3–1 s on *every* agent tool call. `-NonInteractive` makes input-waiting commands fail fast instead of hanging to the 60 s timeout.
4. `list_files` capped at 600 entries and given a wider ignore set (`.next`, `venv`, `__pycache__`, `target`, `coverage`, …). An unbounded scan was the easiest way to blow the context in a single call.

### Electron shell (`electron/main.ts`)

1. **`backgroundThrottling: false`.** Chromium throttles timers and rAF to ~1 Hz in unfocused windows — alt-tabbing away during a long agent run froze the token stream and elapsed counter.
2. **`sandbox: true`.** `preload.cjs` only requires `electron`, so the OS sandbox costs nothing here.
3. **`terminal:run-command` had no timeout.** A command waiting on input left the promise pending forever and the terminal drawer stuck. Now 120 s with a clear `[TIMEOUT]` marker, and `-NoProfile`.

### Frontend (`src/components/ChatPanel.tsx`)

1. `FormattedContent` re-ran its full code-fence regex over the whole message body **on every token, for every message on screen** — O(n²) as a response grows. Memoized on `content`.
2. `CodeBlock` wrapped in `React.memo` — every code block in the transcript was re-rendering per token.
3. Autoscroll read `scrollHeight` then wrote `scrollTop` per token: a forced synchronous layout ~237×/sec. Now coalesced into a single `requestAnimationFrame`.

---

## Part 2 — Not applied (needs your call)

### 1. `ToolExecutor.resolvePath` has no workspace containment — **security**
```ts
resolvePath(t) { if (path.isAbsolute(t)) return t; return path.join(this.workspaceDir, t); }
```
Any absolute path is accepted, and relative paths can `..` out. In auto-mode the agent can write anywhere on the drive. I left it alone because your mirror workflow may deliberately write across `strata` ↔ `local-code-studio`. The fix is a `path.relative` check against an allow-list of roots rather than a single workspace.

### 2. Ollama and llama-server both fully offload to the same 32 GB
`qwen3.8:27b` dense (~17 GB) + Qwen3-Coder Q6_K (~22 GB) cannot co-reside. In hybrid mode a quota fallback switches `activeProvider` to `'ollama'` mid-run, so both can end up loaded. Consider `OLLAMA_KEEP_ALIVE=30s` (env var, or `setx`) so Ollama releases VRAM promptly, or move the general model onto port 8081 and drop Ollama from the hot path entirely.

### 3. `preload.ts` and `preload.cjs` have drifted
`preload.cjs` is what actually ships (the build script copies it over the compiled output). `preload.ts` is missing `gemini:calibrate-quota` and is dead weight compiled on every build. Pick one — deleting `preload.ts` and dropping it from `vite.config.ts` is the smaller change.

### 4. `disable-gpu-shader-disk-cache`
This forces a full shader recompile on every launch. If it was added to work around a cache-corruption crash, a better fix is a versioned `app.setPath('userData', …)`.

### 5. `MAX_TURNS = 25` with no token ceiling
A runaway loop can burn 25 full-context turns. Consider a cumulative token budget per run alongside the turn count.

### 6. `C:\AI_dev\projects\strata` backup archive not synced
I only had access to `C:\AI_dev\llama.cpp`, so that mirror still holds the pre-audit code. `D:\AntiGravity\local-code-studio` **was** synced (it was byte-identical).

---

## Next step

```powershell
cd D:\AntiGravity\strata
npm run build
```
The changes typecheck clean against a baseline diff of the originals, but `tsc` in your tree is the real gate. Then restart the server:

```powershell
C:\AI_dev\llama.cpp\stop-server-8080.bat
C:\AI_dev\llama.cpp\launch-server-8080.bat
C:\AI_dev\llama.cpp\benchmark-8080.ps1
```
If 64K context OOMs, dial back without editing anything:
```powershell
.\launch-server-8080.ps1 -Ctx 49152
```

---

## Part 3 — Round 2 (applied 2026-09-10)

Synced to all three trees: `D:\AntiGravity\strata`, `D:\AntiGravity\local-code-studio`, `C:\AI_dev\projects\strata`.

### VRAM contention — the local engine arbiter (`agent.ts`)

The failure mode is worse than an OOM. llama-server (~22 GB) and an Ollama 27B/32B (~17–20 GB) cannot co-reside in 32 GB, but on Windows the driver does **not** refuse — it spills the overflow into shared system memory over PCIe and generation collapses from ~200 tok/s to low single digits, with no error raised anywhere. It just looks like a hang, and nothing in the app could detect it.

Hybrid mode reached this constantly: after the architect turn, `activeProvider` was set to `'ollama'` unconditionally, and the default worker (`qwen2.5-coder:32b` / `qwen3.8:27b`) does not match `isPort8080Model`, so every hybrid run tried to force a second model onto a card llama-server was already holding.

Added:

- **`probeLocalEngines()`** — llama-server `/props`, Ollama `/api/ps`, and real free VRAM from `nvidia-smi`. Cached 10 s, single-flight.
- **`resolveLocalWorker()`** — runs before every local turn. If llama-server is resident and the requested Ollama model isn't loaded and won't fit, the turn is routed to the **already-resident** model instead, with a visible notice naming both models and the actual free/needed GB. Cloud providers are never re-routed.
- **`releaseOllamaVram()`** — evicts Ollama models (`keep_alive: 0`) when llama-server needs the card and Ollama is squatting on it.
- **`keep_alive: '30s'`** on every Ollama request when llama-server is up (`5m` otherwise). This is per-request, so it needs no system configuration.
- `isPort8080Model()` now also matches the server's **live alias** from `/props`, so renaming the model no longer breaks routing.
- Opt-out: `disableVramArbiter: true` in provider config.

> For Ollama's *own* background daemon behaviour outside Strata, also set the env var — the per-request `keep_alive` above only governs calls Strata makes:
> ```powershell
> setx OLLAMA_KEEP_ALIVE 30s
> ```
> Then restart the Ollama service. Per-request `keep_alive` overrides it either way.

### Workspace containment (`tools.ts`)

`resolvePath` returned any absolute path unchanged and relative paths could `..` out — an autonomous run could write anywhere the Electron process had rights.

Now enforced against an allow-list (`DEFAULT_ALLOWED_ROOTS = ['D:\AntiGravity', 'C:\AI_dev']`), plus whatever workspace is currently open, so opening a project elsewhere still works. Containment uses `path.relative`, not `startsWith` — `C:\AI_dev_evil` and `D:\AntiGravityOther` are correctly **blocked** as prefix-collision siblings, while all three mirror paths stay writable. Violations return a normal failed `ToolResult` the model can read and correct, rather than throwing. `run_command` additionally refuses to execute if the workspace itself has drifted outside the roots.

*Verified: 13 path cases, including traversal, absolute system paths, normalized `..` escapes, and prefix collisions.*

### Cumulative token budget (`agent.ts`)

`MAX_TURNS = 25` bounded turns, not cost — one turn can carry a 48K-token prompt. Added `MAX_RUN_TOKENS = 120000`, checked at the top of each turn, and the per-turn prompt cost now counts toward it (the history is resent in full every turn, so it dominates). Exhaustion produces a distinct message reporting tokens used and turns taken, instead of the generic step-limit text.

### Preload standardization

`preload.ts` removed from the `vite.config.ts` build and replaced with a documented no-op stub (`export {}`) — safe to delete outright. `preload.cjs` is now unambiguously the single source. Added `npm run typecheck`.

### Shader cache → versioned userData (`main.ts`)

Dropped `disable-gpu-shader-disk-cache`, which forced a full shader recompile on every launch to work around what is normally a one-off corrupt-cache problem. Replaced with `CACHE_SCHEMA_VERSION` on the userData root (`%APPDATA%\StrataCode-v1`); bumping it abandons stale caches wholesale. **`provider-config.json` is migrated automatically** from the legacy path on first launch, so API keys and quota stats are not lost.

### Also fixed

An unterminated `/**` block above `isPort8080Model` had been silently swallowing the doc comment beneath it. Harmless before — but it began eating real declarations as soon as code was added there, and would have done the same to anyone editing that region.

---

## Part 4 — Hybrid Intelligence Layer (applied 2026-09-10)

Hybrid mode previously made four decisions by hardcoding them. All four are now decided per-run, entirely from local heuristics — classification itself costs nothing.

### 1. Task classifier — `classifyTask()`

Scores a request 0–100 from the prompt and editor state alone: mechanical-edit and explanatory verbs pull down; architectural scope, subsystem nouns, enumerated steps, multi-file references, stack traces and open-ended judgment pull up. Bands: `trivial <22`, `moderate 22–45`, `complex 46–72`, `deep >72`.

### 2. Router — `planHybridRun()`

Produces `{ useArchitect, tier, escalateOnStall }`. `trivial` runs local-only with a badge in the collaborate step and **no cloud call at all**. Your configured `hybridTier` acts as a **ceiling** — the router may spend less than you asked for, never more.

### 3. Grounded blueprints — `buildWorkspaceGrounding()`

Before the architect turn, the workspace tree (depth 2) plus a declaration-only outline of the active file and the open tab list are read locally and injected as `[WORKSPACE GROUND TRUTH]`. Costs zero cloud tokens. The architect previously planned blind and invented plausible file paths that the worker then burned turns discovering were wrong.

### 4. Stall escalation

`consecutiveRepeatCount >= 3` already detected the worker looping on an identical tool call — and then discarded the signal, halting with "summarize your findings." It now hands the failure back to the architect (max 2× per run, skipped above 95% quota) with a pruned history and fresh grounding, asking it to diagnose the loop and issue a corrected next step. The re-plan is injected as a user directive and the repeat counter resets.

### Quota awareness

`fiveHourPercent` / `weeklyPercent` were tracked and displayed but never consulted. Now: ≥85% 5-hour or ≥90% weekly **lowers the tier**; only ≥95% / ≥97% removes the architect entirely.

### Verification

The classifier was extracted from the shipped source, compiled, and run against a 14-prompt corpus plus quota and tier-ceiling matrices. That caught three real bugs before they shipped:

| Bug | Symptom |
|---|---|
| Bare `format` in the mechanical-edit regex | "implement a new plugin **system** with a manifest **format**" scored 15 → classified trivial → a genuine subsystem build would have run local-only with no architect. |
| Quota demotion walked the *band* ladder | One demotion step took `moderate` → `trivial`, so at 87% quota a real refactor silently lost its architect. Tier demotion and architect-skipping are now separate decisions. |
| Band thresholds miscalibrated | Real architectural prompts topped out at 54, just under the old `complex` floor of 56 — so almost nothing ever reached medium tier. |

All 14 corpus cases now classify correctly.

---

## Part 5 — Selectable Cloud Architect: Claude or Gemini (applied 2026-09-10)

The hybrid architect was hardwired to Gemini in four separate places — blueprint, verification, stall re-plan, and direct chat — each with its own inline `isRealGoogleApiKey` check. It is now a single abstraction, so the architect can be Claude or Gemini interchangeably.

### Backend (`agent.ts`)

| Piece | Behaviour |
|---|---|
| `architectProviderFor(id)` | Infers the vendor from the model id (`claude-*` → Anthropic, `gemini-*` → Google); `hybridArchitectProvider` breaks ties for unrecognized ids. |
| `callArchitect()` | One entry point for every architect call; dispatches to `callAnthropic` or `callGemini` and returns a uniform `{content, promptTokens, candidateTokens, provider}`. |
| `hasArchitectKey()` | Checks the key for *that* architect's provider, replacing four inline Gemini-only checks. |
| `architectLabel()` | Transcript now says "Anthropic Claude (claude-opus-5)" or "Google Antigravity (gemini-3.8-flash)" instead of always the latter. |
| `listArchitectModels()` | Fetches the real catalogue from `api.anthropic.com/v1/models` and Google's `v1beta/models` for whichever providers have keys, so newly released models appear without an app update. Static list is the offline fallback. |
| `recordArchitectUsage()` | Anthropic usage is tracked per-model but **does not advance the Google 5-hour / weekly meters** — those measure a different subscription. `callAnthropic` now returns `usage.input_tokens` / `output_tokens`, which it previously discarded. |

Quota-based tier demotion (Part 4) now only fires when the architect actually *is* Gemini — otherwise a busy Google afternoon would have downgraded a Claude architect that has no relationship to those meters.

**Fable models are excluded** from both the static list and the live fetch (`EXCLUDED_ARCHITECT_MODELS`).

### Bug found while wiring this

`handleSelectAntigravityModel` wrote the chosen id into **both** `geminiModel` and `hybridArchitectModel`, and the backend resolved `geminiModel || hybridArchitectModel`. Selecting a Claude architect therefore left a Claude id sitting in the Gemini slot and got silently ignored. Selection now writes to the architect slot plus the correct vendor slot, and resolution reads the architect slot first.

### UI (`AntigravityModelModal.tsx`)

Vendor filter chips (**All / Claude / Gemini**) with live counts, a refresh button that re-queries the provider APIs, and Claude Opus 5 / Sonnet 5 / Haiku 4.5 in the catalogue. The list is populated live when a key is present and falls back to the static entries otherwise.

### Note on the llama-server startup banner

`n_slots = 4, kv_unified = 'true'` means the four slots share one 65536-token KV allocation rather than reserving 65536 each — the VRAM sizing in Part 1 holds. The "server default port will be changed to :9931" warning is harmless: the launch scripts pin `--port` explicitly.

Worth knowing: llama-server logs `CORS is set to allow all origins ('*') and no API key is set`. It only binds `127.0.0.1`, so it is not exposed to the network, but any page open in a browser on that machine can reach it. Adding `--api-key <secret>` to the launch script and the matching key in Strata's provider config would close that. Not applied — it needs both sides changed together.

---

## Part 6 — Zero-Cost Architecture (applied 2026-09-10)

### What hybrid mode was actually doing

With no Gemini key configured, `isRealGoogleApiKey()` returned false and every "cloud architect" turn fell through to `callLocalModel(...)` — with a system prompt instructing the local model to present itself as *"Google Antigravity, Google's premier agentic AI system."* Locally-generated blueprints then appeared in the transcript under a cloud vendor's name, and `recordGeminiUsage()` advanced a percentage afterwards.

Nothing was ever sent to Google or Anthropic. Nothing was ever billed. But the app said otherwise in three places, all now fixed:

1. **The persona no longer impersonates a vendor.** Both architect system prompts now read *"You are the Local Lead Architect (model) running on the user's own RTX 5090. You are NOT a cloud service."*
2. **The fabricated quota figures are gone.** `getGeminiQuota()` seeded `fiveHourPercent: 87` / `weeklyPercent: 51` with hardcoded reset timestamps. Removed, along with the back-fill that re-applied them.
3. **The default architect is local.** `architectModelId()` returned `'gemini-3.8-flash'` even with no key, so a keyless machine announced a cloud architect it could never call. It now returns `'local'` unless a real cloud key exists.

Worth recording: **the 5-hour and weekly percentages were never rendered anywhere.** `geminiQuota` was passed into `ChatPanel` and destructured but never used in any JSX; `fiveHourPercent` appeared only in `types.ts` and the backend. There was no toolbar ticker — it was dead state that fed the Part 4 router. The unused prop is now removed from both sides.

### API key ≠ subscription

An `anthropicApiKey` or Gemini API key draws on prepaid, per-token credits. A Claude Pro/Max or Google subscription is a separate product. **No third-party app can spend subscription quota through an API key.** That is a vendor boundary, not a Strata limitation — so "use my subscription quota" is not achievable through Strata's API-key config fields at all.

### The Free Cloud Ladder (opt-in, default OFF)

Subscription quota *is* reachable through the vendors' own CLIs, which authenticate against the account rather than API credits:

| Rung | Auth | Budget | Bills per token? |
|---|---|---|---|
| `gemini` CLI | Sign in with Google (OAuth) | 60 req/min, 1,000 req/day | No |
| `claude` CLI | Claude Pro/Max subscription | ~10–40 Claude Code prompts / 5h on Pro (Sonnet only; shared with claude.ai usage) | No |
| Local | — | Unlimited | No |

Ordered abundant-first: Gemini's 1,000/day is spent before Claude's scarcer subscription window. A rung that reports exhaustion goes on cooldown and the next takes over, ending at the local architect, which always works.

Selected via **Free Cloud Ladder** in the model picker. Prompts go over STDIN, not argv — Windows caps a command line near 32k characters, and an architect prompt carrying a 48k-token history would be truncated as an argument.

**Trade-off, stated plainly:** the ladder is free but *not* offline — it sends prompt content to the vendor. Local Dual-Brain remains the default for exactly that reason.

`claude` is not installed on this machine (`~/.claude` is absent). That rung self-detects via `ENOENT`, marks itself unavailable, and is skipped silently. To enable it: `npm i -g @anthropic-ai/claude-code`, then run `claude` once to sign in.

### Verification

20 ladder cases: exhaustion detection, JSON/plain output parsing, rung walking, cooldowns, and missing-CLI handling. The test caught a real defect — the first exhaustion regex matched a bare `quota`, so a failed run whose output mentioned *"a plan for the quota tracker module"* would have been misread as spent quota and cooled a healthy rung. The pattern now requires an actual exhaustion phrase (`quota exceeded|reached|exhausted`, `429`, `rate-limit`, `usage limit reached`), and is only consulted when the process actually failed.

---

## Part 7 — Execution Algorithm: making local / hybrid mode not feel dumb (applied 2026-09-10)

Full write-up in `HYBRID-ALGORITHM.md`. Summary of what changed and why.

### The loop was the problem, not the models

| Failure you saw | Cause | Fix |
|---|---|---|
| Generic blueprints | Architect saw a bare directory tree | **Grounding**: project profile + grep-ranked relevant files with line numbers, injected before any model call (`grounding.ts`) |
| Run ends after "Let me read the file…" | Loop stopped on any response without a tool call | **Continuation controller**: narrated-intent detection, checklist accounting, bounded nudges |
| Reads whole files repeatedly | No grep tool | **`search_codebase`** tool + loop guard on repeated reads |
| Edits leave the project broken | Nothing ran the typecheck | **Verification gate**: runs `npm run typecheck` (or the project's equivalent) after edits, feeds compacted errors back, 2 rounds |
| Architect always approves | It reviewed the worker's prose | **Evidence-based review**: diffs, gate results, checklist state; `VERDICT: REVISE` sends the worker back once |
| `edit_file` fails, model re-reads the whole file | Failure message said only "not found" | Closest-region hint with line numbers (token similarity), `NN: ` prefix stripping, indentation-tolerant re-indent, edited region echoed on success |
| Silent 30–60 s stalls on Ollama | Thinking models think by default; `message.thinking` was never read | `think:false` on worker turns, `think:true` for high-tier architect / re-plans, thinking surfaced |
| Hybrid crawls at 3 tok/s with llama-server up | Architect bypassed the VRAM arbiter | Architect now routed through `resolveLocalWorker()` — with the coder resident, both brains run on it |
| "⚠️ Error" bubbles mid-run and status flips to idle | Notices were sent on `agent:error` | New `notice()` → its own "Strata Engine" bubble; `agent:error` is for errors again |

### Structural changes

- The architect's blueprint is parsed into a **checklist** (`plan.ts`) the engine tracks; the directive is pushed to history as a **user** message. The old flow stored it as an assistant turn and re-roled it by string-matching "Local Architect" — which also caught the *verification* message and turned it into a new directive on the next run.
- The worker loop is now a re-enterable closure (`workerLoop(maxTurns)`) so the review phase can run one bounded revision round.
- Text-embedded tool calls (`<tool_call>` XML, JSON fences) are recovered on both llama-server and Ollama paths.
- Older `[WORKSPACE CONTEXT]` blocks are the first thing compaction removes.

### New config keys

`verificationGate` (default true), `architectThinking` (`off|auto|on`, default auto), `maxReviewRounds` (default 1). Not yet exposed in the settings UI.

### Verification

`npm run typecheck` clean. 29 unit tests (`scratchpad/unit.test.js`) covering the blueprint parser, progress inference, intent detection, embedded-call recovery, verdict parsing, term extraction, project profiling, retrieval on this workspace, diff summary, and every `edit_file` tier — two defects caught and fixed before shipping (retrieval cap overshoot; closest-region hint required an exact line). End-to-end run of the real engine against a fixture project with both brains on `qwen3.8:27b` — results appended below.

### End-to-end run 1 (hybrid, both brains `qwen3.8:27b` on Ollama, medium tier)

Fixture: a 2-file TypeScript project with a planted divisor bug in `average()` and an `index.ts` that imports a `clamp()` that does not exist yet. Prompt: *"Add an exported clamp(value, min, max) function to src/mathUtils.ts, and fix the bug in average() which divides by the wrong count. Make sure the project typechecks."*

| Phase | What happened | Time |
|---|---|---|
| Grounding | Ranked `src/mathUtils.ts` and `src/index.ts` from terms `mathUtils.ts, clamp, average, divides`; router scored it *moderate (42)* | <1 s |
| Blueprint | 2 tasks with real paths and observable done-when criteria, `## Verify` = `npm run typecheck`, two correct risks (export needed; empty-array case) | ~15 s |
| Worker | `read_file` → one `edit_file` fixing both issues → `run_command npm run typecheck` → `DONE:` summary. Task 1 auto-closed on the edit. | 4 turns |
| Gate | `npm run typecheck` passed | ~3 s |
| Continuation | Task 2 was still open (both changes landed in one edit, which the inference credits to task 1). Worker verified with `search_codebase` and answered `TASK 2 DONE: … src/mathUtils.ts:13` | 3 turns |
| Review | **False `REVISE`**: the evidence diff was a bare `-`/`+` line list; the reviewer read `+ }` / `+ export function` as a broken file and invented an `index.ts` requirement | ~20 s |
| Revision | Worker re-read both files, re-ran typecheck, `DONE:` again; final gate passed | 3 turns |
| Result | Final file correct; independent `tsc --noEmit` exit 0 | **109 s total** |

Fixes from this run: diff evidence is now a real contextual unified hunk (prefix/suffix trim + LCS on the changed middle), small changed files are shown whole, and the review protocol states that a passed gate is authoritative (no syntax claims) and that `[x]` tasks with evidence are done. A second run follows.

### End-to-end run 2 (same fixture and prompt, after the evidence fix)

| Phase | What happened | Time |
|---|---|---|
| Blueprint | 3 tasks (fix, add, verify) with real paths; risks correct | ~8 s |
| Worker | `read_file` → one `edit_file` for both changes → `npm run typecheck` → `DONE:`. Tasks 1 and 3 auto-closed. | 2 turns |
| Gate | passed | ~3 s |
| Continuation | Task 2 still open → worker confirmed it with `search_codebase` + a 3-line `read_file(startLine)` and replied `TASK 2 DONE` / `TASK 3 DONE` | 2 turns |
| Review | **`VERDICT: APPROVE`**, issues: none, summary accurate | ~5 s |
| Result | Final file correct; independent `tsc --noEmit` exit 0 | **22 s total** (model warm) |

Two refinements applied after this run, both visible as waste in the transcript above:
- A successful worker `run_command` that matches the project's verify command now *is* the gate (`editsSinceVerify` resets, a passed report is recorded). The engine no longer re-runs the same typecheck seconds later.
- When the worker declares completion (`DONE:`), pending **edit** tasks whose files were all written during the run are closed (`closeTasksClaimedDone`). Two tasks satisfied by one edit no longer trigger a continuation nudge.

Unit tests at that point: 31 passing. Mirrors **not** synced.

### End-to-end runs 3 and 4 (after the refinements)

- **Run 3 (12 s):** the worker's own `npm run typecheck` was recognized as the gate (no duplicate run). The task-2 nudge still fired: the parser had pulled `src/index.ts` out of the task's *done-when* clause into its file list, so "all files edited" failed. Fixed: an explicit `files:` segment is now authoritative, and completion claims close a task when *one* of its files was written (the review checks the result anyway). Also caught: the completion detector did not match `DONE:` with a colon - the exact format the system prompt requests.
- **Run 4 (11 s):** blueprint → `read_file` → one `edit_file` → `npm run typecheck` → `DONE:` → `VERDICT: APPROVE`. No nudges, no duplicate commands, independent typecheck exit 0.

Final state: 32 unit tests passing, `npm run typecheck` clean, `npm run build` clean.
