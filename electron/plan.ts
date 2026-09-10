/**
 * Structured plans and the execution checklist.
 *
 * The architect used to hand the worker a wall of prose, and the worker had
 * to re-plan from it every turn - a 30B model re-deriving "what am I doing"
 * from scratch, 25 times, is how a run drifts. The plan is now parsed into a
 * checklist the ENGINE tracks: it knows which task is current, which files
 * each task touches, and whether the worker stopped early. The model is told
 * exactly where it is instead of being asked to remember.
 *
 * Everything here is deterministic string processing. No model calls.
 */

export type TaskStatus = 'pending' | 'active' | 'done';

export interface PlanTask {
  id: number;
  title: string;
  files: string[];
  doneWhen?: string;
  /** 'inspect' tasks are satisfied by reading; 'run' by a command; 'edit' by a write. */
  kind: 'inspect' | 'edit' | 'run' | 'other';
  status: TaskStatus;
  evidence?: string;
}

export interface TaskPlan {
  goal: string;
  tasks: PlanTask[];
  verify: string[];
  risks: string[];
  raw: string;
  /** True when no tasks could be parsed and a generic fallback was synthesized. */
  synthesized: boolean;
}

const FILE_RE = /[\w\-./\\]+\.(tsx?|jsx?|mjs|cjs|json|css|scss|less|html?|py|ps1|bat|md|ya?ml|rs|go|java|cs|toml|sql|vue|svelte|txt|xml|sh)\b/gi;

function extractFiles(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of text.match(FILE_RE) || []) {
    const f = m.replace(/^[`'"(]+|[`'"),.:;]+$/g, '').replace(/\\/g, '/');
    if (!f || f.length < 3) continue;
    // "e.g." and version-like tokens are not files.
    if (/^(e\.g|i\.e|etc)\./i.test(f)) continue;
    if (!seen.has(f)) { seen.add(f); out.push(f); }
  }
  return out;
}

function classifyKind(title: string): PlanTask['kind'] {
  const t = title.toLowerCase();
  if (/^(run|execute|test|build|typecheck|compile|verify|validate|lint|check that|confirm)\b/.test(t) || /\b(npm|pnpm|yarn|cargo|pytest|tsc|node --check)\b/.test(t)) return 'run';
  if (/^(inspect|read|review|analy[sz]e|examine|scan|list|open|look|understand|study|locate|find|identify|survey|map)\b/.test(t)) return 'inspect';
  if (/\b(edit|modify|update|change|add|create|write|implement|refactor|replace|remove|delete|rename|fix|insert|extend|introduce|wire|hook|patch|move|extract|convert|migrate)\b/.test(t)) return 'edit';
  return 'other';
}

function sectionBody(md: string, names: string[]): string | null {
  const lines = md.split('\n');
  const headerRe = new RegExp(`^\\s*(?:#{1,4}\\s*|\\*\\*)?(?:${names.join('|')})\\b[^\\n]*?(?::|\\*\\*)?\\s*$`, 'i');
  for (let i = 0; i < lines.length; i++) {
    if (!headerRe.test(lines[i].trim())) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^\s*#{1,4}\s+\S/.test(l)) break;
      if (/^\s*\*\*[A-Za-z][^*]{1,40}\*\*:?\s*$/.test(l) && body.length) break;
      body.push(l);
    }
    return body.join('\n');
  }
  return null;
}

/**
 * Parses the architect's markdown into a checklist. Tolerant by design:
 * a "## Tasks" section is preferred, but any numbered list will do, and a
 * blueprint with no list at all yields a synthesized generic plan.
 */
const SLUG_STOP = new Set(['help', 'me', 'design', 'create', 'write', 'make', 'build', 'the', 'a', 'an', 'for', 'of', 'and', 'to', 'with', 'my', 'our', 'this', 'that', 'please', 'new', 'some']);

function slugFromPrompt(prompt: string): string {
  const words = (prompt || '').toLowerCase().match(/[a-z][a-z0-9]+/g) || [];
  const picked = words.filter(w => w.length >= 3 && !SLUG_STOP.has(w)).slice(0, 5);
  return picked.length ? picked.join('-') : 'design';
}

/** True when the request wants a document (design, plan, spec) rather than a code change. */
export function isDocumentRequest(prompt: string): boolean {
  const p = (prompt || '').toLowerCase();
  return /\b(design (an?|the) architecture|architecture (design|proposal|document)|design doc|proposal|write-?up|specification|spec for|roadmap|documentation for|document (the|this|how)|readme|migration plan|implementation plan|technical plan|adr\b)/.test(p)
    || /\b(design|architect|plan|document|outline|propose)\b/.test(p) && !/\b(fix|bug|edit|refactor|rename|implement|add|remove|delete|update|change)\b/.test(p);
}

/**
 * A request-aware fallback checklist for when the architect returned no
 * task list. The old fallback said "implement the requested change", which
 * for a design request let the worker inspect files for ten turns and
 * stop, having produced nothing - the deliverable was never named.
 */
export function synthesizePlan(prompt: string, verifyCommand?: string): TaskPlan {
  const tasks: PlanTask[] = [];
  if (isDocumentRequest(prompt)) {
    const file = `docs/${slugFromPrompt(prompt)}.md`;
    tasks.push(
      { id: 1, title: 'Survey the existing code and docs relevant to the request with search_codebase / read_file (at most 3 calls)', files: [], kind: 'inspect', status: 'pending' },
      { id: 2, title: `Write the complete deliverable document to ${file} with write_file`, files: [file], kind: 'edit', status: 'pending', doneWhen: `${file} exists and contains the full design, not a summary` },
      { id: 3, title: `Reply "DONE:" with the path ${file} and a 3-line summary`, files: [], kind: 'other', status: 'pending' }
    );
    return { goal: `Produce the requested document at ${file}`, tasks, verify: [], risks: [], raw: '', synthesized: true };
  }
  tasks.push(
    { id: 1, title: 'Locate the relevant code with search_codebase / read_file', files: [], kind: 'inspect', status: 'pending' },
    { id: 2, title: 'Implement the requested change with edit_file / write_file', files: [], kind: 'edit', status: 'pending' },
    { id: 3, title: verifyCommand ? `Run \`${verifyCommand}\` and fix anything it reports` : 'Re-read the edited region to confirm the change', files: [], kind: 'run', status: 'pending' },
    { id: 4, title: 'Reply "DONE:" listing the files changed', files: [], kind: 'other', status: 'pending' }
  );
  return { goal: 'Complete the requested change', tasks, verify: verifyCommand ? [verifyCommand] : [], risks: [], raw: '', synthesized: true };
}

/**
 * A coder model told to answer "in EXACTLY this structure and nothing else"
 * sometimes emits the whole blueprint twice. Keep the first copy.
 */
export function dedupeRepeatedBlueprint(md: string): string {
  const text = (md || '').replace(/\r\n/g, '\n');
  const marks = [...text.matchAll(/^#{1,3}\s*(goal|tasks)\b/gim)].map(m => ({ name: m[1].toLowerCase(), index: m.index || 0 }));
  const goals = marks.filter(m => m.name === 'goal');
  if (goals.length >= 2) return text.slice(0, goals[1].index).trimEnd();
  const tasksMarks = marks.filter(m => m.name === 'tasks');
  if (tasksMarks.length >= 2) return text.slice(0, tasksMarks[1].index).trimEnd();
  const half = Math.floor(text.length / 2);
  if (text.length > 200 && text.slice(0, half).trim() === text.slice(half).trim()) return text.slice(0, half).trimEnd();
  return text;
}

export function parseBlueprint(md: string, maxTasks = 12, opts: { prompt?: string; verifyCommand?: string } = {}): TaskPlan {
  const raw = dedupeRepeatedBlueprint(md);

  const goalBody = sectionBody(raw, ['goal', 'objective', 'summary']);
  let goal = '';
  if (goalBody) {
    goal = goalBody.split('\n').map(l => l.trim()).find(l => l && !/^[-*]\s*$/.test(l)) || '';
    goal = goal.replace(/^[-*]\s+/, '');
  }
  if (!goal) {
    goal = raw.split('\n').map(l => l.trim()).find(l => l && !/^#/.test(l) && !/^\d+[.)]/.test(l) && !/^[-*]\s/.test(l) && l.length > 12) || '';
  }
  goal = goal.slice(0, 240);

  const tasksBody = sectionBody(raw, ['tasks', 'task list', 'steps', 'plan', 'implementation steps', 'execution steps', 'blueprint', 'checklist']);
  // Inside an explicit Tasks section, plain "- " bullets are tasks too.
  // Elsewhere only numbered / checkbox items count, since loose bullets are
  // usually risks or notes.
  const sectionHasItems = !!tasksBody && /^\s{0,1}(\d+[.)]|[-*•]\s*(\[[ xX]\])?)\s+\S/m.test(tasksBody);
  const source = sectionHasItems ? (tasksBody as string) : raw;
  const allowBullets = sectionHasItems;

  const tasks: PlanTask[] = [];
  const lines = source.split('\n');
  let current: { title: string; detail: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const title = current.title.replace(/\*\*/g, '').replace(/`/g, '').trim();
    if (title) {
      const full = `${current.title}\n${current.detail.join('\n')}`;
      const doneMatch = full.match(/(?:done when|success criteria|verify(?:\s+by)?|acceptance)\s*[:\-–—]\s*([^\n]+)/i);
      // An explicit "files:" segment is authoritative. Scanning the whole line
      // used to pull files mentioned in the done-when clause ("...and the
      // import in src/index.ts resolves") into the task's own file list.
      const filesSeg = full.match(/\bfiles?\s*:\s*([^\n]*?)(?=\s+[-–—]\s+(?:done when|success criteria|verify|acceptance)\b|\n|$)/i);
      const taskFiles = filesSeg && extractFiles(filesSeg[1]).length ? extractFiles(filesSeg[1]) : extractFiles(full);
      let cleanTitle = title
        .replace(/\s*[-–—]\s*files?\s*:.*$/i, '')
        .replace(/\s*[-–—]\s*done when\s*:.*$/i, '')
        .replace(/\s*\(files?:[^)]*\)/i, '')
        .trim();
      if (cleanTitle.length > 160) cleanTitle = cleanTitle.slice(0, 157) + '...';
      tasks.push({
        id: tasks.length + 1,
        title: cleanTitle,
        files: taskFiles.slice(0, 8),
        doneWhen: doneMatch ? doneMatch[1].trim().slice(0, 160) : undefined,
        kind: classifyKind(cleanTitle),
        status: 'pending'
      });
    }
    current = null;
  };

  for (const line of lines) {
    if (tasks.length >= maxTasks) break;
    const numbered = line.match(/^\s{0,3}(?:\d+[.)]|[-*]\s*\[[ xX]\])\s+(.+)$/)
      || (allowBullets ? line.match(/^\s{0,1}[-*•]\s+(?!\[)(.+)$/) : null);
    if (numbered) {
      flush();
      current = { title: numbered[1], detail: [] };
      continue;
    }
    if (current) {
      // Indented continuation / sub-bullets belong to the task above.
      if (/^\s{2,}\S/.test(line) || /^\s*[-*•]\s+/.test(line)) {
        current.detail.push(line.trim());
        continue;
      }
      if (!line.trim()) continue;
      flush();
    }
  }
  flush();

  const verifyBody = sectionBody(raw, ['verify', 'verification', 'validation', 'quality gates', 'tests']);
  const verify: string[] = [];
  if (verifyBody) {
    for (const m of verifyBody.match(/`([^`\n]{2,120})`/g) || []) verify.push(m.replace(/`/g, '').trim());
    if (!verify.length) {
      for (const l of verifyBody.split('\n')) {
        const t = l.replace(/^\s*[-*\d.)]+\s*/, '').trim();
        if (t) verify.push(t.slice(0, 160));
      }
    }
  }

  const risksBody = sectionBody(raw, ['risks', 'risk', 'caveats', 'watch out', 'notes']);
  const risks: string[] = [];
  if (risksBody) {
    for (const l of risksBody.split('\n')) {
      const t = l.replace(/^\s*[-*\d.)]+\s*/, '').trim();
      if (t) risks.push(t.slice(0, 200));
    }
  }

  if (tasks.length === 0) {
    const fallback = synthesizePlan(opts.prompt || '', opts.verifyCommand);
    fallback.raw = raw;
    if (goal) fallback.goal = goal;
    return fallback;
  }

  return { goal, tasks, verify: verify.slice(0, 6), risks: risks.slice(0, 6), raw, synthesized: false };
}

export function renderChecklist(plan: TaskPlan, opts: { withGoal?: boolean; compact?: boolean } = {}): string {
  const lines: string[] = [];
  if (opts.withGoal !== false && plan.goal) lines.push(`GOAL: ${plan.goal}`);
  for (const t of plan.tasks) {
    const mark = t.status === 'done' ? '[x]' : t.status === 'active' ? '[>]' : '[ ]';
    const files = t.files.length && !opts.compact ? ` (files: ${t.files.join(', ')})` : '';
    const done = t.doneWhen && !opts.compact ? ` — done when: ${t.doneWhen}` : '';
    lines.push(`${mark} ${t.id}. ${t.title}${files}${done}`);
  }
  if (plan.verify.length && !opts.compact) lines.push(`VERIFY: ${plan.verify.join(' ; ')}`);
  return lines.join('\n');
}

export function pendingTasks(plan: TaskPlan): PlanTask[] {
  return plan.tasks.filter(t => t.status !== 'done');
}

export function nextTask(plan: TaskPlan): PlanTask | undefined {
  return plan.tasks.find(t => t.status === 'active') || plan.tasks.find(t => t.status === 'pending');
}

function fileMatches(taskFiles: string[], touched: string): boolean {
  const t = touched.replace(/\\/g, '/').toLowerCase();
  const base = t.split('/').pop() || t;
  return taskFiles.some(f => {
    const ff = f.toLowerCase();
    const fb = ff.split('/').pop() || ff;
    return t === ff || t.endsWith('/' + ff) || ff.endsWith('/' + t) || fb === base;
  });
}

/**
 * Advances the checklist from an observed tool result. Coarse on purpose:
 * an edit task is done once one of its files was successfully written; an
 * inspect task once one of its files was read (or, with no files named, once
 * anything was read); a run task once a command succeeded. Tasks without
 * files or verbs are closed by the worker's own completion claim instead.
 */
export function applyToolOutcome(
  plan: TaskPlan | null,
  toolName: string,
  args: any,
  success: boolean
): { changed: boolean; task?: PlanTask } {
  if (!plan || !success) return { changed: false };
  const target: string = String(args?.path || args?.dirPath || args?.file || '');
  const isWrite = toolName === 'write_file' || toolName === 'edit_file';
  const isRead = toolName === 'read_file' || toolName === 'search_codebase' || toolName === 'list_files';
  const isRun = toolName === 'run_command';

  for (const t of plan.tasks) {
    if (t.status === 'done') continue;
    if (t.kind === 'edit' && isWrite && (t.files.length === 0 || fileMatches(t.files, target))) {
      t.status = 'done';
      t.evidence = `${toolName} ${target}`;
      return { changed: true, task: t };
    }
    if (t.kind === 'inspect' && isRead && (t.files.length === 0 || fileMatches(t.files, target))) {
      t.status = 'done';
      t.evidence = `${toolName} ${target || ''}`.trim();
      return { changed: true, task: t };
    }
    if (t.kind === 'run' && isRun) {
      t.status = 'done';
      t.evidence = `run_command: ${String(args?.command || '').slice(0, 80)}`;
      return { changed: true, task: t };
    }
    // An edit landing on a later task's file implicitly finishes an earlier
    // inspect step for the same file.
    if (t.kind === 'inspect' && isWrite && fileMatches(t.files, target)) {
      t.status = 'done';
      t.evidence = `edited ${target}`;
      continue;
    }
    // Only the first non-done task of a matching kind advances; keep scanning
    // for a file match further down so out-of-order execution still counts.
    if (t.files.length && !fileMatches(t.files, target)) continue;
    if (t.kind === 'other') continue;
  }

  // Mark the first pending task active so the checklist shows a cursor.
  const first = plan.tasks.find(t => t.status === 'pending');
  if (first && !plan.tasks.some(t => t.status === 'active')) {
    first.status = 'active';
    return { changed: true, task: first };
  }
  return { changed: false };
}

/**
 * When the worker declares completion, accept pending edit tasks whose files
 * were all actually written during the run. Two tasks that name the same file
 * are often satisfied by one edit; the per-edit inference can only credit the
 * first, and nagging the worker about the second wastes a turn.
 */
export function closeTasksClaimedDone(plan: TaskPlan | null, editedPaths: string[]): PlanTask[] {
  if (!plan || !editedPaths.length) return [];
  const closed: PlanTask[] = [];
  for (const t of plan.tasks) {
    if (t.status === 'done' || t.kind !== 'edit' || t.files.length === 0) continue;
    // "Some", not "every": architects routinely list related files a task
    // only reads. The worker's explicit claim plus a real write to one of the
    // task's files is enough; the review phase checks the result anyway.
    const touched = t.files.filter(f => editedPaths.some(p => fileMatches([f], p)));
    if (touched.length) {
      t.status = 'done';
      t.evidence = `worker declared done; ${touched.join(', ')} edited this run`;
      closed.push(t);
    }
  }
  return closed;
}

/** "TASK 3 DONE: replaced the loop" / "task 2 complete" / "TASK 4 SKIP: not needed". */
export function applyCompletionClaims(plan: TaskPlan | null, text: string): PlanTask[] {
  if (!plan || !text) return [];
  const closed: PlanTask[] = [];
  const re = /\btask\s*#?(\d+)\s*(?:is\s+|was\s+|-\s*|:\s*)?(done|complete|completed|finished|skip|skipped|not needed|n\/a)\b(?:\s*[:\-–—]\s*([^\n]{0,160}))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const id = parseInt(m[1], 10);
    const t = plan.tasks.find(x => x.id === id);
    if (t && t.status !== 'done') {
      t.status = 'done';
      t.evidence = `worker: ${m[2]}${m[3] ? ` — ${m[3].trim()}` : ''}`;
      closed.push(t);
    }
  }
  return closed;
}

/**
 * True when the model described an action instead of taking it. This is the
 * single most common way a local run ends one turn in: "Let me read the
 * file to check..." followed by silence, because no tool was called.
 */
export function detectNarratedIntent(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  const tail = t.slice(-600).toLowerCase();
  if (/\b(let me|let's|i(?:'ll| will| am going to| shall|'m going to)|next,? i(?:'ll| will)?|now i(?:'ll| will)?|i need to|i should|we need to|going to|proceed(?:ing)? (?:to|with)|first,? i(?:'ll| will)?|i(?:'ll| will) (?:now |first |then )?(?:start|begin)) (?:\w+ ){0,4}(?:read|open|check|look|inspect|edit|update|modify|create|write|run|execute|search|list|examine|apply|implement|add|fix|verify|test|call)\b/.test(tail)) {
    return true;
  }
  if (/:\s*$/.test(t) && t.length < 400) return true;
  return false;
}

/** The model believes it has finished. */
export function detectCompletionClaim(text: string): boolean {
  const t = (text || '').toLowerCase();
  // "DONE:" at the start of a line is the format the system prompt asks for.
  if (/(^|\n)\s*(?:\*\*|#+\s*)?done(?:\*\*)?\s*[:.!\-—]/.test(t)) return true;
  return /\b(all (?:tasks|steps|changes) (?:are )?(?:complete|done|implemented)|task(?:s)? (?:is|are) (?:now )?complete|(?:implementation|changes?) (?:is|are|has been) complete|i(?:'ve| have) (?:now )?(?:completed|finished|implemented)|summary of (?:the )?changes|changes made:|done\.|complete\.)\b/.test(t);
}

/**
 * Text-embedded tool calls. llama-server without a matching template, and
 * many Ollama models, emit the call as JSON or <tool_call> XML in the content
 * instead of the structured field. Losing those ends the run for no reason.
 */
export function extractEmbeddedToolCalls(text: string): { calls: any[]; stripped: string } {
  const calls: any[] = [];
  let stripped = text || '';
  if (!stripped) return { calls, stripped };

  const tryPush = (jsonText: string): boolean => {
    try {
      const obj = JSON.parse(jsonText);
      const name = obj?.name || obj?.function?.name || obj?.tool;
      const args = obj?.arguments ?? obj?.parameters ?? obj?.function?.arguments ?? obj?.args ?? {};
      if (typeof name === 'string' && name && typeof args === 'object') {
        calls.push({
          id: `call_text_${Date.now()}_${calls.length}`,
          type: 'function',
          function: { name, arguments: args }
        });
        return true;
      }
    } catch {}
    return false;
  };

  const xml = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  stripped = stripped.replace(xml, (whole, inner) => (tryPush(inner.trim()) ? '' : whole));

  const fence = /```(?:json|tool_call|tool)?\s*(\{[\s\S]*?\})\s*```/g;
  stripped = stripped.replace(fence, (whole, inner) => {
    if (!/"(name|tool|function)"\s*:/.test(inner)) return whole;
    return tryPush(inner) ? '' : whole;
  });

  if (!calls.length) {
    const bare = stripped.match(/\{[\s\r\n]*"name"[\s\r\n]*:[\s\r\n]*"[a-zA-Z0-9_-]+"[\s\S]*?"arguments"[\s\r\n]*:[\s\r\n]*\{[\s\S]*?\}[\s\r\n]*\}/);
    if (bare && tryPush(bare[0])) stripped = stripped.replace(bare[0], '');
  }

  return { calls, stripped: stripped.trim() };
}

/** Parses the architect's review into a verdict. Defaults to approve so an unparsable review can never loop the run. */
export function parseReviewVerdict(text: string): { verdict: 'approve' | 'revise'; issues: string[]; nextSteps: string[] } {
  const t = text || '';
  const verdictMatch = t.match(/verdict\s*[:\-–—]?\s*\**\s*(approve[d]?|revise|reject(?:ed)?|needs? (?:work|revision|changes))/i);
  let verdict: 'approve' | 'revise' = 'approve';
  if (verdictMatch && !/^approve/i.test(verdictMatch[1])) verdict = 'revise';

  const grab = (names: string[]): string[] => {
    const body = sectionBody(t, names);
    if (!body) return [];
    return body.split('\n')
      .map(l => l.replace(/^\s*[-*\d.)]+\s*/, '').trim())
      .filter(l => l && !/^(none|n\/a|no issues?)\b/i.test(l))
      .slice(0, 8);
  };
  const issues = grab(['issues', 'problems', 'defects', 'findings']);
  const nextSteps = grab(['next steps', 'required changes', 'fix', 'fixes', 'actions', 'corrections']);
  if (verdict === 'revise' && issues.length === 0 && nextSteps.length === 0) {
    // A "revise" with nothing actionable is noise, not a verdict.
    verdict = 'approve';
  }
  return { verdict, issues, nextSteps };
}
