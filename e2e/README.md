# End-to-end suite

Playwright + Chromium tests that drive the real app the way the team uses it: they sign in as each
role, enter data through the UI and follow each process through, checking both the screen and
(locally) the database. Specs are grouped by area:

| Folder | Covers |
|---|---|
| `tests/finance` | PRD 1 Finance, PRD 3 Cash Health: income, expenses, dates, instalments, receivables, runway |
| `tests/people` | PRD 2: team profiles, OKRs, daily logs, students, 90/120-day tracker, LTV |
| `tests/outreach` | Outreach Specialist Level 1 SOP, PRD 1 Pipeline, PRD 3 Conversion Funnel |
| `tests/discovery` | Discovery Specialist Level 2 SOP: the call, no-show chase, SSS ladder |
| `tests/access` | Roles and permissions, offboarding, login flows, public surfaces, mobile |

A test that proves a known bug fails with the bug's ID in its message (`FIN-02: ...`). The IDs,
steps and root causes are in `findings/`.

## Running locally (the default)

Local runs use their own production build, on the local Docker database, with every outbound
channel neutralised. Nothing leaves the machine.

```sh
cd e2e
npm ci
npx playwright install chromium
cp creds.example.json creds.local.json      # fill in the local demo passwords
cp fence.example.json fence.local.json      # the only phones/emails a test may use (real people who agreed)
```

Then, from `b2-dashboard/`:

```sh
npm run db:local                             # Docker Postgres on 5435
source e2e/local-env.sh                      # local DB, dummy WATI/Resend, allowlist, port 3100
npx next build && npx next start -p 3100
```

`local-env.sh` overrides everything that could reach production or a real person, because
`.env` points at the live database. It builds into `.next-verify3` so it never disturbs a dev
server's `.next`. Then:

```sh
cd e2e
E2E_AREA=finance npx playwright test tests/finance --workers=1
```

Run one area at a time. Five areas at once overloaded a single local server and turned about
half the failures into timeouts.

## Running against production

`E2E_TARGET=prod` points the suite at https://b2app.sirahagents.com. **Production messages
real people and the finance ledger is append-only**, so only a curated list is safe:

1. `tests/access/01-provision.spec.ts` creates one E2E account per role (`support+e2e-*@sirahdigital.in`) and writes `creds.prod.json`. Put the founder's admin login in that file first.
2. Read-only: `access/03-role-matrix`, `access/06-ui-rules`, `access/07-public-surfaces`, `discovery/01-desk-schedule`, `discovery/07-sss-edge-cases`.
3. Finance, voided straight after: `finance/01`, `03`, `05`, `08`, then `finance/99-cleanup` as a separate run.
4. `tests/access/zz-deprovision.spec.ts` suspends and deletes the E2E accounts and proves none can sign in.

Never run in production: the outreach SOP specs (they take hours and send WhatsApp),
`outreach/07`-`09` (they overwrite the founder's weekly funnel snapshot and monthly target),
and anything under `people/` that creates students. Most of these skip themselves when
`E2E_TARGET=prod`, but check before adding a spec to a production run.

The only contacts a test may type are the two in `fence.local.json` (loaded as `FENCE` in
`helpers/target.ts`); `assertFenced()` throws on anything else. In production those people
receive real WhatsApps and emails, so they must be people who agreed to.

## Gotchas

- Sign-in is rate limited (a few per 10 s per IP). `global-setup` reuses sessions from `.auth/` and backs off on 429.
- `/people` streams its tabs in slowly on production: wait for the tab, not the page.
- `tests/discovery/02-outcome-routing` skips within an hour of IST midnight, and its seeded call is not on the desk just after midnight: run it in IST daytime.
- Just after navigation, a date field briefly shows the server's IST date before the browser corrects it (about 120 ms). Read form defaults after the page settles.
