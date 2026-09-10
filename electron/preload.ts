/**
 * DEPRECATED — not built, not shipped, not loaded.
 *
 * The real preload is `electron/preload.cjs`, which `main.ts` loads via
 * `webPreferences.preload` and which the build script copies verbatim into
 * `dist-electron/`. This file used to be a second, parallel implementation
 * compiled by vite-plugin-electron; its output was then overwritten by that
 * copy, so it had no effect while still drifting out of sync (it was missing
 * the `gemini:calibrate-quota` channel).
 *
 * Its build entry has been removed from vite.config.ts. This file is safe to
 * delete outright — it is kept only so a stale copy cannot be mistaken for the
 * live preload.
 *
 * Add new IPC channels to electron/preload.cjs.
 */
export {};
