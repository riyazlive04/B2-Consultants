# Findings - Access, users, offboarding
Specs as they stand: 29 correct tests pass; 16 fail each on a proven finding. Matrix: 7 roles x 52 routes, 0 mismatches vs sections.ts (see access-matrix-local.json).

## Nilofer root cause (ACC-01, test-confirmed)
People > Team & org chart > Edit > Status "Inactive" only writes TeamProfile.status (people-actions.ts:62,71). Sign-in (auth.ts:139-147) and requireSession (rbac.ts:66-69) only check User.status. Result: fresh sign-in 200, open browser keeps working, APIs 200, server actions run, cookie reusable, password reset works. Suspend / Delete / Offboard close every door. Check prod Activity Log for Nilofer: profile.update vs user.terminate + user.reinstate.

| ID | Sev | Finding | Root cause |
|---|---|---|---|
| ACC-01 | Critical | People status "Inactive" leaves full access | people-actions.ts:62,71; auth.ts:139-147; rbac.ts:66-69 |
| ACC-03 | High | Offboard then Users > Reactivate reopens login while profile terminated | users-actions.ts:588-611 |
| ACC-07 | High | USER downloads full leads + form-responses CSV; export buttons shown to HEAD/USER | api/export/[entity]/route.ts:253 |
| ACC-08 | High | STUDENT/TUTOR get lead names/stages/owners from /api/leads/poll-recent?scope=kanban | leads/poll-recent/route.ts:30-49 |
| ACC-05 | Med | PRD divergence: USER opens Students + Pipeline; HEAD opens Pipeline; USER no daily log | sections.ts:113-294 |
| ACC-06 | Med | USER can reassign any lead owner via Contacts | contacts-actions.ts:232-235 |
| ACC-10 | Med | Sign-in rate limit keyed on client-supplied X-Forwarded-For (bypassable); behind Caddy maybe whole team one bucket | auth.ts (no advanced.ipAddress) |
| ACC-12 | Med | Open redirect after login: /login?next=/%5Cexample.invalid | LoginForm.tsx:192 |
| ACC-15 | Med | USER can publish/unpublish forms and funnels | forms-actions.ts:221; funnels-actions.ts:94 |
| ACC-09 | Low-Med | Any signed-in role (even STUDENT) can run releaseDeferredBookOrders | book-order-actions.ts:362 |
| ACC-04 | Low | 5 API routes skip User.status check (suspended user with live session row) | notifications, work-time, command-palette, conversations/poll, leads/poll-recent |
| ACC-11 | Low | Forced password change not enforced on 3 APIs | rbac.ts:74-76 |
| ACC-13 | Low | Sidebar order differs from PRD3 (all six items present) | sections.ts |
| ACC-14 | Low | Top bar has no current month (clocks instead); runway shown correctly | AppShell.tsx:416-419 |
| ACC-16 | Low | /activity showed ISO date once | booking-actions.ts:601 |
| ACC-17 | Low | Suspend leaves team profile ACTIVE; reset token still changes suspended password | users-actions.ts:556-586 |
| (code) | Low | "Bring back" sets user ACTIVE even if suspended for another reason | users-actions.ts:539-541 |

Passed: 15 privileged server actions refuse non-admins; self role promotion rejected; generic login errors; logout; forgot/reset single-use; forced password change on pages; invite single-use; role change applies to open session; public pages + unauthenticated /api refuse; INR/EUR formats; mobile iPhone 13/Pixel 7.
Prod: provisions support+e2e-<key>-<run>@sirahdigital.in accounts (no emails sent), deprovision suspends + deletes and verifies sign-in fails; retired team profiles + activity logs remain.
