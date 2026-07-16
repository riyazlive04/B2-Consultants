# UX Placement Audit — Fix Checklist

Derived from `UX_PLACEMENT_AUDIT_2026-07-15.html` (15 Jul 2026).
Findings: **2 Critical · 13 Moderate · 9 Minor · 9 verified-correct**.

All coordinates were measured in the rendered browser at 1440×900. Line numbers are as of 15 Jul 2026 — re-grep if the files have moved on.

**Read §5 before starting.** Nine things in this app are *correct* and are easy to "fix" by mistake. The runway pill in particular looks like duplication and is a spec requirement.

---

## 1. Do first — highest impact per hour

- [x] **Gate the Live FX card to Admin** &nbsp;`Critical` &nbsp;**DONE & VERIFIED 15 Jul**
  `src/app/(app)/page.tsx:184-190`
  **Verified in the rebuilt prod bundle at 1440×900:** `FX_TILE_PRESENT: false` for both Head and User; still present for Admin (correct). No dead-end cards remain on either home. Admin's home unchanged at `scrollHeight: 1390` — no regression.
  The `<MetricCard label="Live FX (ECB)" />` is the **only card in the grid with no role guard**. Every sibling has `{isAdmin && …}` or `{!isAdmin && …}`; this one renders for everyone, which puts a currency rate in the top-left slot of Karthick's and Asma's homes. Line 189 already reads `href={isAdmin ? "/finance" : undefined}` — role was considered for the link but not for rendering, so for non-admins it's also a dead-end tile.
  **Change:** wrap 184–190 in `{isAdmin && ( … )}`.
  **Why:** §2.1 access matrix — Head's home is `Limited (no finance tiles)`; User is `No Finance`.

- [x] **Promote "Your daily log" to position 1 for Head and User** &nbsp;`Moderate` &nbsp;**DONE & VERIFIED 15 Jul**
  `src/app/(app)/page.tsx` — the block now renders ahead of the (Admin-gated) FX card.
  Was FX → Needs attention → Your daily log → Arena. It's the only action either role must take *every day* (§6.3 requires a per-person log with a missing-log badge at 19:00 IST).
  **Verified at 1440×900:** "Your daily log" is now the first card of the At-a-glance grid for both roles — Head `x=268, y=452`, User `x=268, y=586`.
  **Unplanned bonus:** dropping the FX card removed a grid row from Asma's home — **941px → 900px, now 100% visible with zero scroll.**

- [ ] ~~**Delete Home's three duplicate cards**~~ — **RECOMMENDATION WITHDRAWN, do not do this** &nbsp;`corrected 15 Jul`
  `src/app/(app)/page.tsx:151-166`
  **I got this wrong in the audit.** The cards are *not* duplicates. `getRunwaySnapshot(range)` (`src/server/cash-metrics.ts:38-43`) re-anchors the burn window to the selected range, and `getPipelineSnapshot(range)` does the same — so `Cash runway`, `pipelineValueCard` and `pipelineWinsCard` are the **only way to see those metrics for Last Month or QTD**. The top-bar pill calls `getRunwaySnapshot()` with the default and is always current-month; FounderPulse is hard-scoped to "Month so far".
  They look identical to the hero **only at the default range** (`this-month`) — which is exactly the state I measured in, and I mistook a time-scoped view for redundancy. Deleting them would have removed a working feature and orphaned `KpiRangeSwitch` (`:148`).
  **The real, smaller issue:** at the default range the grid opens by restating the hero, so its purpose is invisible until you touch a control most people won't find.
  **Options, in preference order:**
  1. Render the three cards **only when `range !== "this-month"`** — they earn their slot exactly when they have something new to say. Cheap, and kills the redundancy at rest.
  2. Move `KpiRangeSwitch` beside the FounderPulse hero so the time dimension is legible up front.
  3. Do nothing — the cost is ~383px of scroll on a page that already passes its stated goal.
  **This needs your call — it's a product decision, not a defect.**

- [ ] **Close the 218px void in Home's left column** &nbsp;`Moderate` &nbsp;needs a design call, not a one-liner
  Cause found: `src/app/(app)/_components/FounderPulse.tsx:314` — the hero card carries **`self-start`**, so it doesn't stretch to the grid row height set by the taller right column.
  FounderPulse's left column ends at `y=682`; the next content starts at `y=979` — **750×218px = 163,662px² of empty page** in the highest-attention zone.
  **Do not just remove `self-start`.** That stretches the card but leaves the same whitespace *inside* its border — the void moves, it doesn't close.
  **Do not fill it by growing the chart either.** `PaceChart` (`:85-114`) is an SVG with `preserveAspectRatio="none"`; making it ~265px taller would **vertically exaggerate the revenue line's slope**. On a pace chart, slope *is* the metric — that trades whitespace for a misleading graphic.
  **Also note** the void size is not fixed: the row height is driven by the right column (Last 7 days + Needs attention), so it changes with the notification count. Any hardcoded height will drift.
  **Realistic options:** shorten the right column (cap "Needs attention" at 3 items with a "+N more" link — it already has that affordance), or accept the gap and pull `At a glance` up beneath it.

- [x] **Move Finance's KPI strip above the chart band** &nbsp;`Moderate` &nbsp;**DONE & VERIFIED 15 Jul**
  `src/app/(app)/finance/page.tsx` — the `MetricCard` grid now renders directly after `PageHeader`, ahead of the bento charts.
  **Verified in the rebuilt bundle at 1440×900: 7 of 7 KPI cards above the fold** (was 0 of 7). Net profit −₹27,500, Profit margin −18.7%, Gross profit ₹93,000, COGS ₹54,000 all now at `y=178`; Expenses, Receivables and YTD at `y=370`. §4.4's nine required figures no longer need a scroll.
  **The "drop the duplicate Net Profit card" half was withdrawn — do not do it.** "Money in vs money out" (`:195`) shows the same −₹27,500 but has **no `(i)` tooltip**, while the MetricCard carries `tooltip="Net Profit = Revenue minus all costs…"`. §4.4 explicitly requires *"`(i)` tooltips on Gross & Net profit with the plain-English definitions"*. Deleting the card would have traded a fold fix for a spec regression. Both tooltips verified still present after the move.
  **Unchanged, as expected:** page is still 4508px / 20% visible (the swap reorders, it doesn't shorten), and the tabs are still at `y=1364` — moving the KPI strip up doesn't shift them. See the separate tabs item below.

---

## 2. Worth doing

- [ ] **Propagate the stale bank-balance flag into the runway pill and derived numbers** &nbsp;`Moderate` &nbsp;~2 hrs
  `src/components/shell/RunwayBadge.tsx:32` · flag already exists as `runway.cashStale` (`src/app/(app)/cash/page.tsx:112`)
  `/cash` marks its own input `⚠ stale`, and Home lists "Bank balance entry overdue" as a Watch — but the pill states a confident `Runway: 3.1 months`, and break-even and the "cash reaches ₹0 around 17/10/2026" date render at full confidence too. The most-promoted number in the app is the one whose freshness is least visible at the point of use.
  **Change:** thread `cashStale` into `RunwayBadge` (e.g. muted + `~3.1 mo`). The computation exists; only the binding is missing.
  **Why this matters:** runway is one of §1.1's three three-second metrics. A precise-looking number from stale input is worse than an obviously hedged one.

- [ ] **"Top 5 payments" whitespace** &nbsp;`Minor` &nbsp;**partly withdrawn — read before acting** &nbsp;`corrected 15 Jul`
  `src/app/(app)/finance/page.tsx:159` (`className="lg:row-span-2"`)
  **The "shows 3 under a title promising 5" part was wrong.** July 2026 has exactly **3 income entries** (June had 5, May had 8 — queried). The card correctly shows all of them, half-way through a sparse month. Not a defect; I read sparse seed data as a layout bug.
  **The "61% empty" figure is also unrepresentative** — it was measured in the emptiest month of the three. With June's 5 payments the same card is ~45% empty. Real, but smaller than reported.
  **What's actually true:** `lg:row-span-2` (`:159`) forces the card to 787px regardless of content, so it's over-tall even when full.
  **Do not just delete `row-span-2`.** The bento is a 3-column grid: Revenue / Revenue-by-level / Top-5(spanning) on row 1, Expenses / Money-in-vs-out on row 2. Drop the span and you get an **empty cell at row 2 column 3** — the whitespace moves outside the card instead of closing. Same trap as the Home void.
  **Verdict:** low priority. Fix it only as part of a deliberate bento re-layout.

- [ ] **Move Finance's section tabs under the page header** &nbsp;`Moderate` &nbsp;~30 min
  `src/app/(app)/finance/page.tsx:298` (`<Tabs>`)
  Income / Expenses / Pending payments / Commission sit at `y=1364` — 464px below the fold. Nobody can see the page *has* four sections without scrolling past five charts.

- [ ] **Move Pipeline's six discovery-call metrics into the top KPI band** &nbsp;`Moderate` &nbsp;~2 hrs
  `src/app/(app)/pipeline/page.tsx` — cards currently at `y=1971-2163`
  Show-up rate, no-show rate, highly-qualified rate and conversions-by-level are all §5.3-required and sit ~1,100–1,260px below the fold. Pipeline shows **15% of itself** (5849px) — the least-visible page in the product.
  **Why:** §5's stated job is *"tells Ameen in real time whether activity is enough to hit the monthly target"*. The target bar answers the money half; these four answer the activity half.

- [ ] **Promote Funnel's overall conversion % to a headline** &nbsp;`Moderate` &nbsp;~1 hr
  `src/app/(app)/funnel/page.tsx` — currently a cell in the metrics table at `y=826`
  §8.3 calls it **"the key number"** — the only metric in the entire spec given that phrase. It renders identically to nine table peers. Lift it out beside the drop-off alert.

- [ ] **Promote and resize Funnel's Ghosted Blueprint strip** &nbsp;`Moderate` &nbsp;~2 hrs
  `src/app/(app)/funnel/page.tsx` — cards at `y=1530`, 176×156 = 27,323px² each
  §8.4 calls downloads→Guided % **"the key outcome"**, and §8 says the section exists partly to answer whether the Blueprint feeds Guided enrollments. These are the **smallest cards in the product** — less than half a Home KPI card — 630px below the fold. A stated key outcome rendered at minimum weight.

- [ ] **Route My Journey's check-in chip through the signal palette when overdue** &nbsp;`Moderate` &nbsp;~1 hr
  `src/app/(app)/my-journey/page.tsx` — chip at `y=293`
  Measured: "Next check-in 13/07/2026" renders `rgb(10,100,226)` on `rgb(230,240,254)` — the **primary accent**, identical to the neutral "Steady" and "Coach: Karthick" chips. Today is 15/07: it's 2 days overdue and reads as calm information.
  **The system already knows** — Ameen's home lists "9 check-ins due — Next check-in date is today or has passed" as a Watch. Overdue-ness is computed, surfaced to the founder, and hidden from the person who has to act on it.
  **Why:** DESIGN §0 rule 2 — *"One accent, used with restraint … never used for 'this number is good' — that is what the signal palette is for."*

- [ ] **Normalise the KPI card size across dashboards** &nbsp;`Moderate` &nbsp;~half day
  Global — `src/components/ui/MetricCard.tsx` consumers
  DESIGN §5.3 calls the KPI card *"the workhorse of every dashboard"* and specifies padding, radius and internal anatomy — but never dimensions. Measured result: **eight different card sizes**, from 25,278px² (GN Workshop) to 87,758px² (Head's home) — a 3.5× spread decided by whichever grid the card landed in.
  **Consequence:** size is a metric card's main hierarchy signal and it currently encodes nothing. Funnel's "key outcome" cards are the smallest in the app.
  | Screen | Card | Area |
  |---|---|---|
  | Home (Admin) | `367×156` | 57,136px² |
  | Home (Head) | `564×156` / `371×156` | 87,758 / 57,675px² |
  | Finance | `271×176` / `271×156` | 47,658 / 42,230px² |
  | Pipeline | `367×176` | 64,480px² |
  | Students | `271×156` + `271×176` | 42,338 / 47,658px² |
  | Telecaller | `271×156` | 42,230px² |
  | Funnel | `176×156` | 27,323px² |
  | GN Workshop | `244×104` | 25,278px² |

- [ ] **Replace Home's welcome strip with the urgent nudge** &nbsp;`Minor` &nbsp;~2 hrs
  `src/app/(app)/page.tsx:120-124`
  `PageHeader` spends 84px of the top-left attention zone on "Welcome back, Ameen" / "Here is where things stand today" — zero information, on the one screen with a three-second budget (§1.1).
  **The pattern already exists in the codebase:** Cash Health's header states its actual job (*"If no new money came in from today, how long does the business keep running?"*), as do Pipeline's and Funnel's. Home is the only one of the four that says nothing.
  **The data already exists too** — `CLAUDE_DESIGN_BRIEF` §3.1 specifies exactly this ("the single most urgent nudge"), and it's already computed in `notifications` / "Needs attention".

---

## 2b. Found after the audit, from a real user report (15 Jul)

Both reported as "blank space on the right, and the scroll doesn't reach the bottom". Neither was what it looked like, and the audit missed both because **I only measured at 1440×900 and 1280×800** — the width bug only appears above ~1656px viewport, and the sidebar one needs a tall enough window to notice items are missing.

- [x] **Sidebar nav had no scroll affordance** &nbsp;`Moderate` &nbsp;**DONE & VERIFIED 15 Jul**
  `src/components/shell/AppShell.tsx:214` — removed `no-scrollbar` from the nav's scroll container.
  The nav overflows by **407px at 1080p** — 9 items sit below the fold: CV Studio, WhatsApp, Conversations, Reports, Founder Console, Automation, App Guide, My Profile. The container *did* scroll correctly (`clientHeight 875 / scrollHeight 1282`), but `no-scrollbar` hid the scrollbar (`scrollbarWidthPx: 0`), so nothing indicated the sections existed. Wheeling over the main content doesn't move it — you had to know to hover the sidebar.
  **Effect:** Founder Console and Reports were effectively invisible unless you knew the URL or used ⌘K.
  **Verified:** `scrollbarWidthPx: 0 → 10`.
  *Note: I first misdiagnosed this as items being unreachable. They were always reachable — it's discoverability, not a hard bug.*

- [x] **Top bar overshot the page content by 195px** &nbsp;`Moderate` &nbsp;**DONE & VERIFIED 15 Jul** — see the width item in §2
  The top bar has **no width cap** (`maxWidth: none`, spans the full 1670px shell) while page content was capped at 1280 and centred. At 1920 the logout button sat at `x=1878` while every card stopped at `x=1715`. The gutters were actually *symmetric* (172px each side) — but the left one reads as padding against the sidebar, while the right one is bare canvas with the top bar visibly running past it. That overshoot is what made it read as a bug rather than as centring.

## 2c. Responsiveness + motion (15 Jul, from a second user report)

- [x] **FounderPulse crushed its own side column between 1024–1280px** &nbsp;`Moderate` &nbsp;**DONE & VERIFIED**
  `src/app/(app)/_components/FounderPulse.tsx:310,314`
  **This was the actual "not responsive" bug.** The hero grid split to 3 columns at `lg` (1024px). Once the 240px sidebar and gutters came out, the side column landed at ~300px — narrow enough that the "Last 7 days" panel's own 2-up stat grid collapsed into a single stack, so the panel read as broken. The give-away was the user's screenshot showing *New leads / Proposals* stacked vertically where a correct render shows a 2×2 grid.
  **Fix:** split at `xl` (1280) instead of `lg`. Below `xl` the hero takes full width and the side column sits underneath, with its two cards side by side from `md` (`grid-cols-1 md:grid-cols-2 xl:grid-cols-1`) rather than stacking into one very tall strip.
  **Bonus:** at <`xl` this also closes the original audit's 218px left-column void — the hero is full width, so there's no short column to leave a gap.

- [x] **Smooth scrolling** &nbsp;**DONE & VERIFIED**
  `src/app/globals.css`
  `scroll-behavior: smooth` on `html` **and** the sidebar nav's scroll container, plus `scroll-padding-top: 80px` so anchored jumps clear the 64px sticky top bar instead of hiding under it.
  *Worth knowing:* the §6 reduced-motion block already contained `* { scroll-behavior: auto !important }` — it was **guarding a feature that had never been switched on**.

- [x] **Motion** &nbsp;**DONE & VERIFIED**
  - **Route transition:** `page-enter` (260ms, 6px rise + fade) on `main > *`. App Router swaps `<main>`'s subtree on navigation, so the page root mounts fresh and it replays with no `key` needed.
  - **Stagger extended 8 → 12** and then capped: `.rise-in:nth-child(n+13)` all land on the last beat. Pages run fluid now, so a wide window fits more cards per row than the original 8-deep cascade covered — beyond it the tail popped in with zero delay. Past ~12 a stagger stops reading as one motion and starts feeling like lag.
  - **Scrollbars styled** thin/quiet with a hover state — needed now that the sidebar's is exposed, so it looks deliberate rather than like a stock OS bar.
  - **All of it reduced-motion guarded**, including the new `main > *` and the stagger delays.
  **Deliberate restraint:** DESIGN §0 says *"trust through calm … no decorative noise"* and §9's Don't list includes *"animate the dashboard like a landing page."* So this is functional motion — softening a route swap, pacing a card cascade — not decoration. Anything showier would contradict the design system.

## 3. Cheap polish

- [ ] **Equalise Students' two KPI row heights** &nbsp;`Minor` &nbsp;~15 min
  `src/app/(app)/students/page.tsx`
  Row 1 is `271×156` (42,338px²), row 2 is `271×176` (47,658px²) — same grid, 20px apart. The difference tracks content length, not importance, so it puts 12% more visual weight on "Avg NPS" than "Total active students" for no reason.

- [ ] **Move GN Workshop to `max-w-7xl` and adopt `MetricCard`** &nbsp;`Minor` &nbsp;~1 hr
  `src/app/(app)/german-note/workshops/[workshopId]/page.tsx`
  Uses `max-w-5xl` (1024px) where DESIGN §5.1 states *"max content width 1280px"*. Its cards are 244×104 and carry no `.text-metric`, meaning the page doesn't use the design system's KPI card at all — DESIGN §2.1: *"If you are typing `text-lg` or `text-[15px]`, you are off the scale."*

- [ ] **Size Pipeline's "Calls completed" / "Won this month" to content** &nbsp;`Minor` &nbsp;~30 min
  `src/app/(app)/pipeline/page.tsx` — both 113,171px² at `y=402`
  Same grid-stretch mechanic as Finance's Top 5: two 146px cards stacked in column 1 force columns 2–3 to 308px. "Won this month" is a mostly-empty ring around a `0`.

- [ ] **Consider Ghost styling for Finance's table row actions** &nbsp;`Minor` &nbsp;~30 min
  `src/app/(app)/finance/_components/{IncomeSection,ExpenseSection,PendingSection}.tsx:88`
  50 solid-red Delete buttons (`rgb(203,42,49)`, 62×36) run down the right edge, 8px from Edit, with Delete the outermost/easier rightward target.
  **The accidental-click risk is already handled** — `remove()` calls `askConfirm({ title: "Delete income entry for …?", body: "This cannot be undone.", danger: true })`, exactly per DESIGN §5.9. That's why this is Minor.
  **The residual issue is chromatic:** red is now the most-repeated colour on Finance while the one red-worthy signal (−18.7% margin) is below the fold — inverting DESIGN §0's *"the data is the hero, not the chrome"*. DESIGN §5.4 assigns Ghost to *"tertiary, table row actions"*; §5.4 also assigns Danger to *"Delete, void"*. **The two rules conflict** — pick one and write it down.

- [x] **Content width caps removed entirely — every page is now fluid** &nbsp;**DONE & VERIFIED 15 Jul**
  *Supersedes both the old "align Arena's width" item and the interim 1600px step.*
  **47 files** changed: every page-root wrapper is now `w-full`. Applied with a reporting script, not a blind sed — the eight distinct wrapper patterns (`max-w-[1600px]`, `6xl`, `5xl`, `4xl`, `3xl`, with and without `mx-auto w-full`) all collapse to `w-full`, including every `loading.tsx` skeleton so there's no layout jump on load. `DESIGN_SYSTEM.md` §5.1 rewritten: **no max content width**.
  **This also resolved the three stragglers** — Arena (1152), GN Workshop (1024) and My Journey (768) are fluid too, so the whole app finally agrees.
  **Utility `max-w` deliberately preserved** (`max-w-sm` on text ×8, `mx-auto flex max-w-lg` empty states ×5, `max-w-[26px]` progress bar, `max-w-64` inputs, `max-w-full` scrollers). One `max-w-3xl` was intentionally left on `agreements/[id]`'s validation-error card — it's a short message, not a page.
  **Verified across the full range — zero horizontal overflow at every size:**
  | Viewport | Overflow | Content | Layout |
  |---|---|---|---|
  | 380 (phone) | **0** (was 35) | 348 | 1 col; logout reachable again |
  | 758 (tablet) | 0 | 626 | 2 KPI/row; sidebar visible |
  | 1270 (laptop) | 0 | 974 | 4 KPI/row; full runway label |
  | 1920 | 0 | 1624 | 28px gap = padding only (was 195) |
  | 2560 (ultrawide) | 0 | 2254 | 4 KPI @ 551px; longest prose ~85ch |
  **The trade-off, stated plainly:** fluid means no free measure. At 2560 the longest subtitle hits ~85ch — the ceiling of comfortable reading. New pages must carry their own bounded column for prose, and use responsive grid columns so cards spread rather than stretch.

- [x] **Top bar overflowed a phone by 35px — logout was off-screen** &nbsp;`Moderate` &nbsp;**DONE & VERIFIED 15 Jul**
  `src/components/shell/AppShell.tsx` + `src/components/shell/RunwayBadge.tsx`
  Pre-existing, unrelated to the width work, and found only by sweeping to 390px. At 380 the top-bar cluster needed ~319px next to the hamburger and brand, pushing the **logout button to `x=391–415` — entirely outside the viewport** and dragging the whole page sideways.
  **Three changes, each reasoned against the spec:**
  1. `RunwayBadge` drops only the `"Runway: "` **label** below `sm`; the value keeps `3.1 months`. DESIGN §3 says *"Runway: 1 decimal (`4.2 months`)"* — that governs the value, not the label, and the code comment's *"never `4 mo`"* stays honoured. §9.4 still gets its pill on every screen.
  2. Theme toggle `hidden sm:inline-flex` — falls back to OS `prefers-color-scheme`, so a phone still renders the right mode.
  3. Cluster gap `gap-1 sm:gap-2 md:gap-3` + `min-w-0`.
  **Verified at 380:** overflow `35 → 0`; logout `right=411 → 364` (fully on-screen); pill retained.
  *Known cosmetic residue:* the pill wraps to two lines ("3.1 / months") on a phone. Forcing `whitespace-nowrap` costs ~36px and re-breaks the overflow, so it stays wrapped.

- [ ] **Amend BUILD_SPEC §9.5 to match Cash Health's built summary strip** &nbsp;`Minor` &nbsp;~15 min
  Doc change, not code — `docs/BUILD_SPEC.md` §9.5
  §9.5 specifies *"Four numbers first: cash in bank · total receivables · total payables due this month · runway"*. Built: five numbers (cash, receivables, overdue, expected-30d, payables), with runway as the ring below. **The build is better than the spec** — the ring serves runway far better than a strip cell would. Correct the document, not the code.

- [ ] **Delete the stale duplicate `DESIGN_SYSTEM.md`** &nbsp;`Minor` &nbsp;~5 min
  Two copies exist and have diverged: `B2-Consultants/docs/DESIGN_SYSTEM.md` (v1.1, 15 Jul) vs `docs/DESIGN_SYSTEM.md` (stale, 10 Jul). This audit graded against v1.1. Delete one before it causes a real bug.

---

## 4. Blocked on a decision — do not code yet

- [ ] **Settle the User redirect** &nbsp;`Critical` &nbsp;decision, then ~1 hr
  `src/app/(app)/page.tsx`
  §2.1 says User is *"Redirected to own daily log"*. Measured on login as `asma@b2consultants.in`: `location.pathname === "/"`. She gets a bespoke home the spec never describes.
  **Decide:** honour §2.1, or update §2.1. The built home isn't obviously worse than a redirect — but right now **no document describes what ships**, which is why this is Critical despite being cheap.
  Blocks the next item.

- [ ] **Asma's home shows none of her five job metrics** &nbsp;`Moderate` &nbsp;blocked on the above
  Measured across the rendered page: `jobMetricsPresent: false`. §6.3 defines her work as *"discovery calls completed · highly-qualified calls · follow-ups · proposals sent · no shows"*. Her home instead leads with a work-time tracker (0.0h) and an Arena level.
  Graded Moderate, not Critical, **only because §2.1 says this page shouldn't exist for her** — there's no stated goal for it to fail. If the home stays, its hero should be her five §6.3 numbers, not a stopwatch.

- [ ] **Karthick's card weighting** &nbsp;`Minor` &nbsp;needs 15 min with Karthick
  Pipeline Value and Wins are his two biggest cards (87,758px² each); Students is smallest and last (57,675px², position 5 of 5). §6.3 defines his job as *"sessions delivered · students checked in on · assignments reviewed · students flagged at risk"* — delivery, not sales.
  **Hypothesis, not finding.** BUILD_SPEC §2 does permit Head to see Pipeline and states no priority for his home. Ask him whether he acts on pipeline value before changing anything.

- [ ] **Is Arena exempt from DESIGN §0?** &nbsp;`Minor` &nbsp;decision
  `src/app/(app)/arena/page.tsx` — 10 gradient-filled elements; the XP podium bars encode data, not chrome.
  DESIGN §9 "Don't": *"gradient-fill data cards"*. §0 rule 3: *"No loud gradients on data, no decorative noise."* But a gamification leaderboard and *"trust through calm"* want opposite things, and **no document adjudicates**.
  Either answer is fine — write it down. Flagged as a stated-rule conflict, not taste.

- [ ] **Audit Pipeline's 5849px page height** &nbsp;`Moderate` &nbsp;~half day
  The page is 6.5 viewports tall and doing the job of a dashboard *and* a lead CRM. The leads table alone is 2778px. Probably belongs behind a tab — but that's a scope decision, not a placement fix.

---

## 5. Verified correct — do not "fix" these

Nine things measured as right. Several look like defects and aren't:

- [x] **Runway pill in the top bar** — looks like duplication; is a **spec requirement**. §9.4: *"The runway number + colour appears in the top bar on every screen — Ameen never has to open Cash Health to see it."* §15 lists it as an acceptance criterion. **It is why Home passes its three-second test.** Do not remove it.
- [x] **Runway pill absent for Head / User / Student** — measured `runwayPillPresent: false`. Correct per DESIGN §5.1: *"Cash Health is Admin-only … it is not rendered for them, by design."*
- [x] **Funnel's weakest-stage alert at top** — `y=186`, first block. Obeys §8.3's *"alert box at top"* exactly, and it's the best-written element in the product: *"small miss — watch, don't panic"* delivers the answer **and** calibrates the reaction. Copy this pattern to Home's welcome strip.
- [x] **Pipeline's target bar** — `y=178`, full width, red at 38% of pace, labelled `₹1,47,000 of ₹8,00,000 · 18.4%`. Exactly §5.3.
- [x] **Pipeline's "Change target for this month"** — inside the card holding the number it affects. Fitts's Law satisfied; the pattern the rest of the app should copy.
- [x] **Students' satisfaction / NPS / highest-LTV placement** — all above the fold. §7.5 and §7.6 satisfied. All eight KPIs above the fold — the best KPI placement in the product.
- [x] **Export CSV at `x=1266` on both Finance and Cash Health** — same action, same location.
- [x] **Every delete is guarded** — `askConfirm()` with the record named and "This cannot be undone", per DESIGN §5.9. I went looking for an accidental-delete hole and didn't find one.
- [x] **"One primary per view" (§5.4) holds everywhere** — blue-filled tab chips are active states, not competing primaries.
- [x] **Cash Health generally** — the best dashboard here. Runway ring is the largest element on the page (428,954px²) and above the fold; the header states the job; it answers rather than displays. **Use it as the reference for fixing the others.** The only real fix is the staleness item in §2.

---

## 6. Open questions — answer these and the audit gets sharper

- [ ] **What are Telecaller Pay, Arena, My Journey and GN Workshop *for*?**
  `BUILD_SPEC.md` declares itself the sole authority (§0: *"Nothing outside this document is in scope"*) and contains **zero** occurrences of "telecaller", "arena", "my-journey", "gamification" or "leaderboard". Goal alignment for these four is **unaudited — not passed, not failed**. One sentence each and I can audit their placement properly.

- [ ] **Is `BUILD_SPEC.md` still authoritative?**
  It's v1.0 and describes three roles; the app ships five and four screens the spec has never heard of. Several severities here are graded against a document that may simply be out of date. If it is, the grading changes — say so and I'll re-grade.

- [ ] **Can we watch Ameen and Karthick use this for 15 minutes?**
  There is **no usage data and none meaningfully can exist** — no analytics library in `package.json`, and `AuditEntry` is only the ledger hash-chain. At n≈5 users (n=1 for most screens), heatmaps and A/B tests are the wrong instrument. Every hypothesis in this list resolves faster by watching than testing.
