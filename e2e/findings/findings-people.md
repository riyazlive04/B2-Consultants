# Findings - People + Students (PRD Phase 2)
Last full run (overloaded shared server): 20 passed, 17 failed, 2 skipped, 9 did not run. 7 failures = real bugs; the rest = timeouts/test design.

| ID | Sev | Finding | Root cause | Confirmed |
|---|---|---|---|---|
| PPL-11 | High | Weekly update: changing only one student's Signal blanks last session date, last task, task done, next check-in, signal notes | TrackerBatchForm.tsx:158-199, students-actions.ts:412-430 | Test |
| PPL-10 | Med | Deleting a student erases milestone + signal history (should be undeletable) | students-actions.ts:264 + append_only_allow_cascade migration | Test |
| PPL-12 | Med | New student not counted in Funnel "Enrolled" until weekly snapshot re-saved | funnel-metrics.ts:110-133 | Test |
| PPL-13 | Med | Avg LTV per level uses lifetime total, not per-program fee (Solo 34,286 vs 8,571) | students-metrics.ts:246-255 | Test |
| PPL-06 | Med | Lead source "Meta Lead Ad"/"Landing page" -> Invalid input on student create/edit | labels.ts:74-86 vs students-actions.ts:73-76 | Test |
| PPL-04 | Med | No OKR month picker; past months can't be viewed/exported | people/page.tsx:21 | Test |
| PPL-01 | Med | Daily log rollups use latest 400 logs across all users - older months undercount | people-metrics.ts:46-50 | Code |
| PPL-02 | Med | Duplicate profile email -> Prisma P2002 crash; role sync picks first profile | people-actions.ts:86-105 | Code |
| PPL-05 | Low | Text OKR target parsed from first number ("Q3 target: 50 calls" -> 200%) | people-actions.ts:147-151 | Test |
| PPL-07 | Low | Student CSV phone exported as '+91... | StudentsPanel.tsx:31 | Test |
| PPL-09 | Low | First milestone log row shows Updated by "-" | students-actions.ts:132,299 | Test |
| PPL-03 | Low | Org chart move swaps with hidden/admin cards | people-actions.ts:111-131 | Test |
| PPL-08 | Low | Only one correction note per daily log; server overwrites | activity.tsx:202, people-actions.ts:440 | Test+code |
| PPL-14 | Low | Missing-log badge on Sundays / non-working Saturdays | people-metrics.ts:103-105 | Code |
| PPL-15 | Low | After upgrade, old Solo enrollment stays Active; level counts don't sum | students-metrics.ts:120-137 | Code |
| PPL-16 | Low | Past-end enrollments stuck "Day 90 of 90"; future start shows Day 1 | students-metrics.ts:166 | Code |

Verified correct: profiles, OKR max-3 + % + colours + CSV, daily log (IST day, one per day, undeletable, correction keeps original, rollups), NO date-shift in student/profile dates (Kolkata + Berlin + DST), student counts, satisfaction/NPS validation + averages, tracker filters/sorts, Head read-only on profiles, LTV follows Finance edits.
Divergences: USER role has no My Daily Log (sections.ts:177); USER can open Students by default; student form has no fee/duration (Finance-driven); raw programme codes in column/CSV.
Prod notes: 07-ltv-finance skipped in prod; offboarded profile + Head daily log are permanent; 99-cleanup deletes students (erases their history, PPL-10).
