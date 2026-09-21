# Fix status - 21/09/2026 00:20 IST

Build: `next build` clean (type check included). Unit suite green (1091 pass / 1 skip, +21 new tests).
Repo: 18 files modified + 1 new test file. NOTHING staged, committed or deployed.

| Bug | Sev | Fix | Verified |
|---|---|---|---|
| FIN-02 wrong saved date | High | Default date follows the user's local day, capped at the IST books day; picker and default share one source | e2e PASS (23:00 Berlin) |
| FIN-05 partial payment has no next due date | High | Quick Record > Income now renders the same InstalmentSchedule block as the Finance page | e2e PASS |
| ACC-01 "Inactive" leaves login open (Nilofer) | Critical | People status Inactive now suspends the login + deletes sessions in one transaction; On leave unchanged | e2e PASS |
| ACC-03 Reactivate reopens login after offboard | High | Reactivate restores login AND profile together | e2e PASS |
| ACC-17 Suspend left profile active | Low | Suspend now marks an ACTIVE profile inactive | e2e PASS |
| OUT-01 confirmed call still chased, then written off | Critical | markSopDiscoConfirmed: one writer for every confirmation path; sweep also spares booking.confirmedAt | e2e PASS (+ control run proves the sweep still fires when unconfirmed) |
| DSC-03 unconfirmed SSS never cancelled | Critical | SSS_CANCEL now executed like DISCO_CANCEL: slot re-opened, journey CANCELLED, lead moved | e2e PASS (DB evidence) |
| DSC-01 qualified call never starts SSS ladder | Critical | Route "Ready - route to Level 3" sets highlyQualified + optional SSS time; desk got an SSS datetime field | NOT YET VERIFIED - spec only runs in IST daytime (skips within 60 min of midnight; at 00:12 the seeded call is not on the desk). Re-run in IST working hours. Note: the spec also wants a "Highly Qualified" control on /outreach, which the fix deliberately does not add. |

## Known-open, deliberately not fixed this round
- FIN-06/07/08: a payment does not settle its instalment, so Next due / EMI counter never advance, a zero balance never reads "Paid in full", and the dunning ladder can still chase a student who has paid. Needs product decisions (which plan a payment belongs to; what if the amount differs).
- ACC-04: 5 API routes call auth.api.getSession directly and never re-check User.status.
- DSC-04/05/06/07/19/20, OUT-04/09/10/11/12/13/14/15/18/19/20/21/22, PPL-01..16, FIN-01/03/04/09..18.
- NEW (found during fix verification): the app links a booking to a lead BY EMAIL and will attach a booking that belongs to a different live lead. Two people sharing an inbox is enough. Root: findBookingForLead (status <> CANCELLED, newest first).

## Test-harness fixes made while verifying (my specs, not app code)
- finance/02-dates: poll for the browser-corrected default (server paints IST date, browser corrects ~120 ms later).
- outreach/06: poll for the lead stage (confirmedAt lands ~106 ms before the stage move); removed the two OUT-01 test.fail annotations now that the fix works.
- Local DB: cancelled 8 stale fenced bookings (2 orphaned NO_SHOW + 6 discovery fixtures) that made the outreach chase think the lead had already booked.

---
# Update 21/09/2026 ~21:45 IST

## Committed to local master (NOT pushed, NOT deployed)
- aa9a1da Close the login when a team member is marked Inactive (ACC-01/03/17)
- 3d655b8 Fix the default finance date for Germany and ask for instalment due dates (FIN-02/05)
- 4f6b14a Stop chasing confirmed calls and run the SSS confirmation ladder (OUT-01, DSC-01, DSC-03)
- c8220e6 Settle instalments when a payment is recorded (FIN-06/07/08) - e2e PASS for all three

## Production run (b2app.sirahagents.com, running the OLD code - nothing deployed)
| Phase | Result |
|---|---|
| Suspend Nilofer | Done, verified Suspended; sessions deleted |
| Provision 6 E2E accounts (support+e2e-*@sirahdigital.in) | PASS |
| Read-only: role matrix, UI rules, public surfaces, discovery desk | 14 pass, 4 fail - all known (ACC-05, ACC-13, ACC-14, ACC-07 export buttons). Role x route matrix: 0 mismatches |
| Real opt-in via /f/free-consultation as Mohamed Riyaz | Submitted 20:54 IST, counter 42 -> 43. NEW FINDING PROD-01 below |
| Finance entry/CSV/validation | 22 pass, 2 fail (FIN-14 known). 19 records created |
| FIN-02 Berlin date (saves nothing) | FAIL in prod - confirms the founder's bug is live (fix not deployed) |
| Finance cleanup | PASS; verified 0 E2E rows in Income, Expenses, Pending, Cash Health |
| Deprovision E2E accounts | PASS; none can sign in. Retired team profiles + activity log entries remain by design |

## New findings
- PROD-01 (High): a repeat opt-in from someone who is already an open lead is silently absorbed. Riyaz's number was already a lead since 27/08 (stage Whatsapp Sent). The public form accepted the submission (counter +1) but the lead got no timeline entry, no team alert, no intro message, and name/email were not updated. A hot prospect raising their hand again goes unnoticed.
- PROD-02 (High, operational): suspending Nilofer left her open leads owned by a login that can no longer work them (e.g. Riyaz's lead). Suspend does not reassign; Offboard (with successor) does. Her leads need reassigning in production.
- BOOK-01 (Medium): findBookingForLead matches bookings by email and will attach a booking that belongs to a different live lead.
- FIN-19 (Low): the notification bell counted 11 overdue payments while the Pending tab showed 12 Overdue rows, all with positive balances and past due dates, and both use the same rule. Not caused by the fixes. Needs a look.

## Still open from the settlement fix (by design, needs a product decision)
- Two part-payments that together cover an instalment are never auto-settled (no partly-paid state). Suggested: settle against the running total of payments on the plan.
- Incomes recorded before this fix have no settlement record, so editing/archiving them never touches a schedule.
