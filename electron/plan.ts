/**
 * Request shape and reply checks the engine applies without a model call:
 * whether a prompt asks for a document or for advice rather than an edit,
 * whether a reply narrated an action instead of taking it, whether it claims
 * to be done, and tool calls a model wrote as text instead of structured calls.
 *
 * Everything here is deterministic string processing. No model calls.
 */
export function isDocumentRequest(prompt: string): boolean {
  const p = (prompt || '').toLowerCase();
  return /\b(design (an?|the) architecture|architecture (design|proposal|document)|design doc|proposal|write-?up|specification|spec for|roadmap|documentation for|document (the|this|how)|readme|migration plan|implementation plan|technical plan|adr\b)/.test(p)
    || /\b(design|architect|plan|document|outline|propose)\b/.test(p) && !/\b(fix|bug|edit|refactor|rename|implement|add|remove|delete|update|change)\b/.test(p);
}

const EDIT_VERB_RE = /\b(fix|implement|add|create|write|refactor|update|change|remove|delete|rename|build|make|generate|migrate|convert|replace|move|extract|introduce|set up|setup|install|configure|optimi[sz]e|rework|apply|patch|edit|modify|clean up|cleanup|correct)\b/i;

export function isAdvisoryRequest(prompt: string): boolean {
  const p = (prompt || '').trim();
  if (!p) return false;
  if (isDocumentRequest(p)) return false;
  if (EDIT_VERB_RE.test(p)) return false;
  return /\b(suggest|recommend|recommendations?|review|audit|analy[sz]e|analysis|inspect|assess|evaluate|critique|compare|explain|summari[sz]e|walk me through|what (?:do you|would you) (?:think|suggest|recommend)|any (?:ideas|suggestions)|find (?:bugs|issues|problems)|look for (?:bugs|issues|problems)|what'?s wrong)\b/i.test(p);
}

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

export function detectCompletionClaim(text: string): boolean {
  const t = (text || '').toLowerCase();
  // "DONE:" at the start of a line is the format the system prompt asks for.
  if (/(^|\n)\s*(?:\*\*|#+\s*)?done(?:\*\*)?\s*[:.!\-—]/.test(t)) return true;
  return /\b(all (?:tasks|steps|changes) (?:are )?(?:complete|done|implemented)|task(?:s)? (?:is|are) (?:now )?complete|(?:implementation|changes?) (?:is|are|has been) complete|i(?:'ve| have) (?:now )?(?:completed|finished|implemented)|summary of (?:the )?changes|changes made:|done\.|complete\.)\b/.test(t);
}

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
