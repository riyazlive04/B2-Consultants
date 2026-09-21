# Findings - Outreach L1 SOP + Pipeline (PRD1 §5) + Conversion Funnel (PRD3 §3)
Last full run (overloaded server, P1001/P2028 DB errors): 21 passed, 8 failed, 45 not run. Earlier per-file runs green for 01-05, 07; 06 B/C, 08, 09 never completed cleanly -> needs a solo re-run.

| ID | Sev | Finding | Root cause | Confirmed |
|---|---|---|---|---|
| OUT-01 | Critical | Confirming a disco call (Bookings page, or early WhatsApp YES) does NOT stop the confirmation ladder; 2h after slot the sweep marks confirmed booking NO_SHOW + lead LOST | outreach-engine.ts:410,600; booking-actions.ts:900; outreach.ts:546-552; wati/webhook/route.ts:119 | Code |
| OUT-02 | High | Returning opt-in: API says reopened, stage NEW_LEAD, but first cron tick re-IGNOREs journey; no intro, lead missing from queue | lead-intake.ts:316-321,234; outreach-engine.ts:632-634 | Test |
| OUT-07 | High | Nobody acts for 5h -> lead written off LOST with zero messages/calls | outreach-engine.ts:361-363; outreach.ts:366-368 | Test |
| OUT-12 | High | /book bookings not counted in Calls booked / show-up / no-show until confirmed | pipeline-metrics.ts:282 | Test |
| OUT-13 | High | BANT <2: prospect sees "You're booked in, confirmed" while server cancels + emails rejection | booking-actions.ts:370; BookingForm.tsx:79 | Code |
| OUT-04 | Med | Both Step 16 (12h) calls due at T-24h; discoConfirmCallLeadHours ignored | outreach-engine.ts:423,426 | Test |
| OUT-05 | Med | "Interested -> wait 2h" final check fixed at optin+5h (~1h after call) | outreach-engine.ts:361-363; outreach-sop.ts:864-869 | Test |
| OUT-06 | Med | >5 min branch: no booking check scheduled; engine skips Step 3 | outreach-engine.ts:246,273-279 | Test/Code |
| OUT-08 | Med | Not interested -> journey ends but lead stays WHATSAPP_SENT (open pipeline) | outreach-actions.ts:191 | Test |
| OUT-09 | Med | Step 12 can only be Skipped; blocks Step 13 + DISCO_CONFIRMATION | QueueList.tsx:200-208; outreach-engine.ts:625 | Test |
| OUT-10 | Med | After auto-cancel, lead stays "Discovery Call Booked" | outreach.ts:717; booking-actions.ts:430 | Test |
| OUT-15 | Med | Month metrics on L1 desk use createdAt not opt-in date | l1-desk-metrics.ts:284,295,324,341,354 | Code |
| OUT-18 | Med | Lead source "Landing page"/"Meta Lead Ad" rejected by pipeline edit | pipeline-actions.ts:47-50 | Code |
| OUT-19 | Med | Outcome "No show"/"Qualified for SSS" doesn't change lead stage or metrics | pipeline-actions.ts:538-575 | Code |
| OUT-22 | Med | Saved funnel week never picks up later pipeline changes | funnel-metrics.ts:44-76,117-137 | Code |
| OUT-29 | Low-Med | /book shows "Application error" when DB slow (P2028) | booking-actions.ts:397-472 | Observed |
| OUT-11 | Low | Red flag never set on cancellation | outreach.ts:497-517 | Test |
| OUT-14 | Low | BANT <2: Step 3 left DUE forever | booking-actions.ts:341-350 | Code |
| OUT-16 | Low | Step 3 text "this is B2 Consultants from B2 Consultants" | outreach.ts:613 | Test |
| OUT-17 | Low | Allowlist-blocked sends logged FAILED not SKIPPED | whatsapp.ts:310 | Test |
| OUT-20 | Low | Pipeline CSV dates YYYY-MM-DD | LeadSection.tsx:143 | Code |
| OUT-21 | Low | Funnel drop-off alert redesigned vs PRD wording; absent without history | funnel-metrics.ts:161-192 | Test |
| OUT-23 | Low | "CET" hardcoded (Sept is CEST) on Bookings + /book | BookingsTable.tsx:145 | Unconfirmed |
| OUT-24 | Low | Booking rate limit trusts first x-forwarded-for (bypassable unless proxy overwrites) | rate-limit.ts:163-167 | Code |
| OUT-25 | Low | SOP engine has no quiet hours | outreach.ts | Code |
| OUT-26 | Low | Funnel weeks use UTC midnight not IST | funnel-metrics.ts:44-60 | Code |
| OUT-27 | Low | Stage names differ from PRD + 7 extra | labels.ts:158-180 | Code |
| OUT-28 | Low | Manually entered lead never enters SOP queue | pipeline-actions.ts:91-176 | Code |

Divergences: extra Step 7b WhatsApp + 3rd check at +4h; engine adds 3b/6b emails; BANT exactly 2.0 = MAYBE continues.
Verified OK: +91 normalisation, webhook idempotency, owner rotation, Step3->4 order, booking stops chase, BANT thresholds, Zoom gate, T-36/24/12 offsets, both calls before cancel, YES on call stops ladder, cancel frees slot, nothing sent after end, archived lead restores, funnel formulas + GB tracker + Monday rule.
Local app_setting written: outreachConfig (enabled, autoSend for intro/followup/disco kinds, instantIntro) + watiConfig.templates e2e_fake_* bindings.
Prod: 01 only (Step 3 WhatsApp to the primary fenced number, welcome email, internal alert); 02/04/05/06 skip (hours-long); 03/07/08/09 must NOT run in prod; cleanup cancel may "promote next" and message another prospect.
