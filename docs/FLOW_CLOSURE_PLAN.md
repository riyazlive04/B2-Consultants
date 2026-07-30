# Closing all 9 flows — the execution plan

**Compiled:** 29 July 2026 · follows `FIX_PLAN_BROKEN_FLOWS.md`, which covered *what to build*
**This document covers what remains**, which is almost none of it code.

---

## 0. Where this stands

Tracks B and C are built, tested and browser-verified. That moved every flow from *broken* to
*capable* — and moved exactly **zero** of them to *working*, because the app is not deployed and
nobody is using it.

| | Flows | Status |
|---|---|---|
| Needed code | 6 | **done** — shipped 29 Jul |
| Needed a production data repair | 2 | **done** — 29 Jul, see §5 |
| Needs deployment | 7 | blocked on one VPS afternoon |
| Needs Meta approval | 2 | ⏸ **parked 29 Jul at your request** |
| Needs a human to use it | 4 | blocked on Track C |

With WATI parked, **deployment is the sole critical path**. An engine armed on a laptop is not
armed, and every remaining flow except 5 and 6 clears within an hour of go-live.

---

## 1. The critical path

```
NOW ─┬─ A1 Submit WATI templates ──► Meta review (1–5 days, not yours) ──┐
     │                                                                   │
     └─ A2 Deploy + rotate ──┬─ D1 Save the 4 configs ──► /book fills    │
                             │                                           │
                             ├─ D2 Hand out 50 leads ──► desks populate  │
                             │                                           ▼
                             └─ D3 Enter a cash position    E1 Map templates ──► OTP works
                                                                                 ──► agreements close
                             ▼
                    Week 1–2: C — two people, one real day, every day
                                                    │
                                                    ▼
                                            Months 1–3: ledger reconciliation
```

**A1 and A2 both start today.** A1 is half a day of work followed by a wait you do not control,
so starting it late costs a week at the end. A2 unblocks everything else.

---

## 2. Flow-by-flow closure

Each row gives the gate as something you can actually run, not a judgement call.

### Flow 1 — Lead → first contact

- **State:** 0 of 23,435 leads have `contactedAt`; 0 `CallLog` rows.
- **Remaining:** nothing to build. `contactedAt` is already stamped by logging a SPOKE call, and
  the hand-out now exists. This is Track C — someone has to make calls.
- **Do:** after deploy, Pipeline → Leads → **Hand out leads**, 50 to Nilofer, newest first. Repeat
  each morning it empties.
- **Gate:** `≥500 leads with contactedAt` and `≥200 CallLog rows`.

### Flow 2 — Book a discovery call

- **State:** fix built and verified; `/book` fills within an hour of saving a pattern.
- **Remaining:** save the pattern **on production**. Console → Availability → pick weekdays →
  switch on → Save. The preview tells you how many slots it will make before you commit.
- **Gate:** `SELECT count(*) FROM appointment_slot WHERE status='OPEN' AND "startsAt" > now()` is
  never below 14 days' worth. Load `/book` in a private window and see bookable times.

### Flow 3 — Discovery outcomes recorded

- **State:** 1 row, total.
- **Remaining:** Track C. Follows Flow 1 automatically — an outcome is recorded after a call, and
  there have been no calls.
- **Gate:** ≥1 `DiscoveryOutcome` per completed call, ≥30 total.

### Flow 4 — SSS (sales) calendar

- **State:** 0 rows ever. `ensureSssSlots()` now exists and runs hourly.
- **Remaining:** confirm the SSS owner in Bookings → SSS, then Console → Availability → the
  *Sales calls* section → switch on. It refuses to arm without an owner, deliberately.
- **Gate:** `SELECT count(*) FROM sss_slot WHERE status='OPEN' AND "startsAt" > now()` > 0.

### Flow 5 — Agreement signing · ⏸ PARKED (WATI deferred)

- **State:** signing needs an `AGREEMENT_OTP` WhatsApp; the template does not exist in WATI.
- **Remaining:** blocked on §3, which is **parked at your request (29 Jul)**. Nothing else can
  close this flow — the OTP is the only route to a signature, so agreements stay unclosable in-app
  until WATI is picked back up.
- **Gate:** one real OTP reaches a real phone, and one agreement reaches `SIGNED` through the app.

### Flow 6 — WhatsApp delivery · ⏸ PARKED (WATI deferred)

- **State:** 59 approved templates, **none transactional**. 1 of 27 kinds validly mapped.
- **Remaining:** blocked on §3. When resumed: map each kind in WhatsApp → Settings, and fix
  `EMI_PRE_DUE`, which points at `emi_due_soon` — a template not in the catalogue at all.
- **Gate:** 0 messages in the last 7 days with status `SKIPPED` and reason
  `No WATI template configured`.

### Flow 7 — Booking → Lead link

- **State:** the live path links synchronously; the only 3 orphans are demo fixtures.
- **Remaining:** a decision on the demo rows (§5), then `npm run db:link-bookings` after go-live
  to confirm the number stays at zero.
- **Gate:** `SELECT count(*) FROM booking_request WHERE "leadId" IS NULL` = 0.

### Flow 8 — Ledger period-scoped P&L

- **State:** fixed and covered by an integration suite that fails without the fix.
- **Remaining:** deploy, then reconcile. The one existing VOID entry misdated under the old code
  is still misdated — the fix corrects future voids, it does not rewrite history (the ledger is
  append-only by design). Re-void and re-post that one entry after go-live to correct June/July.
- **Gate:** ledger monthly P&L equals Finance monthly P&L to the paise, three months running.

### Flow 9 — Cash truth

- **State:** 23 days stale. No code needed — `cashStale` already fires and already surfaces.
- **Remaining:** enter a current `CashPosition`, then keep to a weekly habit. The app already
  nags when it drifts past 7 days.
- **Gate:** latest `CashPosition.date` never older than 7 days.

---

## 3. A1 — Submit the WATI templates · ⏸ PARKED 29 Jul at your request

Kept here in full because it is unchanged when you pick it up, and because two flows (5 and 6)
cannot close without it. **Deploy is now the sole critical path.**

Half a day of work, then a wait. It gates flows 5 and 6 outright, and it is the only item here
whose duration is not yours to control.

1. Open `WhatsApp_Templates_UTILITY_Submission_Pack.docx` (repo root). The bodies are written.
2. **Submit these four first** so a partial approval still unblocks revenue:
   `AGREEMENT_OTP` · `AGREEMENT_SEND` · `AGREEMENT_COPY` · `DISCO_REMINDER`
3. **Categories matter more than anything else here.** Since April 2025 Meta classifies by
   content, re-categorises promotional copy regardless of the declared label, and flags accounts
   that game it. Three cannot honestly be UTILITY (the lead re-engagement ones — they go
   MARKETING), and `AGREEMENT_OTP` must go as **AUTHENTICATION**, which has its own fixed format.
   Getting a category wrong costs a full review round-trip.
4. On approval: WhatsApp → **Refresh templates**, then map each kind in WhatsApp → Settings.
5. Send one real `AGREEMENT_OTP` to your own phone before telling anyone it works.

---

## 4. A2 — Deploy (start today, ~1.5 days)

`docs/DEPLOYMENT.md` is the runbook and it is complete — follow it rather than this summary. The
stack was verified working on 17 Jul and migrations were moved out of the build, which was the
old P1001 blocker. Points worth repeating because they bite:

- **Rotate the Supabase password.** It is still the original and currently sits in a `.env` on a
  laptop next to `.migration/data.sql`. Rotate it, delete the dump, and re-point at the **pooler**
  with the password `%40`-encoded — the direct `db.<ref>` host is IPv6-only and will not resolve.
- **`BETTER_AUTH_URL` must be the real origin.** Left on localhost, four separate `betterAuth()`
  instances fall back and sign-in breaks in ways that look like a database problem.
- **`CRON_SECRET` must be ≥16 chars.** Without it all six cron routes answer 503 and every engine
  in the app silently does nothing — including the two slot top-ups you just enabled.
- Env is validated at boot, so a mistake refuses to start with a specific message rather than
  failing quietly at 3am.

**Verify before moving on:**

```bash
docker compose -f docker-compose.prod.yml logs cron    # six routes ticking
curl -fsS -H "x-cron-secret: $CRON_SECRET" https://<host>/api/cron/daily | jq .run.jobs
```

That last command is the single best smoke test in the app — it returns the live status of every
engine at once. `bookingSlotTopUp` should read `{"ran": true, ...}` once §2 Flow 2 is done.

### D1–D3 — the first hour after deploy

Four configs have **never been saved on production**. `AppSetting` holds 6 rows and not one is a
section or engine config, which is why ~40% of the engineering delivers nothing today.

| # | Where | Why it matters |
|---|---|---|
| D1a | Console → **Availability** → discovery calls | `/book` starts filling within the hour |
| D1b | Console → **Availability** → sales calls | first SSS slots ever created |
| D1c | Bookings → rules (buffer / notice / max advance) | the defaults are code, not your decisions |
| D1d | Console → **Sections** | switch off the duplicate surfaces (see `ROAD_TO_10.md` §7) |
| D2 | Pipeline → Leads → **Hand out leads** | 50 to Nilofer, newest first — desks are empty until this |
| D3 | Cash → add this week's position | clears the 23-day staleness and the home-page warning |

---

## 5. Both decisions — DONE 29 Jul, on production

### 5.1 Demo bookings and slots — purged

`npx tsx prisma/purge-demo-bookings.ts` (dry-run by default). It turned out that **every**
`BookingRequest` (3) and **every** `AppointmentSlot` (15) in production was fixture data from one
`demo-data.ts` run — all sharing a creation window, all in the past, nothing referencing them.
Deleted as a unit: leaving the slots would have stranded two in `BOOKED` claimed by nothing.

**Production now holds 0 bookings and 0 slots** — an honest zero rather than a fictional three.
The calendar refills the moment §2 Flow 2 is done on a deployed instance.

Still present and deliberately untouched: **4 demo leads and 18 demo students** (against 1 real
student). Students carry enrolments and payments, so removing them moves financial figures — that
wants its own look, not a ride-along with a booking cleanup. See §5.3.

### 5.2 The misdated VOID entry — corrected

`npx tsx prisma/fix-misdated-void.ts` — classifies every voided entry, corrects only ids you name.

The repair is a **correcting pair**, not an edit: `journal_entry` and `journal_line` refuse UPDATE
and DELETE by trigger, which is the point of a ledger. So it posts a mirror in the original's month
and an un-mirror in the reversal's month. Both are individually balanced and exact opposites, so
the all-time trial balance is untouched while both months become right.

| | Before | After |
|---|---|---|
| June 2026 German Note income | ₹1,08,000 | **₹63,000** |
| July 2026 German Note income | **−₹23,000** | **₹22,000** |
| Trial balance | balanced | balanced |
| Audit hash chain | verifies | verifies (4 entries) |

July was showing *negative* income. Rehearsed on a local reproduction of the exact production
shape first — the numbers moved by exactly ±₹45,000 as predicted, and a second run was a no-op.

**The rehearsal caught a flaw worth keeping in mind:** a cross-month reversal is not always the
bug. When the original's period is LOCKED, the fixed `voidEntry` deliberately puts both halves in
the current period, and "correcting" that would swing the books the other way. The script now
classifies `SPLIT` (the defect) vs `CONSOLIDATED` (correct) by where the restatement sits, and
will only ever write to entry ids a human has named.

### 5.3 Still open — the 18 demo students

18 of the 19 students in production are `@example.com` fixtures. Every student count, LTV figure
and cohort number on the dashboard is ~95% fiction. This is the same issue the error log filed as
`I3`. It needs its own pass because those students may carry `Income` rows, and deleting them
would change reported revenue — say the word and I will survey exactly what hangs off them before
proposing anything.

---

## 6. Sequence and honest risk

| When | What | Whose |
|---|---|---|
| Day 1 | A1 submit templates · A2 provision + deploy | yours (I can script anything that isn't credentials) |
| Day 2 | Rotate secrets, verify cron, D1–D3 | yours, ~1 hour once deployed |
| Day 3–5 | Meta review lands → map templates → OTP end to end | yours |
| Week 1–2 | **Track C** — sit with Nilofer and Asma on a real day's list | yours, and the hard part |
| Month 1–3 | Ledger vs Finance reconciliation, three months clean | mine, once there is data |

**The only real risk is Track C**, and it is not an engineering risk. Everything from deployment
onward has a known answer. Whether two telecallers adopt a new system for their daily work does
not, and it is the single thing standing between "capable" and "working".

Two rules that make it likelier:

- **Ship a fix the same day.** Two weeks of daily 30-minute iterations beats one big redesign.
  Every field they hesitate over: delete it or default it. Do not explain it.
- **50 leads a day, never the pile.** The hand-out caps at 200 for exactly this reason. If Track C
  stalls twice, narrow it further — one person, one screen, one metric — rather than building more.

---

## 7. What NOT to do next

Each of these is a plausible next move that would lower the score:

| Don't | Why |
|---|---|
| Arm the remaining engines before Track C | An engine armed against an empty funnel does nothing observable, and you lose the ability to tell which change caused what |
| Build anything in Automation | It overlaps the Outreach SOP; decide which survives first |
| Fix the other ~190 unbounded queries | Only the ~15 on growth tables matter, and latency mostly resolves once the VPS is colocated with Supabase |
| Add a 31st section | Every section built so far has moved the Live score by ~0 |
| Wire a payment gateway | 27 income rows over 5 months is survivable; revisit after Track C |
