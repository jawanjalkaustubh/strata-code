# Strata Code — UI Redesign Plan

**Target repo:** `D:\AntiGravity\strata`
**Mirrors that must stay in sync:** `D:\AntiGravity\local-code-studio`, `C:\AI_dev\projects\strata`
**Build:** `npm run build` (runs `tsc` first — it must pass with 0 errors)
**Stack:** Electron 34 · React 18 · TypeScript 5.7 · Vite 6 · Tailwind 3.4 · Monaco

---

## 0. Hard constraints — do not violate

1. **No per-token billing, ever.** `allowPaidApis` defaults to blocked and `assertPaidAllowed()` throws before any network call to Anthropic / Google AI / OpenAI / DeepSeek / OpenRouter. Do not remove, weaken, or default-enable it. Do not add new metered calls.
2. **Architect is Gemini-only** (plus the local architect). Claude/Anthropic entries were deliberately removed from the picker, the CLI ladder and the static catalogue. `'Anthropic'` remains in a couple of TypeScript unions only so re-adding is a one-line change — do not "clean that up" by wiring Anthropic back in.
3. **Every change lands in all three trees.** A change in `strata` that is missing from the two mirrors is an incomplete change.
4. **`tsc` must stay clean.** Compare against a baseline; do not introduce new errors.
5. Windows + PowerShell. Paths are `D:\...` / `C:\...`.

---

## 1. Phase 0 — already applied (do not redo)

| Change | Detail |
|---|---|
| Design tokens added | `tailwind.config.js` now defines `studio.*` surfaces, `role.*` (user/architect/worker/tool), `state.*` (ok/warn/danger/info), `fontSize.micro` (11px) + `fontSize.mini` (12px), `borderRadius.control|card|modal`, `boxShadow.panel|raised`. |
| 7 dead utilities repaired | `py-0.2` appeared 7× (ChatPanel ×5, TitleBar, model modal). Tailwind's spacing scale has no `0.2` step, so those compiled to **no CSS at all**. Now `py-0.5`. |
| Type floor raised | 107 arbitrary `text-[9px]` / `text-[10px]` / `text-[11px]` replaced with `text-micro` (11px). 9px was below comfortable reading. |

> ⚠️ **`fontSize.micro` is now load-bearing for 107 class usages.** If you regenerate `tailwind.config.js`, you must keep `micro` and `mini` or all of that text silently falls back to inherited sizing.

---

## 2. Current state — measured, not estimated

Across 4,629 lines of JSX in 6 files:

| File | Lines | Colour utilities | Dominant hues |
|---|---:|---:|---|
| `src/components/ChatPanel.tsx` | 1,566 | 331 | slate 73, purple 65, indigo 58, amber 41 |
| `src/components/TitleBar.tsx` | 802 | 169 | slate 61, indigo 28, rose 25, purple 25 |
| `src/components/AntigravityModelModal.tsx` | 435 | 75 | purple 28, slate 21, teal 17 |
| `src/components/TerminalDrawer.tsx` | 254 | 30 | slate 16, indigo 7, rose 5 |
| `src/components/FileTree.tsx` | 156 | 20 | slate 14, indigo 6 |
| `src/App.tsx` | 1,006 | 13 | teal 5, indigo 4 |

**Problems:**

- **9 accent hues** across 693 colour utilities with no system — purple, teal, indigo, amber, rose, emerald, blue, cyan, slate.
- **6 border radii** (`full` 37, `lg` 33, `md` 26, `xl` 18, `2xl` 2, `sm` 1) applied arbitrarily; visually the same element class uses different radii in different files.
- No hover/focus-visible system — keyboard focus is largely invisible.
- `App.tsx` is a 1,006-line component holding all state; every child re-renders on any change (see §6).

---

## 3. Phase 1 — Colour migration (mechanical, highest leverage)

Replace ad-hoc hues with the semantic tokens already in `tailwind.config.js`. **Meaning drives the token, not the current hue** — check each call site.

| Current | Occurrences | Migrate to | Meaning |
|---|---:|---|---|
| `purple-*` | 118 | `role-architect` / `role-architectBg` | the planning/architect voice |
| `indigo-*` | 103 | `role-user` / `role-userBg` | the user's own messages |
| `teal-*` | 58 | `role-worker` / `role-workerBg` | local RTX 5090 executor |
| `amber-*` | 54 | `role-tool` **or** `state-warn` | tool invocation vs. warning — disambiguate per site |
| `rose-*` | 57 | `state-danger` | errors, destructive actions |
| `emerald-*` | 44 | `state-ok` | success, healthy status |
| `blue-* / cyan-* / sky-*` | 17 | `state-info` | informational only |
| `slate-*` | 207 | `studio-*` | surfaces and text — map by role, see below |

**Slate mapping:** `slate-950/900` → `studio-bg`; `slate-800` → `studio-surface`; `slate-700` → `studio-border`; `slate-400` → `studio-muted`; `slate-500` → `studio-subtle`; `slate-200/100` → `studio-text`.

**Do this file by file, smallest first** (`App.tsx` → `FileTree` → `TerminalDrawer` → modal → `TitleBar` → `ChatPanel`), building after each. Do not attempt one global regex across all six — `amber` alone splits two ways.

---

## 4. Phase 2 — Radius and spacing discipline

Collapse 6 radii to 3 tokens:

- `rounded-control` (6px) — buttons, inputs, chips, badges
- `rounded-card` (10px) — panels, message bubbles, list rows
- `rounded-modal` (16px) — modal shells only
- `rounded-full` stays for avatars/dots/pills

Map: `rounded-sm|md` → `rounded-control`; `rounded-lg|xl` → `rounded-card`; `rounded-2xl` → `rounded-modal`.

Spacing: standardise interactive padding to `px-2.5 py-1.5` (compact) or `px-3 py-2` (default). Card padding `p-3`. Section gutters `px-4 py-3`.

---

## 5. Phase 3 — Component polish

### 5.1 `TitleBar.tsx` (802 lines — the worst offender)
- Extract the repeated pill/badge markup into one local `<StatusPill tone="ok|warn|danger|info">` component. There are ~25 near-duplicate inline pill blocks.
- Group controls into three zones: identity (left), engine status (centre), window controls (right). Currently they interleave.
- Give every clickable element a visible `focus-visible:ring-2 focus-visible:ring-studio-accent` state.

### 5.2 `ChatPanel.tsx` (1,566 lines)
- **Extract the message row** from the 200-line inline `messages.map(...)` into `<MessageRow>` wrapped in `React.memo`. `FormattedContent` and `CodeBlock` are already memoized; the row itself is not, so all rows still re-render per streamed chunk.
- Role attribution: replace the three near-identical sender-header blocks (user / architect / worker) with one component driven by a `role` prop and the `role-*` tokens.
- Code blocks: add a language chip and make the copy button appear on hover rather than always.
- Give the composer a clear focus state and a visible send affordance.

### 5.3 `AntigravityModelModal.tsx`
- The `NO COST` / `BILLED PER TOKEN` badges are the most important thing in this modal — keep them prominent and never remove them.
- Group the list under vendor headings rather than a flat list.

### 5.4 `FileTree.tsx` / `TerminalDrawer.tsx`
- Row height and indent consistency; active/selected states via `studio-panelHi`.
- Terminal: monospace scale, clearer prompt vs. output distinction using `state-*` tokens.

---

## 6. Phase 4 — Render performance (do this, it is user-visible)

`App.tsx` holds all state in one 1,006-line component, and **no child is memoized**. Every token that arrives re-renders `TitleBar`, `FileTree`, `CodeEditor`, `ChatPanel` and `TerminalDrawer`.

The main process already coalesces streamed tokens into ~25 messages/sec (was ~237), so this is no longer catastrophic — but the fix is still worth it:

1. Wrap `TitleBar`, `FileTree`, `CodeEditor`, `TerminalDrawer` in `React.memo`.
2. Wrap every handler passed to them in `useCallback` — **memo does nothing without this**, since new function identities defeat it.
3. Extract `<MessageRow>` as in §5.2.

Verify with React DevTools Profiler: during streaming, only `ChatPanel` and the final `MessageRow` should re-render.

---

## 7. Phase 5 — New: engine status bar

Data that is **already wired in the backend but rendered nowhere**:

- `agent.probeLocalEngines()` → llama-server up/down, model alias, `n_ctx`, Ollama loaded models, and real GPU VRAM via `nvidia-smi` (`totalMiB` / `usedMiB` / `freeMiB`).
- `agent.cliLadderStatus()` → which free rungs are available, and cooldown remaining.
- IPC channels already exist: `architect:ladder-status`, `architect:list-models`. Preload already exposes `getArchitectLadderStatus()` and `listArchitectModels()`.

Add a slim status bar (24–28px) along the bottom:

```
Qwen3-Coder-30B-A3B · :8080 · 64K ctx    │    VRAM 26.3 / 32.0 GB    │    Architect: Local (RTX 5090)    │    ● ready
```

Poll every 10s (the probe is already cached for 10s server-side, so this is nearly free). Use `state-ok` / `state-warn` / `state-danger` for the VRAM bar: warn above 85%, danger above 95%.

**A new IPC channel is needed** for engine status — add `ipcMain.handle('engine:status', () => agent.probeLocalEngines())` in `main.ts` and expose it in `preload.cjs`. Note `preload.cjs` is the real preload; `preload.ts` is a deprecated no-op stub and is not built.

---

## 8. Verification checklist

Run after **each** phase, not once at the end:

1. `npm run build` — must be 0 TypeScript errors.
2. `npx tailwindcss -i src/index.css -o /tmp/out.css --content "./src/**/*.tsx"` then grep for the tokens you introduced, to confirm they actually emitted CSS. *(This is exactly the check that would have caught the 7 dead `py-0.2` utilities.)*
3. Search for regressions:
   ```powershell
   Select-String -Path src\**\*.tsx -Pattern "text-\[\d+px\]|[pm][xytblr]?-0\.\d(?!5)"
   ```
   should return nothing.
4. Launch the app; confirm hybrid mode still runs local-only and no network call is attempted.
5. Copy all changed files to both mirrors.

---

## 9. Suggested order

1. Phase 1 on `App.tsx` + `FileTree` + `TerminalDrawer` (small, builds confidence)
2. Phase 2 radius/spacing across those same three
3. Phase 1 + 2 on the modal and `TitleBar`
4. Phase 3.1 and 3.3
5. Phase 1 + 2 + 3.2 on `ChatPanel` (largest, do last)
6. Phase 4 render performance
7. Phase 5 status bar

Stop and rebuild between every step.
