import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import type { Plugin } from 'vite'

// index.html carries a strict Content-Security-Policy (script-src 'self', no inline
// script) for the shipped app. The dev server alone needs inline script: the React
// plugin injects its Fast Refresh preamble as an inline <script> during `vite` serve.
// Relax script-src for serve only; a production build keeps the strict header.
const devCsp = (): Plugin => ({
  name: 'strata-dev-csp',
  apply: 'serve',
  transformIndexHtml(html) {
    return html.replace("script-src 'self';", "script-src 'self' 'unsafe-inline';")
  }
})

export default defineConfig({
  base: './',
  plugins: [
    devCsp(),
    react(),
    // Only the main process is bundled. The preload is shipped as a hand-written
    // CommonJS file (electron/preload.cjs) and copied verbatim by the build
    // script - see package.json. There used to be a second entry here building
    // electron/preload.ts, whose output was then overwritten by that copy, so the
    // two sources silently drifted (preload.ts was missing gemini:calibrate-quota
    // and nothing ever surfaced it).
    electron([
      {
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              external: ['electron']
            }
          }
        }
      }
    ]),
    renderer()
  ]
})
