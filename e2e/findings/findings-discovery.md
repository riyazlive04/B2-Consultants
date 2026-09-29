# Findings - Discovery Specialist Level 2 SOP
Last full run (loaded server): 8 passed, 24 failed (22 = product defects via expect.soft "DSC-NN", 2 load-flaky).

| ID | Sev | Finding | Root cause | Confirmed |
|---|---|---|---|---|
| DSC-01 | Critical | Routing a call "Qualified / Level 3" never sets Highly Qualified or SSS time; SSS confirmation ladder unreachable from any screen | discovery-routing.ts:76-110; outreach-actions.ts:482 (no caller) | Test |
| DSC-03 | Critical | Unconfirmed SSS never cancelled: SSS_CANCEL step DUE forever, slot stays booked | outreach-engine.ts:512-514; outreach.ts:497-517 | Test |
| DSC-02 | High | Qualified call can close with no SSS booking; PRD form saves sssDate null | L2Desk.tsx:66-158; pipeline-actions.ts:505-518,561 | Test |
| DSC-04 | High | Rescheduling SSS doesn't re-anchor reminders; confirmed-then-moved SSS gets no reminders and YES ignored | outreach-engine.ts:227-229; sss-slots.ts:192-195 | Test |
| DSC-05 | High | 3h call "Answered YES" doesn't confirm SSS | outreach-actions.ts:178-189 | Test |
| DSC-07 | High | Manual "Mark sent" writes no WhatsApp row so reply YES can't link; webhook links to any lead's last outbound row; no manual confirm toggle | outreach.ts:818-851; wati/webhook/route.ts:146-167 | Test |
| DSC-08 | High | No-show chase: "Answered NO" treated as no answer; chase continues | outreach-engine.ts:478-491 | Test |
| DSC-12 | High | Routed calls skip DISCO_COMPLETED -> never counted as completed (show-up/close rate wrong) | call-outcome.ts:130-145; pipeline-metrics.ts:283 | Test |
| DSC-14 | High | Postponing a disco call keeps old T-36h reminder (fires 39h early, auto-sends in prod); confirmed flag kept | booking-actions.ts:831-887; outreach-engine.ts:227-229 | Test |
| DSC-22 | High | Cancel then rebook: journey stays on cancelled booking; new call gets no ladder | outreach.ts:203-205 | Test |
| DSC-24 | High | SOP engine ignores journeys with opt-in >30 days old -> SSS/no-show ladders never run for older leads | outreach.ts:318-323 | Code |
| DSC-06 | Med | WhatsApp YES confirms SSS but lead stays SSS_BOOKED | wati/webhook/route.ts:114-118 | Test |
| DSC-09 | Med | 2 no-answer calls + WhatsApp -> call never cancelled, slot not freed | outreach-engine.ts:478-491,614-639 | Test |
| DSC-10 | Med | Desk "No show" doesn't release slot | discovery-routing.ts:103-108 | Test |
| DSC-11 | Med | Chase only after NO_SHOW recorded; lead who answers can't be routed, stays no-show, Postpone hidden | l2-desk-metrics.ts:223; BookingsTable.tsx:213 | Test |
| DSC-13 | Med | Calls booked counts only confirmed calls -> rates inflated | pipeline-metrics.ts:282 | Code |
| DSC-15 | Med | SSS WhatsApp to +49 lead gives IST time with no zone | outreach.ts:248-253,808-811 | Code |
| DSC-17 | Med | SSS booking in the past accepted; reminder raised for past time | sss-slots.ts:145-167 | Test |
| DSC-18 | Med | PRD outcome form No show / Qualified doesn't move stage | pipeline-actions.ts:538-578 | Test |
| DSC-21 | Med | Cancelled disco call: lead stays booked, confirm reminder stays DUE | booking-actions.ts:743-771; outreach.ts:716-722 | Test |
| DSC-23 | Med | SSS calendar click hits hidden "Block slot" icon: slot ends BLOCKED instead of booked | SssCalendar.tsx:251,258-261 | Test |
| DSC-16 | Low | Bookings shows "CET" in September (CEST); no DD/MM/YYYY | BookingsTable.tsx:145 | Test |
| DSC-19 | Low | Highly Qualified permission enforced on PRD form, not desk | discovery-routing.ts:83 | Test |
| DSC-20 | Low | SSS booked 11h ahead: 24h + 12h messages fire back to back; cancel waits to T-2h | outreach-engine.ts:494-511 | Test |

Notes: webhook links YES to SKIPPED rows too (shared numbers -> wrong lead confirmed); second no-show can't reopen chase; Step 12 blocks queue card.
Prod: only 01 smoke + 07 Berlin grid (read-only, ~3 min, no messages). 02-07 must NOT run in prod.
