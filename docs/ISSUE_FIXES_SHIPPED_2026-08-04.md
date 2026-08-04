# What shipped — 4 Aug 2026

Implementation record for [ISSUE_TRIAGE_2026-08-04.md](./ISSUE_TRIAGE_2026-08-04.md). All 20
reported issues plus 6 further defects found during triage.

**Verification:** `tsc --noEmit` clean · **870/870 tests pass** · production build clean (89
routes) · lint clean on every touched file · browser-walked against a local Postgres.

---

## The twenty reported issues

| # | Issue | What shipped |
|---|---|---|
| 1 | Arena not neatly organised | Two-column fold (my card + leaderboard), **one** period control driving the whole page, badge picker moved to `Tabs`, admin quest bars replaced by `QuestCard compact`, "How XP works" collapsed to a disclosure, per-section empty states |
| 2 | 90/120-day tracker Google Form | **In-app replacement** — Students → "Weekly update": every tracked student on one screen, only touched rows save, partial failures named. Loops the audited `updateTracker`, so milestone + signal history still fire |
| 3 | Remove Founder/Admin from signup | Removed from the picker **and** narrowed `submitAccessRequest`'s enum (the UI alone was cosmetic — a crafted POST bypassed it) |
| 4 | Tutor + student login | `/portal` and `/tutor` render the same `LoginForm` with their own copy; Tutor & Student added to the signup picker; `?next=` honoured with an open-redirect guard; both added to the middleware's public list |
| 5 | Whitespace in login credentials | New `lib/credentials.ts` — strips NBSP/zero-width, trims, lower-cases email. Applied at sign-in, forgot-password, reset, invite accept, change-password **and admin set-password** (the source of the problem) |
| 6 | Per-telecaller commission toggles | 3 new capability keys + eligibility enforced in `getCommissionReport`; new **Console → Access → Per-person rules** matrix. An ineligible leg is shown struck-through with a reason, never silently zeroed |
| 7 | Show duplicate users | **People → Duplicates** — phone / email / name-and-city rules in SQL, with call·booking·deal counts and a "Most history" hint. Merge re-points all 17 child tables and soft-archives the loser |
| 8 | Sheet → API | `intakeRoute()` factory (fail-closed, rate-limited, retry-able, delivery-stamped) + `POST /api/intake/lead` for direct landing-page capture. Additive — Pabbly keeps working |
| 9 | Log outcome missing on Asma's desk | `LogOutcomeModal` extracted and wired into L2Desk's lead rows with the offline queue. **Browser-verified: logged a call as Asma, row written to `CallLog`** |
| 10 | Email using Resend | Code was complete and disarmed. Surfaced in the new "Not armed" panel with the exact three steps — see *Founder actions* below |
| 11 | Week/month filters + download | New `lib/period.ts` (14 tests) + `<PeriodBar>`, adopted on Finance, Pipeline, Payments, Contacts. New streaming CSV export API that re-runs the **screen's own filter** server-side, audited and row-capped |
| 12 | Standard dashboards | 9 hand-rolled headers converted; `PageHeader` gained `back`/`titleSuffix`; **regression test** asserts every page uses a shared header |
| 13 | New leads not in Opportunities | `ensureDefaultOpportunity` wired into every capture and manual path, behind a founder switch defaulting **on**. Backfill script ready — **15,451 leads waiting** |
| 14 | Booking section broken | Dark-mode tokens (was hardcoded `white`), `resolveBant` everywhere, parallel fetch, and an empty state that **names the cause** — no availability pattern configured |
| 15 | Opportunities search + auto-move | Server-side search/owner/status filters; the "use a filter" message now points at a real one; `pipelineConfig.mode` finally honoured on this board; new "How cards move" panel listing the 7 rules that were always enforced and never visible |
| 16 | Bookings tab | Restructured, not deleted: "Booking requests" renamed, Availability moved to a "Manage availability" action beside the calendar → **two tabs, not three** |
| 17 | Find breaks & logic errors | 6 further defects — see below |
| 18 | Minimise Sales tab | Sales is **3 entries** (was 5). New `offRail` flag drops a section from the sidebar **without** blocking its route; Opportunities & Outreach surface as links on Pipeline |
| 19 | Clock in the navbar | `<NavClock>` — 🇮🇳 14:02 · 🇩🇪 10:32, shared hook with the profile card, cross-tab synced. **Browser-verified** |
| 20 | BANT from Pabbly invisible | **Two fixes.** Evidence is now persisted even when *nothing* maps (the reason the diagnosis was impossible), plus a 7-day coverage alert; and a full Qualification card on the contact record showing score, origin, B/A/N/T and the stored answers |

## Further defects found and fixed

| | Defect | Fix |
|---|---|---|
| E2 | Email-matched dedupe reported as `"phone"` | Own `"email"` value |
| E3 | `findDuplicateLead` called with phone only from Pipeline | Passes email too; Pipeline's lead form gained an email field |
| E4 | Email dedupe gated on `!phone` — a returning lead on a **new number** was never matched | Email is now a second identity, not a fallback |
| E5 | Unmapped columns on the default pipeline are a one-way door | `addStage` refuses them; existing ones carry an "Unmapped" warning chip |
| E7 | Board told you to "filter" with no filter | Message rewritten against the real control |
| E9 | Built-but-off features indistinguishable from broken ones | **Console → System → Not armed** — 12 features, each with its consequence and exact fix |

---

## Founder actions still required

Code cannot do these — they are configuration and credentials.

1. **Arm email** — verify the domain in Resend, set `RESEND_API_KEY` + `EMAIL_ENABLED="true"`,
   save a From address at Conversations → Settings. *Unblocks password resets, invoices, dunning,
   digests and the opt-in alert.*
2. **Configure availability** — Console → Sales ops → Availability. *Live has 0 slots and 0
   bookings; this is the single cause behind "the booking section feels broken" and both empty
   specialist desks.*
3. **Capture one real Pabbly payload** — set `LEAD_WEBHOOK_DEBUG="true"`, submit the landing-page
   form once, read the field names, **turn it back off** (it logs PII). The new evidence
   persistence means Console → Qualification will now show the unmapped fields either way.
4. **Run the opportunity backfill** — `npm run backfill:opps -- --dry-run` first. It reports
   **15,451** open-stage leads with no card. Not run automatically: it creates 15k rows on the
   live board and that is your call.
5. **Set `INTAKE_WEBHOOK_SECRET`** if you want the direct capture endpoint.
6. **Map or delete the unmapped "Aakash" column** on the default Sales pipeline — a card dropped
   there stops syncing to the lead's stage.

## Notes

- **Nothing was run against production.** The browser walkthrough used a local Postgres on
  `:5435`; `.env` was temporarily repointed and restored byte-identical (verified with `git diff`).
- Three files still fail lint (`WorkflowDryRun.tsx`, `BookingForm.tsx`, `form.tsx`) — all
  pre-existing and untouched by this work.
- The `commission.*` capabilities default to granted, so **no one's pay changes** until the
  founder revokes something.
