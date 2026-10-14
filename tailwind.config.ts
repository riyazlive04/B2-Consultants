import type { Config } from "tailwindcss";

/**
 * "Daylight" theme (docs/DESIGN_SYSTEM.md). Every value reads from the CSS
 * custom properties in globals.css so the token set has exactly one home.
 * Signal colours are semantic: ok / watch / risk (aka good / warn / bad).
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      screens: {
        // §7: "tables become stacked key-value cards below 720px"
        tab: "720px",
      },
      colors: {
        canvas: "var(--bg-app)",
        surface: { DEFAULT: "var(--bg-surface)", 2: "var(--bg-surface-2)" },
        sky: "var(--bg-sky)",
        ink: {
          DEFAULT: "var(--ink)",
          2: "var(--ink-2)",
          3: "var(--ink-3)",
          // inactive controls only — WCAG 1.4.3 exempts them. Never for text.
          disabled: "var(--ink-disabled)",
        },
        muted: "var(--ink-2)",
        faint: "var(--ink-3)",
        // text/icon that sits ON a saturated fill; re-themes, unlike `text-white`
        "on-accent": "var(--on-accent)",
        // the same job for an ACTION-red fill, which resolves differently - see globals.css
        "on-action": "var(--on-action)",
        line: { DEFAULT: "var(--border)", strong: "var(--border-strong)" },
        primary: {
          DEFAULT: "var(--primary)",
          strong: "var(--primary-strong)",
          soft: "var(--primary-soft)",
          tint: "var(--primary-tint)",
        },
        // legacy alias — same blue as primary
        accent: { DEFAULT: "var(--primary)", soft: "var(--primary-soft)" },
        /**
         * The brand's action red — "jump in, don't wait for perfect". Only for the handful
         * of places we ask someone to commit (book, sign, pay), and only as a solid fill
         * with `text-on-action`. Destructive actions use `risk`/`bad`, never this.
         * `action.brand` is the untouched brand hex, for GRAPHICS only — see globals.css.
         */
        action: {
          DEFAULT: "var(--action)",
          strong: "var(--action-strong)",
          soft: "var(--action-soft)",
          tint: "var(--action-tint)",
          brand: "var(--brand-red)",
        },
        ok: { DEFAULT: "var(--good)", soft: "var(--good-bg)" },
        watch: { DEFAULT: "var(--warn)", soft: "var(--warn-bg)" },
        risk: { DEFAULT: "var(--bad)", soft: "var(--bad-bg)" },
        good: { DEFAULT: "var(--good)", soft: "var(--good-bg)" },
        warn: { DEFAULT: "var(--warn)", soft: "var(--warn-bg)" },
        bad: { DEFAULT: "var(--bad)", soft: "var(--bad-bg)" },
        // fixed program-level colours (Solo / Guided / Elite / German Note)
        lvl: {
          solo: "var(--lvl-solo)",
          guided: "var(--lvl-guided)",
          elite: "var(--lvl-elite)",
          gn: "var(--lvl-gn)",
        },
      },
      fontFamily: {
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Daylight type scale (§2.1) — the COMPLETE scale. Nothing outside it ships.
        "display-xl": ["40px", { lineHeight: "46px", fontWeight: "800" }],
        "display-l": ["30px", { lineHeight: "38px", fontWeight: "700" }],
        h1: ["24px", { lineHeight: "32px", fontWeight: "700" }],
        h2: ["19px", { lineHeight: "28px", fontWeight: "600" }],
        h3: ["16px", { lineHeight: "24px", fontWeight: "600" }],
        metric: ["28px", { lineHeight: "34px", fontWeight: "700" }],
        body: ["14px", { lineHeight: "22px", fontWeight: "400" }],
        "body-strong": ["14px", { lineHeight: "22px", fontWeight: "600" }],
        label: ["13px", { lineHeight: "18px", fontWeight: "500", letterSpacing: "0.04em" }],
        caption: ["12px", { lineHeight: "16px", fontWeight: "400" }],
        "mono-data": ["14px", { lineHeight: "20px", fontWeight: "400" }],
      },
      borderRadius: {
        card: "var(--r-lg)", // 18px — cards, panels, modals
        field: "var(--r-sm)", // 10px — inputs, chips, small buttons
        btn: "var(--r-md)", // 14px — buttons, segmented controls
        hero: "var(--r-xl)", // 24px — hero strip, big highlight boxes
      },
      boxShadow: {
        card: "var(--e-1)", // resting cards
        soft: "var(--e-2)", // hover, dropdowns
        pop: "var(--e-3)", // modals, popovers
        hero: "var(--e-3)",
      },
    },
  },
  plugins: [],
};
export default config;
