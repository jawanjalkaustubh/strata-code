import * as fs from 'fs';
import * as path from 'path';

/**
 * Workspace grounding: everything the engine can learn about the project
 * WITHOUT spending a single model token.
 *
 * Local models are not dumb because they lack reasoning - they are dumb
 * because they are asked to reason from nothing. A 30B coder handed a bare
 * directory tree will invent file names, read whole files to find one
 * function, and never run the typecheck. This module gives it, up front:
 *
 *   1. A project profile: language, package manager, frameworks, and the
 *      exact commands that verify a change (typecheck / build / test).
 *   2. Relevance retrieval: a bounded grep of the workspace for the
 *      identifiers in the request, ranked, with matching lines and line
 *      numbers - so the first tool call can be a targeted read instead of
 *      a fishing expedition.
 */

export interface ProjectProfile {
  kind: 'node' | 'python' | 'rust' | 'go' | 'dotnet' | 'static' | 'unknown';
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun';
  typescript: boolean;
  scripts: Record<string, string>;
  frameworks: string[];
  /** Commands that validate the whole project, cheapest first. */
  verifyCommands: string[];
  /** One line for prompts. */
  summary: string;
}

export interface RetrievedFile {
  relPath: string;
  score: number;
  lineCount: number;
  matchedTerms: string[];
  hits: { line: number; text: string }[];
  outline?: string;
}

export interface QueryTerm {
  term: string;
  weight: number;
}

const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'Cache', 'GPUCache', '.next', '.venv', 'venv',
  '__pycache__', '.turbo', '.cache', 'out', 'build', 'target', '.vite', 'coverage', '.idea',
  'bin', 'obj', '.pytest_cache', '.mypy_cache', 'vendor', 'assets', 'public'
]);

const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'less', 'html', 'htm', 'md', 'mdx',
  'py', 'rs', 'go', 'cs', 'java', 'kt', 'swift', 'ps1', 'psm1', 'bat', 'cmd', 'sh', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'txt', 'sql', 'vue', 'svelte', 'xml', 'graphql', 'proto', 'c', 'h', 'cpp',
  'hpp', 'cc', 'env', 'lua', 'rb', 'php'
]);

const SKIP_FILE = /(^package-lock\.json$|\.lock$|\.min\.(js|css)$|\.map$|-lock\.ya?ml$|^bun\.lockb$|-live-session\.md$|\.log$|\.bak(-[\w-]+)?$)/i;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'file', 'files', 'code', 'make',
  'please', 'should', 'would', 'could', 'into', 'from', 'have', 'has', 'been', 'will', 'also',
  'want', 'need', 'when', 'then', 'than', 'what', 'which', 'where', 'how', 'use', 'using', 'used',
  'add', 'fix', 'update', 'change', 'create', 'implement', 'remove', 'delete', 'all', 'any', 'some',
  'more', 'less', 'like', 'just', 'only', 'can', 'not', 'but', 'are', 'was', 'were', 'its', 'our',
  'your', 'you', 'they', 'them', 'their', 'there', 'here', 'does', 'don', 'doesn', 'feel', 'feels',
  'thing', 'things', 'stuff', 'work', 'works', 'working', 'way', 'new', 'get', 'set', 'let', 'via',
  'each', 'every', 'both', 'very', 'much', 'many', 'most', 'such', 'about', 'after', 'before',
  'because', 'while', 'still', 'even', 'ever', 'never', 'always', 'again', 'might', 'well', 'may',
  'own', 'same', 'other', 'another', 'over', 'under', 'out', 'off', 'inside', 'within', 'without',
  'currently', 'current', 'existing', 'proper', 'properly', 'correct', 'correctly', 'better', 'good',
  'bad', 'right', 'wrong', 'look', 'looks', 'see', 'check', 'review', 'inspect', 'analyze',
  'improve', 'improvements', 'optimize', 'optimization', 'rework', 'refactor', 'continue', 'done',
  'user', 'users', 'project', 'workspace', 'app', 'application', 'function', 'functions', 'method',
  'class', 'component', 'components', 'module', 'modules', 'line', 'lines', 'block', 'section',
  'true', 'false', 'null', 'undefined', 'const', 'return', 'import', 'export', 'default', 'async',
  'await', 'string', 'number', 'boolean', 'void', 'type', 'interface', 'object', 'array', 'value',
  'name', 'path', 'content', 'result', 'data', 'error', 'errors', 'test', 'tests', 'run', 'running'
]);

// ---------------------------------------------------------------------------
// Project profile
// ---------------------------------------------------------------------------

function readJsonSafe(p: string): any | null {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return null;
  }
}

function exists(dir: string, name: string): boolean {
  try {
    return fs.existsSync(path.join(dir, name));
  } catch {
    return false;
  }
}

function pmRun(pm: ProjectProfile['packageManager'], script: string): string {
  switch (pm) {
    case 'pnpm': return `pnpm run ${script}`;
    case 'yarn': return `yarn ${script}`;
    case 'bun': return `bun run ${script}`;
    default: return `npm run ${script}`;
  }
}

export function buildProjectProfile(workspaceDir: string): ProjectProfile {
  const profile: ProjectProfile = {
    kind: 'unknown',
    typescript: false,
    scripts: {},
    frameworks: [],
    verifyCommands: [],
    summary: ''
  };

  const pkg = readJsonSafe(path.join(workspaceDir, 'package.json'));
  if (pkg && typeof pkg === 'object') {
    profile.kind = 'node';
    profile.packageManager = exists(workspaceDir, 'pnpm-lock.yaml') ? 'pnpm'
      : exists(workspaceDir, 'yarn.lock') ? 'yarn'
      : (exists(workspaceDir, 'bun.lockb') || exists(workspaceDir, 'bun.lock')) ? 'bun'
      : 'npm';
    profile.scripts = (pkg.scripts && typeof pkg.scripts === 'object') ? { ...pkg.scripts } : {};
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const depNames = Object.keys(deps);
    profile.typescript = depNames.includes('typescript') || exists(workspaceDir, 'tsconfig.json');

    const fw: [string, RegExp][] = [
      ['react', /^react$/], ['next', /^next$/], ['vue', /^vue$/], ['svelte', /^svelte$/],
      ['electron', /^electron$/], ['vite', /^vite$/], ['webpack', /^webpack$/], ['express', /^express$/],
      ['fastify', /^fastify$/], ['nestjs', /^@nestjs\/core$/], ['tailwindcss', /^tailwindcss$/],
      ['three.js', /^three$/], ['monaco', /^@monaco-editor\/react$|^monaco-editor$/],
      ['vitest', /^vitest$/], ['jest', /^jest$/], ['playwright', /^@playwright\/test$/], ['prisma', /^prisma$/]
    ];
    for (const [label, re] of fw) {
      if (depNames.some(d => re.test(d))) profile.frameworks.push(label);
    }

    if (profile.scripts.typecheck) {
      profile.verifyCommands.push(pmRun(profile.packageManager, 'typecheck'));
    } else if (profile.typescript && exists(workspaceDir, 'tsconfig.json')) {
      profile.verifyCommands.push('npx tsc --noEmit -p tsconfig.json');
    }
    const testScript = profile.scripts.test || '';
    const runnableTest = /\b(vitest run|jest|mocha|node --test|ava|tap|uvu)\b/.test(testScript)
      && !/\bwatch\b/.test(testScript)
      && !/no test specified/.test(testScript);
    if (runnableTest) profile.verifyCommands.push(pmRun(profile.packageManager, 'test'));
    if (profile.verifyCommands.length === 0 && profile.scripts.build && !profile.frameworks.includes('electron')) {
      // Build is a last resort: slow, and for Electron apps it also rebuilds the shell.
      profile.verifyCommands.push(pmRun(profile.packageManager, 'build'));
    }
  } else if (exists(workspaceDir, 'Cargo.toml')) {
    profile.kind = 'rust';
    profile.verifyCommands.push('cargo check -q --message-format short');
  } else if (exists(workspaceDir, 'go.mod')) {
    profile.kind = 'go';
    profile.verifyCommands.push('go build ./...');
  } else if (exists(workspaceDir, 'pyproject.toml') || exists(workspaceDir, 'requirements.txt') || exists(workspaceDir, 'setup.py')) {
    profile.kind = 'python';
    const hasTests = exists(workspaceDir, 'tests') || exists(workspaceDir, 'test') || exists(workspaceDir, 'pytest.ini');
    if (hasTests) profile.verifyCommands.push('python -m pytest -x -q -p no:cacheprovider');
  } else {
    try {
      const entries = fs.readdirSync(workspaceDir);
      if (entries.some(e => /\.(csproj|sln)$/i.test(e))) {
        profile.kind = 'dotnet';
        profile.verifyCommands.push('dotnet build --nologo -v q');
      } else if (entries.some(e => /\.html?$/i.test(e)) && entries.some(e => /\.js$/i.test(e))) {
        profile.kind = 'static';
      } else if (entries.some(e => /\.py$/i.test(e))) {
        profile.kind = 'python';
      }
    } catch {}
  }

  const bits: string[] = [];
  bits.push(`kind: ${profile.kind}${profile.packageManager ? ` (${profile.packageManager})` : ''}`);
  if (profile.typescript) bits.push('TypeScript');
  if (profile.frameworks.length) bits.push(`frameworks: ${profile.frameworks.join(', ')}`);
  const scriptNames = Object.keys(profile.scripts);
  if (scriptNames.length) bits.push(`scripts: ${scriptNames.slice(0, 8).join(', ')}`);
  if (profile.verifyCommands.length) bits.push(`verify with: ${profile.verifyCommands.map(c => `\`${c}\``).join(' then ')}`);
  profile.summary = bits.join(' • ');
  return profile;
}

/**
 * The verification commands to run after a specific set of files changed.
 * Project-wide commands come from the profile; per-file syntax checks cover
 * projects that have no build at all (a static HTML game, a loose script).
 */
export function chooseVerifyCommands(profile: ProjectProfile, changedFiles: string[]): string[] {
  const cmds: string[] = [...profile.verifyCommands];
  const q = (f: string) => `'${f.replace(/'/g, "''")}'`;

  const js = changedFiles.filter(f => /\.(m?js|cjs)$/i.test(f)).slice(0, 6);
  const ts = changedFiles.filter(f => /\.(ts|tsx)$/i.test(f));
  const py = changedFiles.filter(f => /\.py$/i.test(f)).slice(0, 10);
  const json = changedFiles.filter(f => /\.json$/i.test(f) && !/package-lock|tsconfig/i.test(f)).slice(0, 5);

  if (js.length && !(profile.kind === 'node' && profile.typescript && ts.length === 0 && cmds.length)) {
    for (const f of js) cmds.push(`node --check ${q(f)}`);
  }
  if (py.length) cmds.push(`${process.platform === 'win32' ? 'python' : 'python3'} -m py_compile ${py.map(q).join(' ')}`);
  for (const f of json) {
    cmds.push(`node -e "JSON.parse(require('fs').readFileSync(${JSON.stringify(f)},'utf8'))"`);
  }

  // De-duplicate while preserving order, and keep the gate cheap.
  const seen = new Set<string>();
  return cmds.filter(c => (seen.has(c) ? false : (seen.add(c), true))).slice(0, 6);
}

/** Keep only the lines of a failed verification that tell the model what to fix. */
export function compactVerifyOutput(output: string, maxLines = 30, maxChars = 3000): string {
  const lines = (output || '').split('\n').map(l => l.replace(/\r$/, ''));
  const interesting = lines.filter(l =>
    /\b(error|err!|failed|fail|exception|traceback|warning TS|cannot find|is not assignable|does not exist|unexpected|expected|syntaxerror|typeerror|referenceerror|panic|undefined reference)\b/i.test(l)
    || /\(\d+,\d+\)/.test(l) || /:\d+:\d+/.test(l)
  );
  const chosen = (interesting.length ? interesting : lines.filter(l => l.trim())).slice(0, maxLines);
  const text = chosen.join('\n');
  return text.length > maxChars ? text.slice(0, maxChars) + '\n... [truncated]' : text;
}

// ---------------------------------------------------------------------------
// Query terms
// ---------------------------------------------------------------------------

const FILE_TOKEN = /[\w\-./\\]+\.(tsx?|jsx?|mjs|cjs|json|css|scss|html?|py|ps1|bat|md|ya?ml|rs|go|java|cs|toml|sql|vue|svelte)\b/gi;

export function extractQueryTerms(prompt: string, extraTerms: string[] = [], max = 14): QueryTerm[] {
  const scores = new Map<string, number>();
  const bump = (raw: string, w: number) => {
    const t = raw.trim();
    if (t.length < 3 || t.length > 64) return;
    const key = t;
    scores.set(key, Math.max(scores.get(key) || 0, w));
  };

  const text = prompt || '';

  // Strip attached-context blocks; they are already in the model's view and
  // would swamp the term list with their own contents.
  const stripped = text
    .replace(/\[ATTACHED FILE CONTEXT:[\s\S]*?\[\/ATTACHED FILE CONTEXT\]/g, ' ')
    .replace(/\[WORKSPACE CONTEXT\][\s\S]*?\[\/WORKSPACE CONTEXT\]/g, ' ');

  for (const m of stripped.match(FILE_TOKEN) || []) {
    const base = m.split(/[\\/]/).pop() || m;
    bump(base, 4);
    bump(base.replace(/\.[^.]+$/, ''), 3);
  }

  for (const m of stripped.match(/`([^`\n]{3,64})`/g) || []) {
    bump(m.replace(/`/g, ''), 3);
  }

  for (const m of stripped.match(/"([^"\n]{3,48})"|'([^'\n]{3,48})'/g) || []) {
    const inner = m.slice(1, -1);
    if (!/\s{2,}/.test(inner) && inner.split(/\s+/).length <= 4) bump(inner, 2);
  }

  const words = stripped.match(/[A-Za-z_$][\w$]*(?:[.-][A-Za-z_$][\w$]*)*/g) || [];
  for (const w of words) {
    const lower = w.toLowerCase();
    if (STOPWORDS.has(lower)) continue;
    if (w.length < 3) continue;
    const isIdentifier = /[a-z][A-Z]/.test(w) || /_/.test(w) || /\d/.test(w) || /[.]/.test(w);
    if (isIdentifier) {
      bump(w, 3);
      // Sub-words of an identifier catch near-misses: "cacheMode" also finds "cache".
      for (const part of w.split(/(?<=[a-z0-9])(?=[A-Z])|[_.\-]/)) {
        const p = part.toLowerCase();
        if (p.length >= 4 && !STOPWORDS.has(p)) bump(p, 1);
      }
    } else if (/^[A-Z]/.test(w) && w.length >= 4) {
      bump(w, 2);
    } else if (w.length >= 5) {
      bump(lower, 1);
    }
  }

  for (const t of extraTerms) bump(t, 3);

  return [...scores.entries()]
    .map(([term, weight]) => ({ term, weight }))
    .sort((a, b) => b.weight - a.weight || a.term.length - b.term.length)
    .slice(0, max);
}

// ---------------------------------------------------------------------------
// Retrieval
// ---------------------------------------------------------------------------

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Breadth-first listing of candidate source files, shallow first. */
export async function listSourceFiles(workspaceDir: string, maxFiles = 700, maxDepth = 6): Promise<string[]> {
  const out: string[] = [];
  let frontier: { dir: string; depth: number }[] = [{ dir: workspaceDir, depth: 0 }];
  while (frontier.length && out.length < maxFiles) {
    const next: { dir: string; depth: number }[] = [];
    for (const { dir, depth } of frontier) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        if (out.length >= maxFiles) break;
        if (e.isDirectory()) {
          if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.') || /^(backup|agent-leftovers)/i.test(e.name)) continue;
          if (depth + 1 <= maxDepth) next.push({ dir: path.join(dir, e.name), depth: depth + 1 });
          continue;
        }
        if (!e.isFile()) continue;
        const ext = e.name.split('.').pop()?.toLowerCase() || '';
        if (!TEXT_EXT.has(ext) || SKIP_FILE.test(e.name)) continue;
        out.push(path.join(dir, e.name));
      }
    }
    frontier = next;
  }
  return out;
}

/** Declaration-only outline of a source file (never the bodies). */
export function outlineSource(content: string, maxLines = 40): string {
  const decl = /^\s*(export\s+)?(default\s+)?(async\s+)?(abstract\s+)?(class|interface|type|enum|function|const|let|var|def|public|private|protected|static|fn|pub fn|struct|impl|func)\s+[A-Za-z_$][\w$]*/;
  const lines = content.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!decl.test(lines[i])) continue;
    out.push(`${i + 1}: ${lines[i].trim().slice(0, 120)}`);
    if (out.length >= maxLines) { out.push('... [outline truncated]'); break; }
  }
  return out.join('\n');
}

export interface RetrieveOptions {
  maxFiles?: number;
  maxScan?: number;
  maxHitsPerFile?: number;
  deadlineMs?: number;
  maxFileBytes?: number;
  outlineTop?: number;
}

export async function retrieveRelevantFiles(
  workspaceDir: string,
  terms: QueryTerm[],
  opts: RetrieveOptions = {}
): Promise<RetrievedFile[]> {
  const maxFiles = opts.maxFiles ?? 6;
  const maxScan = opts.maxScan ?? 700;
  const maxHits = opts.maxHitsPerFile ?? 8;
  const deadline = Date.now() + (opts.deadlineMs ?? 2500);
  const maxBytes = opts.maxFileBytes ?? 512 * 1024;
  const outlineTop = opts.outlineTop ?? 3;

  if (!terms.length) return [];

  const compiled = terms.map(t => ({ ...t, re: new RegExp(escapeRe(t.term), 'gi'), lower: t.term.toLowerCase() }));
  const files = await listSourceFiles(workspaceDir, maxScan);
  const results: RetrievedFile[] = [];

  const BATCH = 24;
  for (let i = 0; i < files.length; i += BATCH) {
    if (Date.now() > deadline) break;
    const batch = files.slice(i, i + BATCH);
    const contents = await Promise.all(batch.map(async f => {
      try {
        const st = await fs.promises.stat(f);
        if (st.size > maxBytes) return null;
        return await fs.promises.readFile(f, 'utf-8');
      } catch {
        return null;
      }
    }));

    for (let j = 0; j < batch.length; j++) {
      const content = contents[j];
      if (content == null) continue;
      const rel = path.relative(workspaceDir, batch[j]).replace(/\\/g, '/');
      const relLower = rel.toLowerCase();
      let score = 0;
      const matched: string[] = [];
      for (const t of compiled) {
        let count = 0;
        t.re.lastIndex = 0;
        while (t.re.exec(content) && count < 8) count++;
        if (count > 0) {
          score += t.weight * (1 + Math.log2(count));
          matched.push(t.term);
        }
        if (relLower.includes(t.lower)) score += 6 * t.weight;
      }
      if (score <= 0) continue;

      const lines = content.split('\n');
      const scored: { line: number; text: string; s: number }[] = [];
      for (let k = 0; k < lines.length; k++) {
        const l = lines[k];
        if (!l.trim()) continue;
        let s = 0;
        const lowerLine = l.toLowerCase();
        for (const t of compiled) if (lowerLine.includes(t.lower)) s += t.weight;
        if (s > 0) scored.push({ line: k + 1, text: l.trim().slice(0, 150), s });
      }
      scored.sort((a, b) => b.s - a.s || a.line - b.line);
      const hits = scored.slice(0, maxHits).sort((a, b) => a.line - b.line).map(({ line, text }) => ({ line, text }));

      results.push({ relPath: rel, score, lineCount: lines.length, matchedTerms: matched, hits });
    }
  }

  results.sort((a, b) => b.score - a.score);
  const top = results.slice(0, maxFiles);

  for (let i = 0; i < Math.min(outlineTop, top.length); i++) {
    try {
      const content = await fs.promises.readFile(path.join(workspaceDir, top[i].relPath), 'utf-8');
      const outline = outlineSource(content, 25);
      if (outline) top[i].outline = outline;
    } catch {}
  }
  return top;
}

export function renderRetrieval(files: RetrievedFile[], maxChars = 6000): string {
  if (!files.length) return '';
  const parts: string[] = [];
  for (const f of files) {
    const lines: string[] = [];
    lines.push(`• ${f.relPath} (${f.lineCount} lines) — matches: ${f.matchedTerms.slice(0, 6).join(', ')}`);
    for (const h of f.hits) lines.push(`    L${h.line}: ${h.text}`);
    if (f.outline) lines.push(`    outline:\n${f.outline.split('\n').map(l => `      ${l}`).join('\n')}`);
    parts.push(lines.join('\n'));
  }
  let text = parts.join('\n');
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n... [retrieval truncated]';
  return text;
}

/** One block ready to drop into a prompt. Empty when nothing matched. */
export async function buildRetrievalBlock(
  workspaceDir: string,
  prompt: string,
  extraTerms: string[] = [],
  opts: RetrieveOptions & { maxChars?: number } = {}
): Promise<{ block: string; files: RetrievedFile[]; terms: QueryTerm[] }> {
  const terms = extractQueryTerms(prompt, extraTerms);
  if (!terms.length) return { block: '', files: [], terms };
  const files = await retrieveRelevantFiles(workspaceDir, terms, opts);
  if (!files.length) return { block: '', files, terms };
  // The cap is for the whole block; the header below costs ~350 chars.
  const body = renderRetrieval(files, Math.max(1000, (opts.maxChars ?? 6000) - 400));
  const block = `[WORKSPACE CONTEXT — found by local search for: ${terms.slice(0, 8).map(t => t.term).join(', ')}]
These are REAL files that already contain the terms in the request, with line numbers. Start from them: read the exact ranges you need with read_file(startLine, lineCount), and use search_codebase for anything else. Do not guess paths.
${body}
[/WORKSPACE CONTEXT]`;
  return { block, files, terms };
}

// ---------------------------------------------------------------------------
// Diff evidence
// ---------------------------------------------------------------------------

export interface DiffSummary {
  path: string;
  added: number;
  removed: number;
  excerpt: string;
}

type DiffOp = { type: ' ' | '-' | '+'; text: string };

/** Classic LCS line diff. Only ever run on the changed middle of a file, so the table stays small. */
function lcsDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] = a[i] === b[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ type: ' ', text: a[i] }); i++; j++; }
    else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) { ops.push({ type: '-', text: a[i] }); i++; }
    else { ops.push({ type: '+', text: b[j] }); j++; }
  }
  while (i < n) ops.push({ type: '-', text: a[i++] });
  while (j < m) ops.push({ type: '+', text: b[j++] });
  return ops;
}

/**
 * Unified-style change summary for review evidence.
 *
 * The first version listed removed lines, then added lines, with no context.
 * A 27B reviewer read "+ }" followed by "+ export function" as a broken file
 * and sent the worker back for nothing. Agent edits are local, so trimming
 * the common prefix/suffix and running a real LCS on what is left is cheap
 * and yields a hunk that reads like the source.
 */
export function summarizeDiff(filePath: string, oldContent: string, newContent: string, maxExcerptLines = 40): DiffSummary {
  const oldLines = (oldContent || '').split('\n');
  const newLines = (newContent || '').split('\n');

  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < oldLines.length - prefix &&
    suffix < newLines.length - prefix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) suffix++;

  const oldMid = oldLines.slice(prefix, oldLines.length - suffix);
  const newMid = newLines.slice(prefix, newLines.length - suffix);

  let ops: DiffOp[];
  if (oldMid.length * newMid.length <= 250_000) {
    ops = lcsDiff(oldMid, newMid);
  } else {
    ops = [...oldMid.map(text => ({ type: '-' as const, text })), ...newMid.map(text => ({ type: '+' as const, text }))];
  }
  const added = ops.filter(o => o.type === '+').length;
  const removed = ops.filter(o => o.type === '-').length;

  const CONTEXT = 3;
  const before = oldLines.slice(Math.max(0, prefix - CONTEXT), prefix);
  const after = oldLines.slice(oldLines.length - suffix, oldLines.length - suffix + CONTEXT);
  const firstLine = prefix - before.length + 1;
  let lines: string[] = [];
  lines.push(`@@ old lines ${firstLine}-${prefix + oldMid.length + after.length} / new lines ${firstLine}-${prefix + newMid.length + after.length} @@`);
  for (const l of before) lines.push(`  ${l}`);
  for (const o of ops) lines.push(`${o.type === ' ' ? ' ' : o.type} ${o.text}`);
  for (const l of after) lines.push(`  ${l}`);
  if (lines.length > maxExcerptLines) {
    const dropped = lines.length - maxExcerptLines;
    lines = [...lines.slice(0, maxExcerptLines), `  ... (${dropped} more diff lines)`];
  }

  return { path: filePath, added, removed, excerpt: lines.map(l => l.slice(0, 160)).join('\n') };
}
