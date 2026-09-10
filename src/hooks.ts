import { useCallback, useEffect, useRef } from 'react';

/**
 * A callback whose identity NEVER changes but which always invokes the latest
 * closure.
 *
 * Why not plain `useCallback`: React.memo on a child only works if the function
 * props handed to it are referentially stable, and stabilising ~30 handlers with
 * hand-written dependency arrays is how stale-closure bugs get introduced — a
 * missing dep silently captures an old `workspace` or `tabs` and the failure
 * shows up much later, far from the cause.
 *
 * This pattern sidesteps dependency arrays entirely. Correct for event handlers,
 * which is all it is used for here. Do not use it for values consumed during
 * render — only for things called in response to user or IPC events.
 */
export function useEventCallback<T extends (...args: any[]) => any>(fn: T): T {
  const ref = useRef<T>(fn);
  useEffect(() => { ref.current = fn; });
  return useCallback(((...args: any[]) => ref.current(...args)) as T, []);
}
