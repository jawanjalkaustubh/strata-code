# Strata Code — Local Dual-Brain Execution Algorithm

**Applies to:** `electron/agent.ts`, `electron/grounding.ts`, `electron/plan.ts`, `electron/tools.ts`
**Date:** 2026-09-10

## Why local mode felt dumb

Not because the models can't reason. Because the engine asked them to reason from nothing and then trusted whatever they said:

| Symptom | Root cause in the old loop |
|---|---|
| Architect "plans" were generic ("1. list_files 2. read_file 3. edit") | It was handed a depth-2 directory tree and nothing else. It had never seen a line of the code it was planning for. |
| Run ends after one turn with "Let me read the file to check…" | The loop terminated the moment a response had no tool call. Narrating an action counted as finishing. |
| Worker reads whole files three times, then gives up | There was no grep. The only way to find a symbol was to read entire files and hope. |
| Edits "succeed" but the project no longer compiles | Nothing ever ran the typecheck. The model declared victory and the engine believed it. |
| Architect verification always says ✅ | It reviewed the worker's *description* of its work, never the diff or a build result. |
| Long silent stalls on `qwen3.8:27b` | Ollama's thinking models think by default; the engine never read `message.thinking`, so hundreds of tokens of hidden reasoning happened before every tool call with nothing on screen. |
| Hybrid runs crawl at 3 tok/s | The architect bypassed the VRAM arbiter, so with llama-server resident (~26 GB) it loaded a second 17 GB model into a 30 GB card and spilled into shared memory. |

## The algorithm

Five phases. Every decision the engine makes itself is deterministic and costs zero model tokens.

```
 ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌─────────────┐   ┌───────────────┐
 │ 0 GROUNDING  │ → │ 1 BLUEPRINT  │ → │ 2 CHECKLIST LOOP │ → │ 3 GATE      │ → │ 4 REVIEW      │
 │ (no model)   │   │ (architect)  │   │ (worker)         │   │ (no model)  │   │ (architect)   │
 └──────────────┘   └──────────────┘   └──────────────────┘   └─────────────┘   └───────┬───────┘
                                                ▲                    │                  │ REVISE (≤1)
                                                └────────────────────┴──────────────────┘
```

### Phase 0 — Grounding (`grounding.ts`)

Runs before any model call, for every non-trivial request in both hybrid and direct mode.

- **Project profile.** Detects language, package manager, frameworks, and the exact commands that verify a change (`npm run typecheck` here; `cargo check`, `go build`, `py_compile`, `node --check` elsewhere). Cached until `package.json` changes.
- **Relevance retrieval.** Extracts identifiers and file names from the request (`callOllama`, `hybridMode`, `agent.ts` outrank plain words), greps up to 700 source files with a 2.5 s deadline, ranks them, and returns the top 6 with matching lines *and line numbers* plus a declaration outline of the top 3. Capped at ~5.5 KB.
- The block is appended to the user turn as `[WORKSPACE CONTEXT]`. The architect gets it inside its grounding; the worker sees it in the prompt. Older copies are stripped first during context compaction.

Result: the first tool call is usually `read_file(path, startLine, lineCount)` on the right region, not `list_files`.

### Phase 1 — Structured blueprint (architect)

The architect must answer in a fixed markdown shape:

```
## Goal
## Tasks
1. <imperative> — files: <real/path> — done when: <observable>
## Verify
- `npm run typecheck`
## Risks
```

`plan.ts` parses it into a checklist (tolerant of bold headers, sub-bullets, `- [ ]` lists; synthesizes a 3-step plan if no list came back). Each task is typed `inspect | edit | run | other` from its verb and carries its files.

The directive is pushed to history as a **user** message containing the blueprint, the rendered checklist, and four execution rules. It is never stored as an assistant turn that later has to be re-roled, which is what caused the echo bug and turned old verification messages into fresh directives.

Streamed live to the transcript, with `think: true` on high tier (and stall re-plans) for thinking-capable Ollama models, `think: false` everywhere else.

### Phase 2 — Checklist-driven worker loop

The worker runs as before, with the engine now watching:

- **Progress inference.** A successful `edit_file`/`write_file` on a task's file closes that edit task; a read closes an inspect task; a successful `run_command` closes a run task. The collaborate card shows `✓ Task 2: …` as they close. The worker can also say `TASK 3 DONE: <evidence>` or `TASK 3 SKIP: <reason>`.
- **Embedded tool-call recovery.** `<tool_call>` XML and `{"name": …}` JSON fences in the text are executed as calls (llama-server without `--jinja`, and several Ollama templates, emit them that way).
- **Loop guards.** Reading the same file a third time with no edit in between appends a nudge to the tool result. Two failed edits on one file append a hint; the failed edit itself now returns the *closest matching region* with line numbers (token-similarity match, so a slightly misremembered target still gets a hint) and `NN: ` line-number prefixes pasted from `read_file` are stripped automatically.
- **Continuation controller.** When a response has no tool calls, the engine decides whether the run is really finished:
  1. edits pending verification → run the gate (Phase 3); a failure is sent back as the next instruction
  2. the text narrates an action ("Let me read…", "Next I'll update…") → *"You described the next action but did not call a tool. Call it now."* (≤2 per run)
  3. non-inspect checklist tasks still open after real tool work → the checklist is shown and the worker must finish or account for each task (≤3 per run, never twice for the same pending set)
  Otherwise the run ends.
- **Stall escalation** (unchanged trigger: identical call ×3) now passes the checklist to the architect and streams the re-plan.

### Phase 3 — Verification gate (no model)

After the worker edits files and stops, the engine runs the project's own verification (`npm run typecheck`, plus `node --check` / `py_compile` / JSON parse on changed files where relevant; 150 s limit, stops at the first failure). Output is compacted to the error lines and pushed as:

```
[VERIFICATION GATE — FAILED]
The engine ran `npm run typecheck` after your edits and it failed:
src/mathUtils.ts(14,10): error TS2304: Cannot find name 'clamp'.
Fix the errors above in the files you changed …
```

Two rounds per run. Gate commands appear as `run_command` tool cards. Disable with `verificationGate: false`.

### Phase 4 — Evidence-based review (architect, medium/high tier)

The architect receives the **actual evidence**: per-file diff summaries (+/- counts and excerpts), every gate result, the checklist state, and the worker's final message. It must answer `VERDICT: APPROVE` or `VERDICT: REVISE` with `## Issues` / `## Next Steps` / `## Summary`.

`REVISE` (or a still-failing gate) sends the worker back once with the numbered issues, followed by a final gate and sign-off. An unparsable review defaults to approve so a confused architect can never loop the run. Review is skipped when the worker made no tool calls (a plain answer needs no code review).

## VRAM (the 30 GB constraint)

> **2026-09-12:** the coder server is now a child of the app (started on launch when the GPU is free, killed on quit, log in `%APPDATA%\StrataCode-v1\coder-server.log`). It is identified by its `--port 8080` command line, never by image name - Ollama runs its own `llama-server.exe` per model. Models in Ollama that Strata is not configured to use belong to another app and are never evicted automatically; the status bar offers **Free GPU**. Details in `OPTIMIZATION-AUDIT.md` Part 10.

llama-server with Qwen3-Coder at 64K context holds ~26 GB; `qwen3.8:27b` needs ~19 GB. They cannot co-reside, and Windows does not refuse — it spills to system memory and generation collapses. The arbiter (`resolveLocalWorker`) already re-routed the *worker*; it now routes the **architect** too. In practice:

| Resident | Architect | Worker | Swaps |
|---|---|---|---|
| llama-server up | Qwen3-Coder (8080) | Qwen3-Coder (8080) | none — plan/act split on one model |
| llama-server down | `qwen3.8:27b` (Ollama) | `qwen3.8:27b` (Ollama) | none |
| Ollama only, two different Ollama models | model A | model B | Ollama swaps per phase (~10–20 s each) |

The dual-brain split is still worth having on a single model: planning with `useTools=false` and a forced structure produces a materially better checklist than letting the coder improvise, and the review pass sees evidence the worker never summarizes for itself.

## Configuration (`provider-config.json`)

| Key | Default | Meaning |
|---|---|---|
| `verificationGate` | `true` | Run typecheck/tests after edits and feed failures back |
| `architectThinking` | `"auto"` | `off` / `auto` (high tier + re-plans) / `on` for thinking-capable Ollama architects |
| `maxReviewRounds` | `1` | How many times the architect may send the worker back (0–3) |

## Tools (`tools.ts`)

- **New `search_codebase`** — bounded grep (regex or literal, optional path / glob, 4 s deadline, 120-result cap). Listed first in the schema so it is the model's default first move.
- `read_file` always reports total line count; missing paths get a *"Did you mean: src/x.ts"*.
- `edit_file` — line-number-prefix stripping, indentation-tolerant match that re-indents the replacement, closest-region hint on failure, and the edited region echoed back on success so no confirmation read is needed.
- `write_file` warns when a file shrinks by more than half (a partial rewrite that dropped content).
- `list_files` takes `depth` (1–4) and shows file sizes.
- `run_command` reports the exit code, accepts a timeout for the gate, and sets `CI=1 NO_COLOR=1` so tools print plain, non-interactive output.

## Verification of this change

- `npm run typecheck`: clean.
- 29 unit tests over the parser, retrieval, diff summary, verify-command selection, and every `edit_file` tier (`scratchpad/unit.test.js`). Two bugs caught before shipping: the retrieval block overshot its cap because the header was not counted, and the closest-region hint required an exact line match and so gave no hint in exactly the near-miss case it exists for.
- Two end-to-end runs of the real `AgentEngine` against a fixture project (planted `average()` bug + missing `clamp()`), both brains on `qwen3.8:27b` via Ollama. Run 1 (109 s, cold model) exposed a false `REVISE` caused by the bare `-`/`+` diff format; after switching to contextual unified hunks plus whole-file evidence for small files, run 2 finished in 22 s with `VERDICT: APPROVE` and a correct, independently typechecked result. Transcript summaries are in `OPTIMIZATION-AUDIT.md` Part 7.
