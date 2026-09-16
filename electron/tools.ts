import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { trackChild, killTree } from './children';

export interface ToolResult {
  success: boolean;
  output: string;
  diff?: { path: string; oldContent: string; newContent: string };
}

/**
 * Roots the agent is permitted to touch. Anything resolving outside every root
 * is refused before it reaches the filesystem.
 *
 * Previously `resolvePath` returned ANY absolute path unchanged, and relative
 * paths could `..` their way out of the workspace - so an autonomous run could
 * write anywhere the Electron process had rights, including system directories.
 */
export const DEFAULT_ALLOWED_ROOTS = [
  'D:\\AntiGravity',
  'C:\\AI_dev'
];

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-electron', 'Cache', 'GPUCache',
  '.next', '.venv', 'venv', '__pycache__', '.turbo', '.cache',
  'out', 'build', 'target', '.vite', 'coverage', '.idea', 'bin', 'obj',
  '.pytest_cache', '.mypy_cache'
]);

const SEARCHABLE_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'json', 'css', 'scss', 'less', 'html', 'htm', 'md', 'mdx',
  'py', 'rs', 'go', 'cs', 'java', 'kt', 'swift', 'ps1', 'psm1', 'bat', 'cmd', 'sh', 'yaml', 'yml',
  'toml', 'ini', 'cfg', 'txt', 'sql', 'vue', 'svelte', 'xml', 'graphql', 'proto', 'c', 'h', 'cpp',
  'hpp', 'cc', 'env', 'lua', 'rb', 'php', 'vbs'
]);

export class PathNotAllowedError extends Error {
  constructor(public readonly attempted: string, public readonly roots: string[]) {
    super(
      `Path is outside the allowed workspace roots: ${attempted}\n` +
      `Allowed roots: ${roots.join(', ')}\n` +
      `Refusing the operation. Move the target inside an allowed root, or add the root to DEFAULT_ALLOWED_ROOTS.`
    );
    this.name = 'PathNotAllowedError';
  }
}

export class ToolExecutor {
  workspaceDir: string;
  allowedRoots: string[];

  constructor(workspaceDir: string, allowedRoots: string[] = DEFAULT_ALLOWED_ROOTS) {
    this.workspaceDir = workspaceDir;
    this.allowedRoots = ToolExecutor.normalizeRoots([...allowedRoots, workspaceDir]);
  }

  private static normalizeRoots(roots: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of roots) {
      if (!r) continue;
      const norm = path.resolve(r);
      const key = process.platform === 'win32' ? norm.toLowerCase() : norm;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(norm);
    }
    return out;
  }

  setWorkspace(dir: string) {
    this.workspaceDir = dir;
    // A newly opened workspace becomes an allowed root in its own right, so
    // opening a project outside D:\AntiGravity still works.
    this.allowedRoots = ToolExecutor.normalizeRoots([...this.allowedRoots, dir]);
  }

  /** True when `candidate` is inside `root` (or is `root` itself). */
  private static isInside(candidate: string, root: string): boolean {
    const rel = path.relative(root, candidate);
    if (rel === '') return true;
    if (rel.startsWith('..')) return false;
    return !path.isAbsolute(rel);
  }

  isPathAllowed(targetPath: string): boolean {
    const resolved = path.resolve(
      path.isAbsolute(targetPath) ? targetPath : path.join(this.workspaceDir, targetPath)
    );
    return this.allowedRoots.some(root => ToolExecutor.isInside(resolved, root));
  }

  resolvePath(targetPath: string): string {
    const resolved = path.resolve(
      path.isAbsolute(targetPath) ? targetPath : path.join(this.workspaceDir, targetPath)
    );
    if (!this.allowedRoots.some(root => ToolExecutor.isInside(resolved, root))) {
      throw new PathNotAllowedError(resolved, this.allowedRoots);
    }
    return resolved;
  }

  async readFile(filePath: string, startLine?: number, lineCount?: number): Promise<ToolResult> {
    let fullPath: string;
    try {
      fullPath = this.resolvePath(filePath);
    } catch (err: any) {
      return { success: false, output: err.message };
    }
    try {
      if (!fs.existsSync(fullPath)) {
        const hint = this.suggestSimilarPath(filePath);
        return {
          success: false,
          output: `File not found: ${filePath}.${hint ? ` Did you mean: ${hint}?` : ''} Use search_codebase or list_files to verify available paths.`
        };
      }

      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        return { success: false, output: `${filePath} is a directory. Use list_files to see its contents.` };
      }
      if (stats.size > 10 * 1024 * 1024) {
        return { success: false, output: `File ${filePath} is too large (> 10MB) to read safely into context.` };
      }

      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');

      if (typeof startLine === 'number' && startLine > 0) {
        const startIdx = Math.max(0, startLine - 1);
        const count = typeof lineCount === 'number' && lineCount > 0 ? Math.min(lineCount, 600) : 400;
        const slice = lines.slice(startIdx, startIdx + count);
        const numbered = slice.map((l, i) => `${startIdx + i + 1}: ${l}`).join('\n');
        return {
          success: true,
          output: `[File: ${filePath} • Lines ${startIdx + 1} to ${startIdx + slice.length} of ${lines.length} total lines]\n${numbered}`
        };
      }

      if (lines.length > 500) {
        const head = lines.slice(0, 350).map((l, i) => `${i + 1}: ${l}`).join('\n');
        const tail = lines.slice(-100).map((l, i) => `${lines.length - 100 + i + 1}: ${l}`).join('\n');
        return {
          success: true,
          output: `[File: ${filePath} • ${lines.length} lines total • showing 1-350 and ${lines.length - 99}-${lines.length}]\n${head}\n\n... [${lines.length - 450} lines omitted. To view the omitted section, call read_file with startLine: 351, lineCount: 200, or use search_codebase to jump straight to the symbol you need] ...\n\n${tail}`
        };
      }
      const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n');
      return { success: true, output: `[File: ${filePath} • ${lines.length} lines]\n${numbered}` };
    } catch (err: any) {
      return { success: false, output: `Error reading file: ${err.message}` };
    }
  }

  /** Best-effort "did you mean" for a missing path: same basename anywhere shallow in the workspace. */
  private suggestSimilarPath(requested: string): string | null {
    try {
      const base = requested.replace(/\\/g, '/').split('/').pop()?.toLowerCase();
      if (!base) return null;
      const found: string[] = [];
      const walk = (dir: string, depth: number) => {
        if (depth > 4 || found.length >= 3) return;
        let entries: fs.Dirent[];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          if (found.length >= 3) return;
          if (e.isDirectory()) {
            if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.') || /^(backup|agent-leftovers)/i.test(e.name)) continue;
            walk(path.join(dir, e.name), depth + 1);
          } else if (e.name.toLowerCase() === base) {
            found.push(path.relative(this.workspaceDir, path.join(dir, e.name)).replace(/\\/g, '/'));
          }
        }
      };
      walk(this.workspaceDir, 0);
      return found.length ? found.join(' or ') : null;
    } catch {
      return null;
    }
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    let fullPath: string;
    try {
      fullPath = this.resolvePath(filePath);
    } catch (err: any) {
      return { success: false, output: err.message };
    }
    try {
      const oldContent = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '';
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, 'utf-8');
      const oldLines = oldContent ? oldContent.split('\n').length : 0;
      const newLines = content.split('\n').length;
      const shrinkWarning = oldLines > 40 && newLines < oldLines * 0.5
        ? ` [Warning: the file shrank from ${oldLines} to ${newLines} lines. If you intended a partial change, you may have dropped content - prefer edit_file for targeted changes.]`
        : '';
      return {
        success: true,
        output: `Successfully wrote ${content.length} characters (${newLines} lines) to ${filePath}${oldContent ? ` (replaced ${oldLines} lines)` : ' (new file)'}${shrinkWarning}`,
        diff: { path: filePath, oldContent, newContent: content }
      };
    } catch (err: any) {
      return { success: false, output: `Error writing file: ${err.message}` };
    }
  }

  /**
   * Strips "NN: " line-number prefixes that models copy straight out of
   * read_file output into targetContent. Only fires when most lines carry one.
   */
  private static stripLineNumberPrefixes(text: string): { text: string; stripped: boolean } {
    const lines = text.split('\n');
    const nonEmpty = lines.filter(l => l.trim().length > 0);
    if (nonEmpty.length === 0) return { text, stripped: false };
    const prefixed = nonEmpty.filter(l => /^\s*\d+:\s?/.test(l)).length;
    if (prefixed < Math.max(1, Math.ceil(nonEmpty.length * 0.7))) return { text, stripped: false };
    return { text: lines.map(l => l.replace(/^\s*\d+:\s?/, '')).join('\n'), stripped: true };
  }

  /**
   * Finds the region of the file that most resembles the target block, so a
   * failed edit tells the model exactly which lines to copy instead of
   * sending it back to re-read the whole file.
   */
  /** Token-level Dice similarity between two source lines (0..1). Whitespace-insensitive. */
  private static lineSimilarity(a: string, b: string): number {
    const tok = (s: string) => s.match(/[A-Za-z_$][\w$]*|\d+|[^\s\w]/g) || [];
    const ta = tok(a);
    const tb = tok(b);
    if (!ta.length || !tb.length) return 0;
    const counts = new Map<string, number>();
    for (const t of ta) counts.set(t, (counts.get(t) || 0) + 1);
    let common = 0;
    for (const t of tb) {
      const c = counts.get(t) || 0;
      if (c > 0) { common++; counts.set(t, c - 1); }
    }
    return (2 * common) / (ta.length + tb.length);
  }

  private static closestRegion(fileLines: string[], targetLines: string[]): { start: number; end: number; score: number } | null {
    const tgt = targetLines.map(l => l.trim()).filter(l => l.length > 0);
    if (tgt.length === 0) return null;
    const ANCHOR = 0.5;

    // Any file line that is at least half-similar to some target line is a
    // candidate anchor. Exact containment used to be required, so a target the
    // model slightly misremembered (the common failure) produced no hint at all.
    let best: { start: number; end: number; score: number } | null = null;
    const fileTrimmed = fileLines.map(l => l.trim());
    for (let i = 0; i < fileTrimmed.length; i++) {
      const line = fileTrimmed[i];
      if (!line) continue;
      let anchorHit = false;
      for (const t of tgt) {
        if (line === t || ToolExecutor.lineSimilarity(line, t) >= ANCHOR) { anchorHit = true; break; }
      }
      if (!anchorHit) continue;

      const windowStart = Math.max(0, i - 2);
      const windowEnd = Math.min(fileLines.length - 1, windowStart + tgt.length + 3);
      const window = fileTrimmed.slice(windowStart, windowEnd + 1).filter(l => l.length > 0);
      // Score: for each target line, its best similarity inside the window.
      let score = 0;
      for (const t of tgt) {
        let bestSim = 0;
        for (const w of window) {
          const s = w === t ? 1 : ToolExecutor.lineSimilarity(w, t);
          if (s > bestSim) bestSim = s;
          if (bestSim === 1) break;
        }
        if (bestSim >= ANCHOR) score += bestSim;
      }
      if (!best || score > best.score) best = { start: windowStart, end: windowEnd, score };
    }
    if (best) best.score = Math.round(best.score * 10) / 10;
    return best;
  }

  async editFile(filePath: string, targetContent: string, replacementContent: string): Promise<ToolResult> {
    let fullPath: string;
    try {
      fullPath = this.resolvePath(filePath);
    } catch (err: any) {
      return { success: false, output: err.message };
    }
    try {
      if (!fs.existsSync(fullPath)) {
        const hint = this.suggestSimilarPath(filePath);
        return { success: false, output: `File not found: ${filePath}.${hint ? ` Did you mean: ${hint}?` : ''}` };
      }
      if (!targetContent || !targetContent.trim()) {
        return { success: false, output: `targetContent is empty. Provide the exact lines to replace (copied from read_file output, without the "NN: " line-number prefixes). To create a new file or overwrite one, use write_file.` };
      }
      const rawContent = fs.readFileSync(fullPath, 'utf-8');
      const hasCrlf = rawContent.includes('\r\n');

      // Normalize line endings to LF for resilient matching across Windows and POSIX
      const normOld = rawContent.replace(/\r\n/g, '\n');
      let normTarget = targetContent.replace(/\r\n/g, '\n');
      let normReplacement = replacementContent.replace(/\r\n/g, '\n');

      // Tier 0: the model pasted read_file output verbatim, line numbers included.
      const strippedTarget = ToolExecutor.stripLineNumberPrefixes(normTarget);
      let prefixNote = '';
      if (strippedTarget.stripped && !normOld.includes(normTarget)) {
        normTarget = strippedTarget.text;
        const strippedRep = ToolExecutor.stripLineNumberPrefixes(normReplacement);
        if (strippedRep.stripped) normReplacement = strippedRep.text;
        prefixNote = ' [Note: "NN: " line-number prefixes were stripped from your target/replacement. Do not include them in future edits.]';
      }

      let finalContent = '';
      let matchedVia = 'exact';
      if (normOld.includes(normTarget)) {
        // The replacement MUST go through a function. String.prototype.replace
        // interprets $&, $1, $` and $' inside a string replacement as capture
        // patterns, so any generated code containing those sequences (regex
        // literals, shell/PowerShell variables, jQuery, sed scripts) was being
        // silently corrupted on write.
        const normNew = normOld.replace(normTarget, () => normReplacement);
        finalContent = hasCrlf ? normNew.replace(/\n/g, '\r\n') : normNew;
      } else {
        // Tier 2: match with trimmed trailing whitespace per line
        const oldLines = normOld.split('\n');
        const targetLines = normTarget.split('\n').map(l => l.trimEnd());
        let matchIndex = -1;

        for (let i = 0; i <= oldLines.length - targetLines.length; i++) {
          let matches = true;
          for (let j = 0; j < targetLines.length; j++) {
            if (oldLines[i + j].trimEnd() !== targetLines[j]) {
              matches = false;
              break;
            }
          }
          if (matches) {
            matchIndex = i;
            matchedVia = 'trailing-whitespace-tolerant';
            break;
          }
        }

        if (matchIndex === -1) {
          // Tier 3: match lines trimmed on both ends (tolerant to leading indentation differences),
          // then re-indent the replacement to the indentation actually found in the file.
          const targetLinesBothTrimmed = normTarget.split('\n').map(l => l.trim()).filter(l => l.length > 0);
          if (targetLinesBothTrimmed.length > 0) {
            for (let i = 0; i <= oldLines.length - targetLinesBothTrimmed.length; i++) {
              let matches = true;
              let matchedOldCount = 0;
              let targetIdx = 0;
              for (let k = i; k < oldLines.length && targetIdx < targetLinesBothTrimmed.length; k++) {
                const oldTrimmed = oldLines[k].trim();
                if (oldTrimmed === '') continue;
                if (oldTrimmed !== targetLinesBothTrimmed[targetIdx]) {
                  matches = false;
                  break;
                }
                targetIdx++;
                matchedOldCount = (k - i) + 1;
              }
              if (matches && targetIdx === targetLinesBothTrimmed.length) {
                matchIndex = i;
                matchedVia = 'indentation-tolerant';
                // Re-indent: shift the replacement by the difference between the
                // file's indentation and the target's, so a model that dropped
                // 4 spaces of nesting still produces correctly nested code.
                const fileIndent = (oldLines[i].match(/^\s*/) || [''])[0];
                const firstTargetLine = normTarget.split('\n').find(l => l.trim().length > 0) || '';
                const targetIndent = (firstTargetLine.match(/^\s*/) || [''])[0];
                const repLinesRaw = normReplacement.split('\n');
                const repLines = repLinesRaw.map(l => {
                  if (!l.trim()) return l;
                  if (targetIndent && l.startsWith(targetIndent)) return fileIndent + l.slice(targetIndent.length);
                  if (!targetIndent) return fileIndent + l.replace(/^\s*/, m => m);
                  return l;
                });
                oldLines.splice(matchIndex, matchedOldCount, ...repLines);
                const normNew = oldLines.join('\n');
                finalContent = hasCrlf ? normNew.replace(/\n/g, '\r\n') : normNew;
                break;
              }
            }
          }
        }

        if (matchIndex === -1) {
          const region = ToolExecutor.closestRegion(oldLines, normTarget.split('\n'));
          let hint = '';
          if (region) {
            const snippet = oldLines.slice(region.start, region.end + 1)
              .map((l, i) => `${region.start + i + 1}: ${l}`).join('\n');
            hint = `\n\nClosest matching region in ${filePath} (lines ${region.start + 1}-${region.end + 1}, ${region.score}/${normTarget.split('\n').filter(l => l.trim()).length} target lines found there):\n${snippet}\n\nCopy the exact lines you want to replace from the region above (without the "NN: " prefixes) into targetContent and retry. Keep targetContent short (3-15 lines) and unique.`;
          } else {
            hint = `\n\nNone of the target lines appear in the file. Use search_codebase to find the right location, or read_file with startLine/lineCount to see the current text, then retry with the exact lines.`;
          }
          return {
            success: false,
            output: `Target content block not found in ${filePath}.${hint}`
          };
        }

        if (!finalContent) {
          const repLines = normReplacement.split('\n');
          oldLines.splice(matchIndex, targetLines.length, ...repLines);
          const normNew = oldLines.join('\n');
          finalContent = hasCrlf ? normNew.replace(/\n/g, '\r\n') : normNew;
        }
      }

      fs.writeFileSync(fullPath, finalContent, 'utf-8');

      // Warn on ambiguous targets: only the FIRST occurrence is replaced, so a
      // non-unique target block silently edits the wrong one.
      const occurrences = normTarget ? normOld.split(normTarget).length - 1 : 0;
      const ambiguity = occurrences > 1
        ? ` [Warning: the target block appears ${occurrences} times; only the first occurrence was replaced. Include surrounding lines to disambiguate.]`
        : '';

      // Show the model the result so it does not need a confirmation read.
      const newLines = finalContent.replace(/\r\n/g, '\n').split('\n');
      const changedAt = (() => {
        const oldL = normOld.split('\n');
        let i = 0;
        while (i < oldL.length && i < newLines.length && oldL[i] === newLines[i]) i++;
        return i;
      })();
      const previewStart = Math.max(0, changedAt - 2);
      const previewEnd = Math.min(newLines.length, changedAt + normReplacement.split('\n').length + 2);
      const preview = newLines.slice(previewStart, previewEnd).map((l, i) => `${previewStart + i + 1}: ${l}`).join('\n');

      return {
        success: true,
        output: `Successfully updated ${filePath} (${matchedVia} match).${ambiguity}${prefixNote}\nResult around the edit (lines ${previewStart + 1}-${previewEnd}):\n${preview}`,
        diff: { path: filePath, oldContent: rawContent, newContent: finalContent }
      };
    } catch (err: any) {
      return { success: false, output: `Error editing file: ${err.message}` };
    }
  }

  async listFiles(dirPath: string = '.', depth: number = 2): Promise<ToolResult> {
    let fullPath: string;
    try {
      fullPath = this.resolvePath(dirPath);
    } catch (err: any) {
      return { success: false, output: err.message };
    }
    const maxDepth = Math.max(1, Math.min(Number(depth) || 2, 4));
    try {
      if (!fs.existsSync(fullPath)) {
        return { success: false, output: `Directory not found: ${dirPath}` };
      }
      const scan = (current: string, currentDepth: number): string[] => {
        if (currentDepth > maxDepth) return [];
        let results: string[] = [];
        const entries = fs.readdirSync(current, { withFileTypes: true });
        for (const e of entries) {
          if (IGNORED_DIRS.has(e.name)) continue;
          const rel = path.relative(this.workspaceDir, path.join(current, e.name));
          if (e.isDirectory()) {
            results.push(`[DIR]  ${rel}`);
            results.push(...scan(path.join(current, e.name), currentDepth + 1));
          } else {
            let size = '';
            try {
              const st = fs.statSync(path.join(current, e.name));
              size = st.size >= 1024 ? ` (${Math.round(st.size / 1024)} KB)` : '';
            } catch {}
            results.push(`[FILE] ${rel}${size}`);
          }
        }
        return results;
      };
      const files = scan(fullPath, 1);
      // Cap the listing. An unbounded scan of a large tree could return tens of
      // thousands of lines straight into the context window - the single easiest
      // way to blow the budget in one tool call.
      const MAX_ENTRIES = 600;
      if (files.length > MAX_ENTRIES) {
        const shown = files.slice(0, MAX_ENTRIES).join('\n');
        return {
          success: true,
          output: `${shown}\n\n... [${files.length - MAX_ENTRIES} more entries omitted. Call list_files on a specific subdirectory to narrow the scan.]`
        };
      }
      return { success: true, output: files.join('\n') || 'Empty directory' };
    } catch (err: any) {
      return { success: false, output: `Error listing files: ${err.message}` };
    }
  }

  /**
   * Bounded grep across the workspace. Without this, a local model's only way
   * to find a symbol was to read entire files and hope - the single largest
   * source of wasted turns and blown context in autonomous runs.
   */
  async searchCodebase(
    query: string,
    opts: { path?: string; fileGlob?: string; maxResults?: number; caseSensitive?: boolean } = {}
  ): Promise<ToolResult> {
    if (!query || !query.trim()) {
      return { success: false, output: 'search_codebase requires a non-empty query.' };
    }
    let root: string;
    try {
      root = this.resolvePath(opts.path || '.');
    } catch (err: any) {
      return { success: false, output: err.message };
    }
    if (!fs.existsSync(root)) {
      return { success: false, output: `Path not found: ${opts.path}` };
    }

    const maxResults = Math.max(1, Math.min(Number(opts.maxResults) || 40, 120));
    const flags = opts.caseSensitive ? 'g' : 'gi';
    let re: RegExp;
    try {
      re = new RegExp(query, flags);
    } catch {
      re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    }

    let globRe: RegExp | null = null;
    if (opts.fileGlob && opts.fileGlob.trim()) {
      const g = opts.fileGlob.trim().replace(/\\/g, '/');
      const pattern = g
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*\//g, '(?:.*/)?')
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '.');
      globRe = new RegExp(g.includes('/') ? `^${pattern}$` : `(^|/)${pattern}$`, 'i');
    }

    const results: string[] = [];
    let filesScanned = 0;
    let filesMatched = 0;
    let truncated = false;
    const MAX_FILES = 1500;
    const MAX_BYTES = 768 * 1024;
    const deadline = Date.now() + 4000;

    const visit = (dir: string, depth: number) => {
      if (truncated || depth > 8 || filesScanned >= MAX_FILES || Date.now() > deadline) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (truncated || results.length >= maxResults) { truncated = results.length >= maxResults; return; }
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (IGNORED_DIRS.has(e.name) || e.name.startsWith('.') || /^(backup|agent-leftovers)/i.test(e.name)) continue;
          visit(full, depth + 1);
          continue;
        }
        if (!e.isFile()) continue;
        const ext = e.name.split('.').pop()?.toLowerCase() || '';
        if (!SEARCHABLE_EXT.has(ext)) continue;
        // Logs and transcripts match everything and teach the model nothing.
        if (/\.(min\.js|min\.css|map|log)$|package-lock\.json$|\.lock$|-live-session\.md$|\.bak(-[\w-]+)?$/i.test(e.name)) continue;
        const rel = path.relative(this.workspaceDir, full).replace(/\\/g, '/');
        if (globRe && !globRe.test(rel)) continue;
        let content: string;
        try {
          const st = fs.statSync(full);
          if (st.size > MAX_BYTES) continue;
          content = fs.readFileSync(full, 'utf-8');
        } catch { continue; }
        filesScanned++;
        const lines = content.split('\n');
        let hitInFile = 0;
        for (let i = 0; i < lines.length; i++) {
          re.lastIndex = 0;
          if (!re.test(lines[i])) continue;
          if (hitInFile === 0) filesMatched++;
          hitInFile++;
          results.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 180)}`);
          if (results.length >= maxResults) { truncated = true; break; }
          if (hitInFile >= 12) { results.push(`${rel}: ... more matches in this file omitted`); break; }
        }
      }
    };

    const stat = fs.statSync(root);
    if (stat.isFile()) {
      visit(path.dirname(root), 8); // depth 8 => only this dir, no recursion
      const rel = path.relative(this.workspaceDir, root).replace(/\\/g, '/');
      const filtered = results.filter(r => r.startsWith(rel + ':'));
      return { success: true, output: filtered.length ? filtered.join('\n') : `No matches for /${query}/ in ${rel}.` };
    }
    visit(root, 0);

    if (results.length === 0) {
      return {
        success: true,
        output: `No matches for /${query}/ in ${filesScanned} files under ${opts.path || 'the workspace'}${opts.fileGlob ? ` (glob ${opts.fileGlob})` : ''}. Try a shorter or case-insensitive term, or a different directory.`
      };
    }
    const header = `${results.length}${truncated ? '+' : ''} matches in ${filesMatched} files (scanned ${filesScanned})${truncated ? ' — result cap reached, narrow the query or path' : ''}:`;
    return { success: true, output: `${header}\n${results.join('\n')}` };
  }

  async runCommand(command: string, timeoutMs: number = 60000): Promise<ToolResult> {
    // The shell inherits the workspace as cwd; refuse to run at all if the
    // workspace itself has drifted outside the allowed roots.
    if (!this.isPathAllowed(this.workspaceDir)) {
      return {
        success: false,
        output: `Refusing to run commands: workspace "${this.workspaceDir}" is outside the allowed roots (${this.allowedRoots.join(', ')}).`
      };
    }
    if (!command || !command.trim()) {
      return { success: false, output: 'run_command requires a non-empty command.' };
    }
    const timeout = Math.max(5000, Math.min(Number(timeoutMs) || 60000, 300000));
    return new Promise((resolve) => {
      // Force UTF-8 encoding in PowerShell to prevent garbled text or encoding crashes
      const utf8Prefix = '$OutputEncoding = [Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ';
      // execFile with an explicit argv instead of exec's implicit shell:
      //   -NoProfile      skips loading the user's PowerShell profile, which costs
      //                   roughly 0.3-1s of startup on EVERY agent tool call.
      //   -NonInteractive makes a command that wants input fail fast rather than
      //                   hanging until the timeout.
      // The timeout is our own timer with a tree-kill: Node's `timeout` option
      // only TerminateProcess'd powershell.exe, so an `npm run dev` it had
      // started kept running (and the "[TIMEOUT] ... was terminated" text was
      // a lie for everything below the shell).
      let timedOut = false;
      const child = execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', utf8Prefix + command],
        {
          cwd: this.workspaceDir,
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          windowsHide: true,
          env: { ...process.env, PYTHONIOENCODING: 'utf-8', CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }
        },
        (error, stdout, stderr) => {
          clearTimeout(timer);
          let output = (stdout + (stderr ? `\n[STDERR]\n${stderr}` : '')).trim();
          // `strataKilled` is stamped by killTrackedChildren (user Stop / quit).
          const killed = timedOut || (child as any).strataKilled === true || !!(error && error.killed);
          if (timedOut) {
            output = `[TIMEOUT] Command timed out after ${Math.round(timeout / 1000)} seconds; its whole process tree was terminated.\n${output}`;
          } else if (killed) {
            output = `[STOPPED] Command was terminated (stop requested).\n${output}`;
          } else if (!output && error) {
            output = `Command failed with error: ${error.message}`;
          } else if (!output) {
            output = 'Executed with no output';
          }
          const exitCode = error && typeof (error as any).code === 'number' ? (error as any).code : (error ? 1 : 0);
          if (error && !killed) output = `[exit code ${exitCode}]\n${output}`;
          resolve({
            success: !error && !killed,
            output: output.slice(0, 8000)
          });
        }
      );
      trackChild(child, 'tool');
      const timer = setTimeout(() => {
        timedOut = true;
        killTree(child.pid).then(() => { try { child.kill(); } catch {} });
      }, timeout);
    });
  }
}

export const OLLAMA_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description: 'Search file contents across the workspace with a regex or plain text (like grep). Returns "path:line: text" matches. Use this FIRST to locate a symbol, string, or config key before reading files. Cheap and fast.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Regex or literal text to search for (case-insensitive by default)' },
          path: { type: 'string', description: 'Optional directory or file to restrict the search to (relative to workspace)' },
          fileGlob: { type: 'string', description: 'Optional filename glob such as "*.ts" or "src/**/*.tsx"' },
          maxResults: { type: 'number', description: 'Optional cap on matches (default 40, max 120)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file with line numbers. For files over ~300 lines, pass startLine and lineCount to read only the region you need (find it first with search_codebase). Output lines look like "12: code" - the "12: " prefix is NOT part of the file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to read' },
          startLine: { type: 'number', description: 'Optional 1-based start line to begin reading from' },
          lineCount: { type: 'number', description: 'Optional number of lines to read (default 400, max 600)' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Replace one exact block of lines in an existing file. targetContent must be copied verbatim from a read_file result WITHOUT the "NN: " line-number prefixes, and should be short (3-15 lines) and unique in the file. The result shows the edited region, so no confirmation read is needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to edit' },
          targetContent: { type: 'string', description: 'Exact existing lines to replace (no line-number prefixes)' },
          replacementContent: { type: 'string', description: 'New lines to insert in their place' }
        },
        required: ['path', 'targetContent', 'replacementContent']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create a new file or completely overwrite an existing one with the full content. For changing part of an existing file, use edit_file instead.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of the file to write' },
          content: { type: 'string', description: 'Complete content of the file' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories under a path (default: workspace root, depth 2). Prefer search_codebase when you are looking for a specific symbol or string.',
      parameters: {
        type: 'object',
        properties: {
          dirPath: { type: 'string', description: 'Directory to list (defaults to workspace root)' },
          depth: { type: 'number', description: 'How many levels deep to list (default 2, max 4)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Execute a PowerShell command in the workspace directory (e.g. "npm run typecheck", "git status", "python -m pytest -q"). Use it to verify your changes compile and tests pass. Non-interactive; 60s limit.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'PowerShell command line to execute' }
        },
        required: ['command']
      }
    }
  }
];
