# Fix plan — the 9 broken flows

**Compiled:** 29 July 2026 · verified against live Supabase, not against the audit doc
**Supersedes:** the Phase 0 section of `ROAD_TO_10.md`, which was written 23 Jul and is now
partly stale (two of its items shipped; one of its items turns out to need code, not config).

> **Status, 29 Jul:** Tracks B and C are **built** — see §7 for what shipped and for three
> findings that changed the work. Track A (submit templates, deploy) is yours: it is the half
> that isn't engineering, and nothing in B or C is observable in production until it lands.

---

## 0. What changed since the 23 Jul audit

Three findings materially change the sequencing. All three were confirmed against production
today, and two of them contradict the audit's framing.

**Shipped since the audit — remove from the backlog:**
- `ensureBookingSlots()` now exists (`src/server/slot-topup.ts`) and is wired into the hourly
  cron at `daily-maintenance.ts:59`.
- Committed one-time outflows now feed Cash Health (`cash-metrics.ts:161`).

**Correction 1 — the booking calendar is a code gap, not a config gap.**
`SLOT_PATTERN_KEY` is *read* in two places and **written in none**. Grep the whole of `src/`:
nothing sets `slotPatternConfig`, and no UI anywhere references it. The default is
`enabled: false, weekdays: []` (`config-schema.ts:354`), so `ensureBookingSlots()` returns
`{ran: false, reason: "slot pattern disabled"}` on every tick and always will. The fix shipped
into a state where it cannot be switched on. This needs a writer built.

**Correction 2 — WhatsApp is no longer an env problem, and it is not self-serve.**
The audit blamed `WATI_ENABLED` not reaching the process. That was true on 20 Jul; it is not the
current failure. The most recent skip (26 Jul) reads `No WATI template configured for
"Discovery-call reminder"` — which is thrown *after* the env gate passes (`whatsapp.ts:168-185`).
The transport works: two messages reached real phones on 10 Jul.

The live catalogue holds **59 APPROVED templates and not one of them is transactional** — they
are all workshop/webinar marketing (`gn_workshop`, `summit_promo_3`, `b2_webinar_reminder`…).
Of 27 `WhatsAppKind` values, **1 is validly mapped**:

| Kind | Mapped to | Status |
|---|---|---|
| `MANUAL` | `workshop_absent_followup_3` | ✅ APPROVED |
| `EMI_PRE_DUE` | `emi_due_soon` | ✗ **not in the catalogue at all** |
| the other 25 | — | unmapped |

So the WhatsApp fix is gated on Meta approving templates that appear never to have been
submitted. That is the longest lead time in this plan and it is why it goes first.

---

## 1. The dependency graph

Ordering by severity is the wrong instinct here. Order by lead time — the two things that take
longest are the two things that aren't engineering.

```
Day 1   A1 Submit 26 WATI templates ──────────────► (Meta: 1–5 days) ──┐
Day 1   A2 Deploy + rotate secrets ────┐                               │
                                       ▼                               ▼
Day 2-5 B1 slot pattern writer ──► /book is live ──► bookings flow ──► confirmations
        B2 ledger period fix                                           agreement OTP
        B3 backfill 3 bookings                                         → signing works
        B4 resume authz
                                       │
                                       ▼
Wk 2-3  C  adoption: calls, discovery outcomes  ── the only genuinely hard part
```

Nothing in Track B can be validated without A2 (deploy), and nothing in the agreement flow can
be validated without A1. Start both on day one.

---

## 2. Track A — long lead time, start immediately

### A1. Submit the WATI templates (0.5 day of work, then wait)

Blocks 5 of the 9 flows. `WhatsApp_Templates_UTILITY_Submission_Pack.docx` already exists in the
repo root — the drafting work is done, the submission apparently never happened.

- Submit the 26 templates. Per the earlier analysis, 3 cannot go as UTILITY (lead re-engagement
  → MARKETING) and `AGREEMENT_OTP` must go as **AUTHENTICATION**, which is a different template
  category with its own fixed-format rules. Getting the category wrong is the usual cause of a
  rejection round-trip, so it is worth being deliberate here.
- Prioritise the four the revenue loop actually needs, so a partial approval still unblocks:
  `AGREEMENT_OTP`, `AGREEMENT_SEND`, `AGREEMENT_COPY`, `DISCO_REMINDER`.
- On approval: run **WhatsApp → Refresh templates** (`refreshWatiTemplates()`,
  `whatsapp-actions.ts:246`) then map each kind in WhatsApp → Settings.
- Fix the `EMI_PRE_DUE` → `emi_due_soon` dangling mapping while you're there.

**Acceptance:** one real `AGREEMENT_OTP` reaches a phone. Until this passes no student can sign,
because signing requires the OTP.

### A2. Deploy and rotate (1.5 days)

`docker-compose.prod.yml` was verified working on 17 Jul and migrations were moved out of the
build. This is an ops task.

- Provision the VPS, point a hostname at Caddy, `BETTER_AUTH_URL` off localhost
- Rotate the Supabase password — still the original, still on a laptop next to
  `.migration/data.sql`. Re-point at the **pooler**, `%40`-encode the password.
- Delete the dump.
- Confirm the cron sidecar ticks all six routes.

**Gate A:** signed in from a second device; `docker compose logs cron` shows six routes ticking.

---

## 3. Track B — the code, ~3.75 days

Ordered by how much each unblocks, not by size.

### B1. Give `slotPatternConfig` a writer (1 day) — unblocks the whole funnel

The engine is built, safe, idempotent and hourly. It just has no way to be turned on.

- Add a **Standing availability** panel to the Console, following the shape of the existing
  panels in `src/app/(app)/console/_components/` — `OperationsPanel.tsx` is the closest model.
- Fields map 1:1 to `SlotPatternConfig` (`config-schema.ts:353`): `enabled`, `weekdays`,
  `startTime`, `endTime`, `intervalMins`, `durationMins`, `horizonDays`, `assignedToId`.
- Server action writes `SLOT_PATTERN_KEY` via the same `AppSetting` upsert every other panel
  uses, and calls `logActivity`.
- Do the same for `SssSlot` — 0 rows ever means the sales-call layer has no calendar at all.
- Save a real pattern. Verify `/book` fills within the hour.

> Worth a moment's thought: this is the second config in this codebase to ship read-only. A
> cheap guard is a boot-time or health-check assertion that every `*_KEY` in `founder-config.ts`
> has at least one writer — it would have caught this at build time.

### B2. Fix the ledger period asymmetry (1 day) — the only real bug

`voidEntry` (`ledger-core.ts:192`) dates the reversal `opts.on` (today) while the restated entry
keeps the original's date. The all-time trial balance is correct — it sums VOID lines by design —
but any **period-scoped** read double-counts the original in its own month and shows a phantom
negative in the current one. There is 1 VOID entry live against 83 journal entries, so June is
overstated and July understated right now.

The docstring argues the current behaviour is deliberate (don't restate a closed month). That
argument is right for a *locked* period and wrong for an open one. Split it:

- Period open → date the reversal to the **original entry's date**
- Period locked → keep today's date **and** date the restatement to today. Never split a
  correction across two periods.
- `voidEntry` writes via `journalEntry.create` directly, bypassing the `periodLock` check that
  `postEntry` enforces at `ledger-core.ts:123`. Route it through the same guard — right now it
  can write into a locked month.

### B3. Backfill the 3 orphaned bookings (0.5 day)

All 3 `BookingRequest` rows still have `leadId = null` despite BANT scores of 4/3/4. They predate
the link fix, so the BANT→Qualified metric has nothing correct in it.

- One-shot script replaying the linking + qualification path from `booking-actions.ts:331`
  (`qualifiedFromBant`, `OutreachJourney.qualified`) over the existing rows.
- Match on phone/email. Three rows — verify each by hand rather than trusting the match.

### B4. Resume download ownership check (0.25 day)

`api/resume/[id]/download/route.ts:24-32` checks section access but never record ownership, and
CV Studio is granted to `STUDENT` by default — so any student can pull any other student's CV by
guessing an id. `api/agreements/[id]/pdf/route.ts:56-63` already does this correctly; copy that
`owns` pattern verbatim.

### B5. Money-layer integration tests (1.5 days) — do this with B2, not after

`prisma/verify-ledger.ts` is a good adversarial suite that asserts the trial balance *balances* —
and a mis-dated reversal balances perfectly. **Balance is not correctness**, which is exactly why
B2 survived. The 484 unit tests never reach `ledger-core.ts` because `src/server/` is
`server-only` and can't be `tsx`-tested.

- Integration suite against a throwaway Postgres (`scripts/local-db.mjs` already exists) covering
  post → edit → void → **period-scoped** P&L, asserting monthly figures rather than totals.
- Write the failing test for B2 first. It should fail before the fix and pass after.

**Gate B:** `/book` shows 21 days of slots · ledger monthly P&L matches Finance to the paise ·
3 bookings linked · integration suite green in CI.

---

## 4. Track C — adoption (weeks 2–3)

Four of the nine flows are dead for one reason: nobody uses the app. 23,435 leads and 0
`contactedAt`; 0 `CallLog`; 1 `DiscoveryOutcome`; 4 sessions in the last 7 days, 68 of 81 ever
belonging to Ameen. No amount of engineering moves these.

- Sit with Nilofer and Asma on a real day's list, not a demo. Ship a fix the same day. Two weeks
  of daily 30-minute iterations beats one redesign.
- **Give them ~50 leads a day, not 23,435.** 12,904 are `NEW_LEAD` and 8,095 are already `LOST`;
  that is a graveyard, not a work queue. Define the slice by recency or `leadSource` first.
- Make `contactedAt` a **side effect** of logging a call, never a separate action. It is the
  field that makes the whole funnel measurable and it is null on every row.
- Field-test the offline call capture on day one — the telecallers work from phones with patchy
  signal, and its migration is still marked LOCAL-ONLY. It needs production sign-off before it
  can be relied on.
- `My Desk` reads from `CallLog`, so it renders empty today. Check its empty state doesn't read
  as "broken" on first contact with a new user.

**Cash freshness** belongs here too and needs no code: `cashStale` already fires at
`cash-metrics.ts:68` and already surfaces at `notifications.ts:518` and on `/cash`. The position
is 23 days old because nobody enters it. It is a habit, not a defect.

**Gate C:** ≥500 leads with `contactedAt`, ≥200 call logs, ≥30 discovery outcomes, two non-admin
users active 4 of 5 working days. **If this gate fails, do not proceed — repeat it.**

---

## 5. Effort and honest risk

| Track | Work | Calendar |
|---|---|---|
| A1 templates | 0.5 day | + 1–5 days Meta approval, not in your control |
| A2 deploy | 1.5 days | day 1–2 |
| B1–B5 code | 3.75 days | day 2–5, parallel with the Meta wait |
| C adoption | ~0 engineering | 2 weeks, and it may need repeating |

**Engineering is 5.25 days. Everything else is waiting and habit-forming.**

The risk worth naming: of the 9 broken flows, only **one** (B2) is a bug in the code. Four are
adoption, two are external approval, one is a missing writer, one is a stale backfill. A week of
engineering makes every flow *capable* of working; whether they *do* work is decided in Track C,
which is not an engineering question. If Track C fails twice, narrow it — one person, one screen,
one metric — rather than building more.

---

## 7. What was actually built (29 Jul), and what it changed

Three things turned out differently once the code was opened. All three are worth carrying
forward, because in each case the audit's diagnosis was reasonable and wrong.

### 7.1 The three "orphaned bookings" are demo fixtures

B3 assumed 3 real prospects had lost their lead link. They are seeded rows from
`prisma/demo-data.ts`: `@example.com` addresses, sequential phone numbers ending 44201/2/3, two
created in the same millisecond, and — contrary to the audit's "BANT scores of 4, 3, 4" —
`bantAvg` is **null** on all three. No matching lead exists for any of them.

So there was nothing legitimate to backfill, and linking them would have meant inventing three
people and feeding fiction into the BANT→Qualified metric. What shipped instead is
`prisma/backfill-booking-links.ts` (`npm run db:link-bookings`): dry-run by default, matches on
the same normalised-phone rule `upsertIntakeLead` dedupes on, **never creates a Lead**, and
reports demo rows separately rather than touching them. It is ready for the first real orphan.

**Open question for you:** those 3 demo bookings are in the production database and every booking
metric counts them. Deleting them is destructive and outward-facing, so the script won't. Say the
word and it's a one-liner.

### 7.2 My Desk is empty because nobody owns any leads — not because CallLog is empty

The audit read the empty desk as a consequence of zero call logs. The real cause is upstream:
**23,430 of 23,435 leads have no `assignedToId`**, and the L1 desk scopes its queue to the
signed-in owner. Nilofer's desk holds 3 leads; Asma's holds 2. Logging calls all day would not
have changed that.

Everything downstream was already right, which is why this hid so well: the desk branches
correctly on `logVariant`, the queue is bounded (backlog capped at 200, ordered oldest-first),
and — C1's whole item — **`contactedAt` is already stamped as a side effect of logging a SPOKE
call**, in the same transaction, first-only, on both the online and offline paths. C1 needed no
code at all.

What was missing was any way to hand work out. `assignLead` is one lead per click and
`pickFirstCaller`'s rotation only fires on new intake — neither touches an imported backlog. So:

- `assignLeadBatch()` (`pipeline-actions.ts`) — hand N unassigned, *callable* leads to one
  person. Newest-first by default; server-capped at 200 per hand-out, deliberately, because a
  queue that can't be finished is a graveyard. Re-asserts `assignedToId: null` in the write so two
  admins can't hand out the same lead.
- **Pipeline → Leads → Hand out leads** — the UI, above the table rather than beside a row.
- My Desk now distinguishes *"you worked everything"* from *"you were given nothing"*. The old
  empty state congratulated a caller holding three leads.

### 7.3 The ledger defect was real, and the test proves it

`voidEntry` now dates the reversal to the original's date while that period is open, and moves
the whole correction to the current period when it is locked — never splitting one across two.
It also routes through the same `periodLock` guard `postEntry` uses, which it previously bypassed.

The suite in `src/server/__tests__/ledger-period.integration.test.ts` was checked both ways:
**3 of 6 fail against the old behaviour, 6 of 6 pass with the fix.** It skips cleanly when
`LEDGER_TEST_DATABASE_URL` is unset, so `npm test` stays green without a database:

```
npm run db:local
LEDGER_TEST_DATABASE_URL="postgresql://b2:b2@localhost:5435/b2_dashboard?schema=public" npm test
```

`getPeriodMovements()` shipped alongside it — the period-scoped read the assertions needed, and
the first step of §8.2's ledger-backed P&L.

### 7.4 Everything else that shipped

| | |
|---|---|
| **B1** | Console → **Availability**: the writer `slotPatternConfig` never had. Live preview of how many slots a pattern yields, so a pattern that fits nothing is visible before saving. Plus `sssPatternConfig` + `ensureSssSlots()` on the hourly cron for the SSS diary. The preview shares `slotsPerRunningDay()` with the real generator — one copy, pinned in `slot-plan.test.ts`. |
| **B4** | Wider than planned. `listResumes`/`getResume` had no ownership filter either, so scoping only the download would have left the same data reachable. `resumeScope()` now gates list, get, render, update, delete, duplicate and review — as a required argument, so a new call site can't compile without deciding. |

**Verified:** typecheck clean · 500/501 tests pass (1 skipped by design) · lint clean on every
touched file · production build exit 0 · backfill dry-run executed against live data.

---

## 8. Explicitly not in this plan

- Anything in Automation — overlaps the Outreach SOP; decide which survives before touching either
- Arming the remaining engines — that is Phase 3 of `ROAD_TO_10.md` and it comes after adoption,
  not before. An engine armed against an empty funnel does nothing observable.
- The other ~190 unbounded `findMany` calls — only the ~15 on growth tables matter
- Payment gateway capture — 27 income rows over 5 months is survivable for now; revisit after
  Gate C
