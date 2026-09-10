import colors from 'tailwindcss/colors'

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ---- surfaces ---------------------------------------------------
        studio: {
          bg: '#0c0e14',
          surface: '#121620',
          panel: '#161b26',
          'panel-hi': '#1c2230',      // raised / hover, previously ad hoc
          border: '#232938',
          'border-light': '#323b4e',
          accent: '#6366f1',
          'accent-hover': '#4f46e5',
          text: '#f1f5f9',
          muted: '#94a3b8',
          subtle: '#64748b'
        },

        // ---- who is speaking ---------------------------------------------
        // Aliased to the FULL Tailwind ramps rather than single values, so the
        // existing 300/400/500 hierarchy survives the rename byte-for-byte.
        // The palette is now changeable in one place instead of ~400 call sites.
        role: {
          architect: colors.purple,   // planning voice (cloud or local)
          user:      colors.indigo,   // the operator
          worker:    colors.teal,     // local RTX 5090 executor
          tool:      colors.amber     // tool invocation / highlight
        },

        // ---- state --------------------------------------------------------
        state: {
          ok:     colors.emerald,
          warn:   colors.amber,
          danger: colors.rose,
          info:   colors.sky          // absorbs the stray blue/cyan usages
        }
      },

      // Floor raised from 9px to 11px; 111 arbitrary sizes collapsed to two tokens.
      fontSize: {
        micro: ['0.6875rem', { lineHeight: '0.95rem', letterSpacing: '0.01em' }],
        mini:  ['0.75rem',   { lineHeight: '1.05rem' }],
      },

      borderRadius: {
        control: '0.375rem',   // buttons, inputs, chips, badges
        card:    '0.625rem',   // panels, message bubbles, rows
        modal:   '1rem'        // modal shells only
      },

      boxShadow: {
        panel:  '0 1px 2px rgba(0,0,0,.30), 0 4px 16px -6px rgba(0,0,0,.45)',
        raised: '0 2px 6px rgba(0,0,0,.35), 0 12px 32px -12px rgba(0,0,0,.55)'
      },

      ringWidth: { DEFAULT: '2px' }
    },
  },
  plugins: [],
}
