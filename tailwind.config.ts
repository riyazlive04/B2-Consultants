import type { Config } from "tailwindcss";

/**
 * Theme reads from the CSS custom properties in globals.css (CONTEXT §5) so the
 * token set has exactly one home. Signal colours are semantic: ok / watch / risk.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--canvas)",
        surface: { DEFAULT: "var(--surface)", 2: "var(--surface-2)" },
        sidebar: { DEFAULT: "var(--sidebar)", 2: "var(--sidebar-2)" },
        "sidebar-tx": "var(--sidebar-tx)",
        "sidebar-muted": "var(--sidebar-muted)",
        ink: "var(--ink)",
        muted: "var(--muted)",
        line: "var(--line)",
        accent: { DEFAULT: "var(--accent)", soft: "var(--accent-soft)" },
        ok: { DEFAULT: "var(--ok)", soft: "var(--ok-soft)" },
        watch: { DEFAULT: "var(--watch)", soft: "var(--watch-soft)" },
        risk: { DEFAULT: "var(--risk)", soft: "var(--risk-soft)" },
        brass: "var(--brass)",
      },
      fontFamily: {
        display: ["var(--font-sans)", "system-ui", "sans-serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "Georgia", "serif"],
      },
      borderRadius: {
        card: "22px", // metric cards / panels — soft squircle
        field: "14px", // inputs, buttons, table container
      },
      boxShadow: {
        card: "0 1px 2px rgba(20, 22, 27, 0.04), 0 10px 30px -14px rgba(20, 22, 27, 0.12)",
        pop: "0 12px 40px -8px rgba(20, 22, 27, 0.18)",
        soft: "0 4px 20px -8px rgba(20, 22, 27, 0.10)",
      },
    },
  },
  plugins: [],
};
export default config;
