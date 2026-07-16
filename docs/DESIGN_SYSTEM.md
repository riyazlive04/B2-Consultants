# B2 Founder Dashboard — Design System

**Design language: "Daylight"** — light blue on half-white. Calm, confident, money-grade.
**Version 1.2 — July 2026** — §6 Motion rewritten with a real scale (chrome moves, data doesn't);
§5.5 controls de-nativised. Reference implementation: the Founder Console.
*v1.1 — palette re-tuned to meet the §7 contrast floor; dark mode shipped.*

This is the single source of truth for every colour, font, spacing value, and component in
the app. Both Claude Design and Claude Code read from this file. If a value is not in here,
it does not belong in the product.

---

## 0. The thesis (read first)

This is an **internal cockpit for one founder**, not a marketing site. The reference image is a
soft, rounded, pastel SaaS look — we keep that warmth and roundness but swap the lilac/violet
for **light blue**, and sit everything on a **half-white** (cool off-white) canvas so that
numbers, signal colours (green/amber/red), and money figures are the loudest things on screen.

Three rules the whole system obeys:

1. **The data is the hero, not the chrome.** Chrome (nav, cards, borders) is quiet and almost
   colourless. Colour is spent on *meaning*: a red runway, an amber OKR, a positive profit.
2. **One accent, used with restraint.** Light blue is for primary actions, active states, and
   the brand. It is never used for "this number is good" — that is what the signal palette is for.
3. **Trust through calm.** This app handles money and legal signatures. No loud gradients on data,
   no decorative noise. Soft shadows, generous whitespace, honest alignment of figures.

---

## 1. Colour

### 1.1 Core palette

| Token | Hex | Use |
|---|---|---|
| `--bg-app` | `#F1F5FB` | App canvas (the "half-white"). Everything sits on this. |
| `--bg-surface` | `#FFFFFF` | Cards, panels, modals, the primary content surface. |
| `--bg-surface-2` | `#F4F8FE` | Insets: table header rows, input wells, secondary panels. |
| `--bg-sky` | `#E4EFFE` | Soft blue tint panels (hero strip, highlight boxes, empty states). |
| `--bg-sky-grad` | `linear-gradient(135deg,#E8F1FE 0%,#D9E9FF 100%)` | The one place a gradient is allowed: the top welcome/hero strip and the runway hero box. |
| `--primary` | `#0A64E2` | Primary action, active nav, brand blue, focused field ring. Carries white text (5.34:1) **and** reads as text on `--primary-soft` (4.64:1). |
| `--primary-strong` | `#0855C0` | Primary hover / pressed; all blue *text* (soft button, info badge). |
| `--primary-soft` | `#E6F0FE` | Selected row, active chip, soft button bg, primary badge bg. |
| `--primary-tint` | `#BBD6FF` | Borders on blue elements, sparkline fills, progress track fill (light). |
| `--ink` | `#16203A` | Primary text, headings, key figures (near-navy, never pure black). |
| `--ink-2` | `#4A566E` | Secondary text, labels, table body. |
| `--ink-3` | `#636F85` | Muted text, placeholders, captions. Passes 4.5:1 on every surface **except `--bg-sky`**. |
| `--ink-disabled` | `#8A95A8` | Inactive controls ONLY (WCAG 1.4.3 exempts them). Never text. |
| `--on-accent` | `#FFFFFF` (dark: `#0E1626`) | Text/icon sitting on a saturated fill. Never hardcode `text-white` — it cannot re-theme. |
| `--border` | `#E2E9F3` | Default hairline borders, dividers, card edges. |
| `--border-strong` | `#CBD6E6` | Input borders, table outer edge, segmented controls. |

### 1.2 Signal palette (money & status — the important one)

These carry **meaning** and appear constantly: runway colour, OKR circles, student signal dots,
profit positive/negative, overdue receivables, target-bar bands.

| Meaning | Text/Icon | Fill (bg) | Hex (text) | Hex (bg) |
|---|---|---|---|---|
| **Good / Safe / Paid / On-track** | green | green-soft | `#197E50` | `#E4F7EE` |
| **Watch / Amber / Due soon** | amber | amber-soft | `#9A610E` | `#FBEFD7` |
| **Bad / Urgent / Overdue / Loss** | red | red-soft | `#CB2A31` | `#FCE7E8` |
| **Neutral / Info** | blue | primary-soft | `#0855C0` | `#E6F0FE` |

Each text tone is tuned to clear **4.5:1 against its own soft fill** — badges render at
12px, which is small text. The soft fills are unchanged, so the palette's temperature is
identical to v1.0; only the glyph darkened.

Tokens: `--good`, `--good-bg`, `--warn`, `--warn-bg`, `--bad`, `--bad-bg`.

**Rule:** A money figure is `--ink` by default. It only turns `--good` (positive delta) or
`--bad` (negative / loss / overdue) when the *sign of the number carries a decision*. Don't colour
revenue green just because it's revenue.

### 1.3 Data-viz palette

Calm, blue-led, with two soft echoes of the reference's violet/pink so charts don't read as
all-blue. Use in this order.

| Slot | Hex | Typical use |
|---|---|---|
| viz-1 | `#4B93F7` | Primary series (revenue, "this month") |
| viz-2 | `#3FC0B7` | Secondary (expenses, teal) |
| viz-3 | `#9B8CFF` | Tertiary (soft violet — e.g. Guided) |
| viz-4 | `#F2A93B` | Quaternary (amber — e.g. Elite) |
| viz-5 | `#F4799E` | Fifth (soft pink — e.g. Solo) |
| viz-grid | `#EAF0F8` | Gridlines, axes |
| viz-ink | `#8A95A8` | Axis labels |

Program-level colours are **fixed** across the whole app so the eye learns them:
**Solo = `#F4799E`**, **Guided = `#9B8CFF`**, **Elite = `#F2A93B`**, **German Note = `#3FC0B7`**.

### 1.4 Dark mode

**Shipped.** `[data-theme="dark"]` in `globals.css` remaps the core tokens; everything else
follows. Two rules that only bite in dark mode:

- Dark fills are *light*, so on-fill text must be near-black. That is what `--on-accent` is
  for. A hardcoded `text-white` on `--primary` measures **2.72:1** in dark mode.
- `--ink` is near-white in dark mode. Anything that used `bg-ink` + `text-white` (tooltips)
  must use `text-surface` instead.

Do not hardcode hex anywhere.

---

## 2. Typography

Two families plus one mono. Load via Google Fonts (or self-host).

| Role | Family | Weights | Used for |
|---|---|---|---|
| **Display** | **Plus Jakarta Sans** | 600, 700, 800 | Page titles, card headings, big metric values, the brand. |
| **Body / UI** | **Inter** | 400, 500, 600 | Body text, labels, table cells, form fields, buttons. |
| **Mono** | **JetBrains Mono** | 400, 500 | Ledger figures in the accounting views, journal IDs, IRN/hash strings, audit-trail entries. |

**Why:** Plus Jakarta Sans gives the rounded, friendly warmth of the reference without the
violet. Inter is the dense-data workhorse (great tabular figures). Mono is reserved for the
"this is a real ledger / this is a legal record" surfaces so they read as authoritative.

### 2.1 Type scale

| Token | Size / line-height | Weight | Family | Use |
|---|---|---|---|---|
| `display-xl` | 40 / 46 | 800 | Jakarta | Runway hero number, big KPI hero |
| `display-l` | 30 / 38 | 700 | Jakarta | Page title |
| `h1` | 24 / 32 | 700 | Jakarta | Section heading |
| `h2` | 19 / 28 | 600 | Jakarta | Card heading |
| `h3` | 16 / 24 | 600 | Jakarta | Sub-heading, table group title |
| `metric` | 28 / 34 | 700 | Jakarta, tabular | KPI card value |
| `body` | 14 / 22 | 400 | Inter | Default body |
| `body-strong` | 14 / 22 | 600 | Inter | Emphasised body, active label |
| `label` | 13 / 18 | 500 | Inter | Form labels, table headers (UPPERCASE +0.04em) |
| `caption` | 12 / 16 | 400 | Inter | Tooltips, helper text, timestamps |
| `mono-data` | 14 / 20 | 400 | JetBrains | Ledger amounts, IDs |

**Always** use `font-variant-numeric: tabular-nums` on any column of figures so decimals line up.

Every step above is a Tailwind token (`text-display-l`, `text-h2`, `text-metric`, `text-label`,
`text-caption`, …). If you are typing `text-lg` or `text-[15px]`, you are off the scale.

---

## 3. Number & currency formatting (non-negotiable — from the PRD)

This is design *and* logic. Both engines must render money exactly like this.

- **INR** uses the **Indian grouping**: `₹1,00,000.99` (lakh/crore grouping), symbol `₹`.
- **EUR** uses **German grouping**: `100.000,99 €` (dot thousands, comma decimal), symbol after.
- Every figure shows its currency. Never display a bare number for money.
- Dual-currency figures show INR as primary, EUR muted beneath or beside:
  `₹1,07,500.00`  ·  `1.000,00 €` (`--ink-3`, `caption`).
- FX is **live** (€1 ≈ ₹107.5 today, fetched from an FX API — never hardcoded). Show a
  `rate as of <timestamp>` caption wherever a converted value appears.
- Dates everywhere: **DD/MM/YYYY**. Times in IST.
- Percentages: 1 decimal (`62.4%`). Runway: 1 decimal (`4.2 months`).

---

## 4. Spacing, radius, elevation

**Spacing** — 4px base scale: `4, 8, 12, 16, 20, 24, 32, 40, 48, 64`.
Card padding `24`. Grid gutter `20`. Page gutter `32` desktop / `16` mobile.

**Radius**

| Token | px | Use |
|---|---|---|
| `r-sm` | 10 | Inputs, chips, small buttons |
| `r-md` | 14 | Buttons, segmented controls |
| `r-lg` | 18 | Cards, panels, modals |
| `r-xl` | 24 | Hero strip, big highlight boxes |
| `r-full` | 999 | Pills, avatars, signal dots, toggles |

**Elevation** — soft, blue-tinted, low-opacity. Never harsh black shadows.

| Token | Value |
|---|---|
| `e-0` | none (flat on canvas, 1px `--border`) |
| `e-1` | `0 1px 2px rgba(22,32,58,.04), 0 1px 3px rgba(22,32,58,.06)` — resting cards |
| `e-2` | `0 4px 12px rgba(22,32,58,.08)` — hover, dropdowns |
| `e-3` | `0 12px 32px rgba(22,32,58,.12)` — modals, popovers |

---

## 5. Components

Each component lists its anatomy and states. Build them once, reuse everywhere.

### 5.1 App shell
- **Left sidebar** (`240px`, `--bg-surface`, right border `--border`): brand at top, then nav
  items. Collapses to icons at `<1100px`, hidden behind a hamburger on mobile.
- **Top bar** (`64px`, sticky, `--bg-surface`, bottom border): page title (left); on the right,
  **the always-visible metric strip** — `Runway: 4.2 months` with its signal colour, current
  month, logged-in user avatar + name, logout. The runway pill is the most important top-bar
  element for Admin (Phase 3 requirement: visible on every screen Admin can reach). Cash Health
  is Admin-only per the access matrix (§2.1 BUILD_SPEC — Head: No, User: No), so Head and User
  never see this pill; it is not rendered for them, by design.
- **Content** sits on `--bg-app` with `32px` gutters and is **fluid — there is no max content
  width.** Page roots are `w-full`; the only horizontal bound is the shell's own padding
  (`px-4` mobile / `md:px-7`).
  *Changed 15 Jul 2026 — was `1280px`, briefly `1600px`, now uncapped.* Any fixed cap left a
  dead strip on the right of a wide window, because the top bar is uncapped and spans the full
  shell: at `1280px` on a 1920 window the content stopped **195px** short of the logout button.
  Rather than cap the top bar to match, the decision was that screens use the window they're
  given.
  **What this means when you build a page:** you no longer get a free measure. Responsibility
  moves to the grid — use responsive column counts (`sm:grid-cols-2 lg:grid-cols-4`) so cards
  spread rather than stretch, and keep prose in its own bounded column. Measured at 2560 the
  longest subtitle reaches ~85ch, which is the ceiling of comfortable reading; anything
  longer needs its own `max-w`.
  **Utility `max-w` is unaffected** — `max-w-sm` on muted text, `mx-auto max-w-lg` on centred
  empty states, and narrow error cards are reading-measure widths, not layout caps. Don't strip them.

### 5.2 Nav item
- Resting: `--ink-2`, icon + label, `r-md`, transparent bg.
- Hover: `--bg-surface-2`.
- Active: `--primary-soft` bg, `--primary` text + icon, left `3px` `--primary` accent bar.
- Items render per role (see access matrix in BUILD_SPEC). A hidden section is *absent*, not greyed.

### 5.3 KPI / metric card
The workhorse of every dashboard.
```
┌────────────────────────────┐
│ LABEL (label, ink-3)    (i) │  ← optional info tooltip icon
│ ₹4,28,500   ▲ 12.4%         │  ← metric (Jakarta 700) + delta chip
│ vs last month               │  ← caption, ink-3
│ ▁▂▃▅▆ (optional sparkline)  │
└────────────────────────────┘
```
- bg `--bg-surface`, `r-lg`, `e-1`, padding `24`.
- Delta chip: green/red `*-bg` pill with `▲`/`▼`, `caption` weight 600.
- Hover lifts to `e-2`. Tooltip `(i)` shows the plain-English definition (PRD requires this on
  Gross/Net profit, runway, conversion rate, etc.).

### 5.4 Buttons
| Variant | Fill | Text | Use |
|---|---|---|---|
| Primary | `--primary` (hover `--primary-strong`) | white | Save, Send, primary action — one per view |
| Soft | `--primary-soft` | `--primary-strong` | Secondary action |
| Ghost | transparent | `--ink-2` (hover `--bg-surface-2`) | Tertiary, table row actions |
| Danger | `--bad` | white | Delete, void (Admin only, always confirmed) |
- Height `40` (`36` compact), `r-md`, weight 600, `8px` icon gap. Pills (`r-full`) for filters/chips.
- Focus: `2px` `--primary` ring at `2px` offset. Disabled: `--ink-3` on `--bg-surface-2`.

### 5.5 Inputs & forms
- Field: `--bg-surface`, `1px` `--border-strong`, `r-sm`, height `40`, padding `12`.
  Hover → border `--primary-tint`. Focus → border `--primary` + soft ring (`--dur-fast`).
  Error → border `--bad` + helper text in `--bad`.
  **Height 40 is not a suggestion** — it is the §7 hit-target floor. A `py-1.5` field measures 32
  and reads as cramped; the Founder Console shipped that way and it was the single loudest "old"
  tell after the native chrome below.
- **Never ship OS control chrome.** A bare `<select>` renders the platform's grey arrow, which
  ignores every token here and stays light-grey on a dark surface. Use `appearance-none` + our own
  `ChevronDown` in `--ink-3`, and keep the real `<select>` underneath (keyboard, type-ahead and the
  mobile picker are all free). Same for `<input type=checkbox>`: the box is a styled `<span>`, the
  input is `sr-only` — **`sr-only`, never `display:none`**, or it leaves the tab order.
- Label above (`label` style), helper/error below (`caption`).
- **Date** pickers default to today (PRD), DD/MM/YYYY. **Dropdowns** match PRD option lists exactly.
- **Toggle** (Yes/No, e.g. "Is this COGS?"): pill track, `--good` when on.
- **Currency input**: prefix `₹` or `€`, right-aligned tabular figures, live grouping as typed.
- Money entry with dual currency shows the auto-converted counterpart inline, muted, with the
  live rate caption.

### 5.6 Tables (the data backbone)
- Header row: `--bg-surface-2`, `label` UPPERCASE, sortable headers show a caret.
- Rows: `52px`, body `--ink-2`, hover `--bg-surface-2`, `1px` `--border` dividers.
- Money columns right-aligned, tabular, `mono-data` in the accounting/ledger views.
- **Signal cell:** a `--full` dot (green/amber/red) + label, no full-cell fill except when a
  whole row is flagged (e.g. overdue receivable → row tinted `--bad-bg` per PRD).
- Sticky header on scroll. Each table has a small **Export CSV** button top-right (Admin only).
- Empty state: centred icon on `--bg-sky`, one line of plain copy + a primary action.

### 5.7 Badges, chips, dots
- **Status badge** (`Active`, `Overdue`, `Paid in full`, `Won`, `Sealed`): `r-full`, `caption`
  600, signal `*-bg` fill + signal text.
- **Program chip**: fixed program colour (Solo/Guided/Elite/German Note) as a soft tint.
- **OKR / signal dots**: three `10px` `--full` dots in a row (green/amber/red) — the at-a-glance
  health row from the People section.

### 5.8 Charts
- **Funnel** (Phase 3): five stacked blocks narrowing downward, each = stage name + count, width
  ∝ count. Biggest drop-off block outlined/filled `--bad`. Static, clean, no animation.
- **Line** (cash position, 12 weeks): single `--primary` line, soft `--primary-tint` area fill,
  gridlines `viz-grid`, dots on hover with tooltip.
- **Bar** (weekly rollups, revenue by level): use program-fixed colours; rounded bar tops (`4px`).
- **Target / progress bar** (monthly revenue target): track `--bg-surface-2`, fill colour-banded
  — **red <50%, amber 50–80%, green >80%** (PRD). Label shows `₹x of ₹8,00,000 (62%)`.
- **Runway gauge**: the hero box; big number + months, background band coloured by the runway rule
  (green ≥6, amber 3–6, red <3).

### 5.9 Tooltip, modal, toast, confirm
- **Tooltip**: `--ink` bg, white text, `caption`, `r-sm`, `e-2`. Used for all `(i)` definitions.
- **Modal**: `--bg-surface`, `r-lg`, `e-3`, scrim `rgba(22,32,58,.4)`, max `560px` (forms) /
  `720px` (record detail). Header + body + right-aligned action footer.
- **Toast**: bottom-right, `r-md`, `e-2`, signal-coloured left bar. Verb matches the action
  ("Saved", "Sent for signature", "Voided"). Auto-dismiss `4s`.
- **Destructive confirm**: required for any delete/void; names the exact record; Danger button.

### 5.10 Signature & ledger surfaces (integration components)
- **Signature status tracker** (esign): horizontal stepper — `Sent → Viewed → Signed → Sealed` —
  each step a dot + timestamp; current step `--primary`, done `--good`, declined `--bad`.
- **Certificate card**: shows signer name, auth method (Aadhaar/eIDAS/OTP), timestamp, IP, and a
  monospace sealed-hash with a "Verify" affordance.
- **Journal entry view** (accounting): two-column debit/credit table in `mono-data`; a persistent
  footer asserting **Debits = Credits** (green tick when balanced). This surface is read-mostly.

---

## 6. Motion
**Version 1.2 — July 2026.** Rewritten: v1.1 said only "minimal and functional", which in practice
meant screens shipped with *no* motion at all and read as dated. Motion is now specified, with a
scale — but it is still earned, never decorative.

**The one rule: motion answers a gesture. Chrome may move; data never does.**
A tab you clicked, a row you pointed at, a button you pressed — those may move, because the
movement *is* the feedback. A figure, a chart, a KPI, a money column: never. A number that slides
or bounces reads as a number that isn't sure. This is the operational half of §0's "the data is
the hero".

### 6.1 The scale
Tokens live in `globals.css`. Don't invent a duration at a call site.

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | `120ms` | Hover, colour, focus ring, press |
| `--dur-base` | `200ms` | The default — entrances, cross-fades, toasts |
| `--dur-slow` | `320ms` | A single element *travelling* (the tab indicator) |
| `--ease-out` | `cubic-bezier(.2,.7,.3,1)` | Default. Everything, unless it was pushed. |
| `--ease-spring` | `cubic-bezier(.34,1.4,.64,1)` | Overshoots — only for things the user pushed |

`--ease-spring` is for a *direct manipulation* (tab, press, tick). The overshoot reads as
responsiveness there. On anything else it reads as noise, and on data it reads as a lie.

### 6.2 The vocabulary
| Class | What it does | Where |
|---|---|---|
| `.tab-indicator` | The active marker **travels** between tabs | `Tabs` (both variants) |
| `.panel-in` | Tab panel cross-fades up `4px` on swap | `Tabs` |
| `.row-lift` | Row hover/focus-within → `e-2` + `primary-tint` edge + `-1px` | List editors |
| `.row-in` | Staggered entry, `22ms × --i`, capped at 14 | List editors |
| `.press` | `scale(.96)` spring on `:active` | All buttons |
| `.rise-in` | Staggered card entry, `30ms` apart, capped at 12 | Dashboards |
| `.card-hover` | Lift to `e-2` + blue edge | Clickable cards |

**Why the tab indicator travels:** one object moving from A to B says "these are the same control,
and you moved it". A marker that blinks off one tab and on to another says nothing — it reads as a
page reload. It is the cheapest way to make a screen feel built rather than assembled.

### 6.3 Still forbidden
- **No looping/ambient animation.** Nothing moves unless a person caused it. (`.skeleton` is the
  one exception — it must read as pending, and it stops under reduced-motion.)
- **No parallax.** The reference's floating cards are a *marketing* device; this is an ops tool.
- **Number count-up: off.** The founder wants the truth instantly, not a show. Allowed only on the
  runway hero, once, `400ms`.
- **Charts don't animate in.** §5.8 already says the funnel is static. That still holds.

### 6.4 `prefers-reduced-motion`
Non-negotiable, and it is a **kill switch for travel, not for state**: under reduce, the end state
must still be reachable and legible. Hover still recolours and still lifts its shadow; the tab
indicator still lands on the right tab. Only the *travel* and the *entrances* are removed. Every
class above is listed in the reduce block in `globals.css` — if you add a class here, add it there.

---

## 7. Accessibility & quality floor
- Contrast: body text ≥ 4.5:1, large ≥ 3:1, non-text (focus ring, control boundary) ≥ 3:1.
  Every token pair the system prescribes is verified against this — see the palette notes in
  §1.1/§1.2. Still forbidden: `--ink-3` on `--bg-sky` (4.36:1).
- The type scale bottoms out at `caption` (12px). Nothing renders below it — not avatar
  initials, not badges, not counters.
- Every interactive element has a visible keyboard focus ring (`--primary`, 2px).
- Signal **never** carried by colour alone — always pair the dot/fill with a label or icon
  (colour-blind safe; also a compliance nicety for a money tool).
- Hit targets ≥ `40px`. Forms fully keyboard-navigable. Tables announce sort state.
- Mobile: cards stack to a single column (PRD); tables become stacked key-value cards below
  `720px`; sidebar collapses to a sheet.

---

## 8. Token reference (CSS custom properties)

```css
:root{
  /* surface */
  --bg-app:#F1F5FB; --bg-surface:#FFFFFF; --bg-surface-2:#F4F8FE;
  --bg-sky:#E4EFFE;
  --bg-sky-grad:linear-gradient(135deg,#E8F1FE 0%,#D9E9FF 100%);
  /* brand */
  --primary:#0A64E2; --primary-strong:#0855C0; --primary-soft:#E6F0FE; --primary-tint:#BBD6FF;
  --on-accent:#FFFFFF;
  /* ink */
  --ink:#16203A; --ink-2:#4A566E; --ink-3:#636F85; --ink-disabled:#8A95A8;
  /* lines */
  --border:#E2E9F3; --border-strong:#CBD6E6;
  /* signal */
  --good:#197E50; --good-bg:#E4F7EE;
  --warn:#9A610E; --warn-bg:#FBEFD7;
  --bad:#CB2A31;  --bad-bg:#FCE7E8;
  /* viz */
  --viz-1:#4B93F7; --viz-2:#3FC0B7; --viz-3:#9B8CFF; --viz-4:#F2A93B; --viz-5:#F4799E;
  --viz-grid:#EAF0F8; --viz-ink:#8A95A8;
  /* program (fixed) */
  --lvl-solo:#F4799E; --lvl-guided:#9B8CFF; --lvl-elite:#F2A93B; --lvl-gn:#3FC0B7;
  /* radius */
  --r-sm:10px; --r-md:14px; --r-lg:18px; --r-xl:24px; --r-full:999px;
  /* elevation */
  --e-1:0 1px 2px rgba(22,32,58,.04),0 1px 3px rgba(22,32,58,.06);
  --e-2:0 4px 12px rgba(22,32,58,.08);
  --e-3:0 12px 32px rgba(22,32,58,.12);
  /* type */
  --font-display:'Plus Jakarta Sans',sans-serif;
  --font-body:'Inter',sans-serif;
  --font-mono:'JetBrains Mono',monospace;
}
```

---

## 9. Do / Don't

**Do** — keep the canvas half-white and quiet · spend blue on actions only · let signal colours
carry meaning · right-align and tabular-align every money column · show the live FX timestamp ·
keep the runway pill visible on every screen Admin can reach (it is Admin-only — Cash Health is
not part of Head's or User's access).

**Don't** — gradient-fill data cards · colour revenue green for being revenue · use pure black or
pure red-flat fills on whole tables (only overdue rows tint) · **animate a figure, a chart or a KPI
— ever** (chrome may move, data may not; §6) · introduce a second accent hue · mix INR and EUR
grouping rules · ship a native `<select>` or `<input type=checkbox>` with its OS chrome showing
(§5.5 — the grey native arrow ignores the theme and is the most dated pixel available).

*Amended 15 Jul 2026 — "animate the dashboard like a landing page" was the v1.1 wording. It was
read as "no motion anywhere" and screens shipped inert, which is its own kind of cheap. The line
is not dashboard-vs-elsewhere, it is **data-vs-chrome**: see §6.*
