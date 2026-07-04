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
        violet: { 1: "var(--violet-1)", 2: "var(--violet-2)" },
        pink: { 1: "var(--pink-1)", 2: "var(--pink-2)" },
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
        card: "26px", // metric cards / panels — soft squircle
        field: "16px", // inputs, buttons, table container
      },
      boxShadow: {
        card: "0 1px 2px rgba(25, 26, 44, 0.04), 0 16px 38px -20px rgba(25, 26, 44, 0.20)",
        pop: "0 18px 48px -10px rgba(25, 26, 44, 0.24)",
        soft: "0 8px 28px -12px rgba(25, 26, 44, 0.14)",
        hero: "0 28px 60px -22px rgba(91, 75, 214, 0.5)",
      },
    },
  },
  plugins: [],
};
export default config;
