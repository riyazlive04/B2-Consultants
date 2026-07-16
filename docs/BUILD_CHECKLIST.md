# B2 Consultants — Build Checklist & Orchestration Plan

**Status: all 14 workstreams (§0–§13) landed 2026-07-15.** Derived from
`docs/PRODUCT_AUDIT_2026-07-14.html` (19-layer teardown). Every item below traces back to a
numbered section in that report (§1–§19) — read the full Gaps/Upgrade-Path text there for context
this doc doesn't repeat. What follows is now a **record of what shipped**, not a plan — kept as-is
(rather than deleted) so the reasoning behind each call is still findable later.

Final verification: `npx tsc --noEmit` clean, `npx next build` clean (one cosmetic BullMQ webpack
warning, harmless), and a full authenticated smoke test across 25 routes with zero server-side
errors. Two real runtime bugs were found and fixed *during that verification pass* — see
"Bugs found during final verification" at the bottom; neither was catchable by `tsc`.

---

## The one rule that mattered

**Only the Foundation Agent (§0) touched `prisma/schema.prisma`.** Every other workstream needing
a new column requested it there instead of editing the schema itself — this is why 13 parallel/
sequential agent passes never once collided on a migration.

---

## Phasing (as executed)

| Phase | What | Result |
|---|---|---|
| **Phase 0** | Schema changes | ✅ Two migrations: `phase0_foundation_fixes` (6 fields/enum values) + `opportunity_notes` (added mid-run for §3). Both purely additive. |
| **Wave 1** | Zero schema dependency | ✅ §13, §9, §6, §12, §1 (parallel), plus §4 done directly (not delegated). One agent batch hit the account's session usage limit mid-task and had to be relaunched — see below. |
| **Wave 2** | Zero schema dependency, dispatched after Wave 1 | ✅ §2, §11, §5, §8 (parallel) |
| **Phase 2** | Needed Phase 0's schema | ✅ §3, §7, §10 (parallel) |

**One operational note worth keeping:** partway through Wave 1, 7 of 7 dispatched agents failed —
2 instantly (a model-classifier outage) and 5 mid-task after hitting the account's session usage
limit (reset at a fixed time). The 5 that died mid-task left real partial state: two files were
left referencing code that was never written (a broken import in `ProfileClient.tsx`, a missing
`BlockListEditor` component in `FunnelBuilder.tsx`). Both were found via `tsc --noEmit` and fixed
by hand before relaunching. Lesson for next time: run `tsc --noEmit` after *every* wave, not just
at the end — it caught real breakage from a hard interruption, not just logic bugs.

---

## §0 — Foundation / Schema Agent — ✅

Migration `20260714183313_phase0_foundation_fixes` (Phase 0) + `20260715021353_opportunity_notes`
(added mid-run once §3 needed it) applied to the local dev DB; Prisma client regenerated twice;
server rebuilt and restarted both times. All additive — no drops, no data-loss risk.

- [x] `InvoicePayment.recordedById → User` real FK (was a bare unindexed string)
- [x] EUR-minor fields: `Product.priceEurMinor`, `Subscription.amountEurMinor` (+ `fxRateUsed` on
      each, matching the Income/Expense/Opportunity/Invoice convention)
- [x] `LedgerSourceType.INVOICE` / `.PAYMENT` enum values
- [x] `PipelineStage.probability Int?` (0–100, nullable — unset stages keep flat-sum behavior)
- [x] `read` / `assignedToId` fields on `Message`
- [x] `deletedAt` soft-delete column on `Company`, `Pipeline`, `PipelineStage`, `Product`
- [x] *(mid-run addition)* `ContactNote.opportunityId` + `Opportunity.notes` back-relation, added
      once §3 needed a place for deal-specific notes to live
- [ ] **Deliberately not done** — extending the `legacyStage` bridge to every `Pipeline` (or making
      `Lead.stage` a computed projection). Cross-cutting *behavior* change, not an additive column;
      still documented inline on `PipelineStage.legacyStage` in the schema. Owned by whoever next
      touches Pipeline/Opportunity unification, if it's ever prioritized.
- [ ] *(Not started, by design)* `orgId`/`tenantId` scoping — only relevant if productization beyond
      B2 Consultants is greenlit; a large migration, not something to do opportunistically.

---

## §1 — Onboarding Agent — ✅

- [x] Password-reset flow: `sendResetPassword` wired into better-auth (verified the actual client
      method from `node_modules/better-auth` source — it's `requestPasswordReset`, not the more
      commonly-documented `forgetPassword`), reusing the existing Resend pathway. New
      `/forgot-password` and `/reset-password` routes/forms.
- [x] Post-invite first-touch walkthrough (`OnboardingWalkthrough.tsx`, 3 steps, role-scoped copy),
      triggered via `?onboarding=1` after invite acceptance. "Seen it" marker uses `localStorage`,
      not the `User.capabilities`/`sectionAccess` JSON fields — those get wholesale-rewritten on
      every admin access edit, which would silently un-dismiss the tour.
- [x] `middleware.ts` allowlist updated with `/forgot-password`, `/reset-password`

## §2 — RBAC & Navigation Agent — ✅

- [x] Head's Pipeline access fixed (`sections.ts` roles now `["ADMIN","HEAD","USER"]`)
- [x] DESIGN_SYSTEM.md §5.1/§9 wording corrected: the runway pill is "for Admin," not universal —
      the *code* (`layout.tsx`'s `session.role === "ADMIN"` gate) was already correct; only the doc
      overclaimed. Cash Health is Admin-only per BUILD_SPEC, and the runway figure is Cash Health data.
- [x] Head gets a real scoped home view: reuses `getPipelineSnapshot()` for Pipeline-value/Wins
      MetricCards, never any Cash/Finance data
- [x] Date-range control (This Month / Last Month / QTD) added to the home KPI grid, threaded
      through `getPipelineSnapshot`/`getRunwaySnapshot` via an optional param (backward-compatible —
      every existing call site with no arg still gets "this month")
- [x] Shared `Breadcrumbs.tsx` component, wired into `/contacts/[id]` and `/automation/[id]`

## §3 — Contacts & Search Agent — ✅

- [x] Wired the previously-dead `search` param into a real server-side query
- [x] Replaced `LIST_CAP = 1000` with genuine cursor-based pagination (100/page, capped at 500 per
      query) — nothing is silently truncated anymore
- [x] Multi-field filter panel: owner, stage, source, city, date range — all URL-param-driven
- [x] Saved views (`localStorage`-based — no schema for a server-side store was in scope)
- [x] Global `⌘K`/`Ctrl+K` command palette (`CommandPalette.tsx` + `/api/command-palette`) across
      Contacts, Opportunities, Invoices, mounted in `AppShell.tsx`
- [x] `@mention` → notification on `ContactNote`, ported from the German-Note community pattern.
      Notable finding: there's no persisted `Notification` table anywhere in this app — GN's own
      mentions are a read-time-derived query, not a write-time notification row. Matched that same
      shape rather than inventing new architecture.
- [x] `Opportunity` now has its own notes (`ContactNote.opportunityId`), with a Notes tab in the
      Kanban card's edit modal, fetched on-demand per card (not preloaded per board).
- **Known trade-off, disclosed by the agent:** CSV export now covers only the current 100-row page,
  not the full filtered set — a real "export everything" would need its own server action.

## §4 — Pipeline Unification Agent — ✅ (done directly, not delegated — the audit's #1 finding)

- [x] Replaced the `npm run db:crm` dev-instruction empty state with real product copy + a
      "Create pipeline" action
- [x] **Revised finding, not a fix:** `/pipeline` is not a redundant duplicate of the Kanban — it's
      a distinct sales-ops dashboard (targets, call splits, lead/outcome CRUD) that happens to embed
      one small legacy `StageChart` widget. Retiring/rebuilding the *page* would have been wrong; the
      narrower real risk (a second pipeline's moves don't write through to `Lead.stage`) is unchanged
      and documented in the schema.
- [x] Optimistic drag-and-drop (instant local move, rollback + toast on server failure)
- [x] Stage reorder wired to the `reorderStages` action (it already existed server-side, unused)
- [x] "Move to stage" `<select>` in the edit modal, routed through the *same* `moveOpportunity` path
      drag-and-drop uses. Cards are also now keyboard-focusable (`role="button" tabIndex={0}`,
      Enter/Space opens the modal) — one change that closed the Kanban's keyboard-a11y gap, its
      mobile fallback, and the "how do you move a card without a mouse" gap simultaneously.
- [x] Weighted forecast using the new `probability` field (flat total always shown; weighted total
      shown alongside when a stage has a probability set)
- [x] Board query capped at 300 cards/stage with a visible "more exist" notice, not silent truncation
- [x] *(bonus)* `deletePipeline`/`deleteStage` switched from hard-delete to the new `deletedAt`
      soft-delete column — recoverable, not a silent undo-less cascade

## §5 — Automation Engine Agent — ✅

- [x] `IF_TAG` branch action type — the workflow engine can conditionally jump steps now, not just
      run linearly. Includes an iteration guard against self-referencing infinite branches.
- [x] BullMQ wired in as a **precisely-timestamped delayed-job store** for `WAIT` steps, drained by
      the existing cron route (`runDueWorkflows`) — not a live `Worker` process. **Honest limitation,
      not a gap:** this repo has no persistent worker process anywhere (checked `package.json`,
      `Dockerfile`, `docker-compose.yml` — none exist), and the sibling WhatsApp cron route's own
      comment states this is deliberate ("the app has no long-running worker — this endpoint IS the
      scheduler seam"). A real independent-of-cron fallback needs an actual second process; noted as
      a real infra decision, not implemented opportunistically.

## §6 — Forms & Funnels (Sites) Agent — ✅

- [x] 2-column row/section block type (`Block.columns: Block[][]`) — the funnel builder can lay out
      side-by-side content now, not just a single vertical stack. Public renderer (`SiteBlocks.tsx`)
      recursively renders rows; the builder's `BlockListEditor` recursively edits them.
- [x] `<iframe>` embed-code button next to "Copy link" on the Forms list

## §7 — Payments & Billing Agent — ✅ (closes the audit's other headline finding)

- [x] Every `InvoicePayment` now posts into the real ledger, in the same transaction as the row
      write — `paymentEntryDraft()` mirrors `finance-posting.ts`'s existing pattern exactly, debiting
      bank/cash and crediting the (previously unused) Accounts Receivable account already sitting in
      the chart of accounts. **Disclosed limitation:** this only posts the *payment* side; invoice
      *issuance* posting (Dr AR / Cr Income) is out of scope, so AR will trend negative until that's
      built too — a real follow-up, not a silent gap.
- [x] "Send" now actually emails the invoice (PDF attached, via the existing Resend integration),
      with the public link kept as a body fallback; never blocks the status flip if email is
      unconfigured or the customer has no email on file.
- [x] `Product`/`Subscription` now capture and display EUR alongside INR, reusing the existing
      `AmountPair` dual-currency input pattern (relocated from a page-private folder into the shared
      UI kit so Payments could reuse it).

## §8 — Conversations Agent — ✅

- [x] WhatsApp added to the unified Composer (free-text session messages + a template picker for
      outside-24h-window sends, since WATI requires pre-approved templates)
- [x] Real inbound webhooks: `/api/twilio/webhook` (fully functional — genuine inbound SMS) and
      `/api/resend/webhook` (delivery-status always; genuine inbound email too, verified against
      Resend's actual current API — inbound email is real but requires one-time dashboard setup
      before `email.received` events start firing)
- [x] `Message.read`/`assignedToId` wired into the inbox: unread indicator, per-thread assignment,
      18-second polling (paused when the tab is hidden)
- [x] New `/api/conversations/poll` lightweight signal endpoint so polling doesn't re-run the whole
      force-dynamic inbox page

## §9 — Bookings & Calendar Agent — ✅

- [x] Fired the previously-dead `BOOKING_CREATED` trigger from `submitBooking()`
- [x] `AppointmentSlot.assignedToId` wired into real filtering (slot generation + bookings list)
- [x] Batch slot generator: date range + weekday multi-select (was one date at a time), reusing the
      existing interval/dedup logic rather than adding a separate free-text time-list field
- [x] Buffer / min-notice / max-advance-booking config via a new `AppSetting` key
      (`bookingRulesConfig`), following the established `getXConfig`/`writeXConfig` lazy-default
      pattern — no new schema needed
- [x] Two slot "types" (30/60 min) with human labels, display-layer only
- [x] Visitor timezone detected client-side and shown alongside (not replacing) IST/CET

## §10 — Reporting & Analytics Agent — ✅

- [x] New `/reports` route: pick Contacts/Opportunities/Invoices → a curated group-by field → see
      count/sum/win-rate per group, reusing `DataTable`. Fully URL-state-driven
      (`?object=&groupBy=`), so any report view is a shareable link — the "saved report" ask for a v1,
      without new schema. Registered in `sections.ts`, Admin-only.

## §11 — Mobile & Table Consistency Agent — ✅

- [x] All 17 `TableShell` call sites migrated to `DataTable` (the mobile-responsive component),
      preserving every column/action/empty-state. A few files needed real judgment calls — row
      selection + bulk actions on Contacts, transposed tables on the funnel report, inline edit-forms
      on SprintTracker — all documented inline in the affected files' git history/diffs.
- [x] Note: this migration caused a real bug (Server Components passing function-valued `Column`
      props into the Client Component `DataTable`) in 3 bare `page.tsx` files — found and fixed
      during final verification, see below. Not a flaw in the *migration itself*, but in three
      pre-existing files it touched that weren't yet Client Components.

## §12 — Performance Agent — ✅

- [x] `next/image` migration across the app, including the highest-leverage single fix (the shared
      `Avatar` component in `kit.tsx`, used everywhere)
- [x] `next/dynamic` code-splitting for `SignaturePad`, `ResumeEditor`, `InvoiceEditor` — the latter
      two finished by hand after the agent ran out of session budget mid-task. One collision
      avoided twice: two of the three host files already export a Next.js route-segment config
      named `dynamic` — `import dynamic from "next/dynamic"` would have silently shadowed it (the
      same class of bug as the `Image`/`next/image` naming collision found in `ProfileClient.tsx`,
      see below). Aliased to `nextDynamic` instead.

## §13 — Design Token & Accessibility Sweep Agent — ✅ (finished cleanly before hitting the session limit)

- [x] `text-white` → `text-on-accent` across the Agreements module (the exact 2.72:1 dark-mode
      contrast failure DESIGN_SYSTEM §1.4 warns about by name)
- [x] Off-scale type (`text-lg`, arbitrary `text-[Npx]`) → documented type-scale tokens, in
      Agreements/daily-log/german-note (scoped files only)
- [x] `SignaturePad` dynamic-imported via `next/dynamic`
- [x] Lint-rule follow-up documented as a dated `TODO` comment in `.eslintrc.json` rather than
      silently adding a new npm dependency — `eslint-plugin-tailwindcss` isn't installed, and adding
      a new package was correctly judged out of scope for this pass

---

## Bugs found during final verification (not caught by `tsc --noEmit`)

TypeScript's structural typing can't see React Server Component serialization rules — a `Column<T>`
object with function-valued `cell`/`value` fields type-checks fine whether it's constructed in a
Server or Client Component, but passing it from the former into the latter (`DataTable`, `"use
client"`) throws at *runtime*: "Functions cannot be passed directly to Client Components." Only a
real authenticated page-by-page smoke test caught these — `tsc` and `next build` both stayed green
the whole time.

1. **`src/app/(app)/profile/_components/ProfileClient.tsx`** — `import Image from "next/image"`
   shadowed a pre-existing `new Image()` (native DOM constructor, used in a canvas-resize helper).
   Renamed the import to `NextImage`.
2. **`src/app/(app)/funnels/[id]/_components/FunnelBuilder.tsx`** — an interrupted agent left a
   reference to a `BlockListEditor` component it never got to write. Written by hand, matching the
   file's existing patterns (`BlockFields`, `AlignSelect`).
3. **`src/app/(app)/funnel/page.tsx`, `cash/page.tsx`, `ledger/page.tsx`** — all three are async
   Server Components; the Mobile & Tables migration (§11) built `Column[]` arrays with `cell`
   functions directly inside them and passed them to `DataTable`. Fixed by extracting each page's
   table(s) into a small `"use client"` sibling component (`FunnelTables.tsx`, `CashTables.tsx`,
   `TrialBalanceTable.tsx`) that receives only plain, serializable data as props and builds its own
   columns internally — the same pattern every *other* migrated file (which were already genuine
   Client Components) already used correctly.
4. **`src/app/(app)/reports/_components/ReportTable.tsx`** (§10) — same bug, different cause: this
   file was pure presentation with no server-only imports, so the fix was just adding `"use client"`
   to the top rather than splitting anything out.

**Swept the whole codebase afterward** (`grep` every file importing `DataTable`, checked each for
`"use client"`) to confirm these were the only four instances — confirmed clean.

---

## Not on this list on purpose

The audit's **Long-Term Bets** (a real payment processor integration, a self-serve report *builder*
beyond this v1 pivot tool, the multi-tenancy decision, a visual node-based workflow canvas, an AI
layer) remain out of scope. Each is a project-sized decision, not a checklist bullet — the relevant
schema seams (`InvoicePayment.provider`/`externalId`, etc.) are in place for when/if they're
prioritized, but none were built speculatively.
