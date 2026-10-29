# What shipped — 26 Oct 2026 (observability audit)

Implementation record for the monitoring / data-integrity audit raised the same day, after the
wireflow audit shipped as `45d528e`. The audit's own ordering is kept, and where a finding turned
out not to hold, that is recorded rather than quietly skipped.

**Verification:** `tsc --noEmit` clean · **2,011/2,011 tests pass** (1 skipped: the ledger
integration suite, which needs `LEDGER_TEST_DATABASE_URL`) · `next lint` clean · the new cron
threshold test verified to fail three ways with the fix reverted.

**Not verified against live.** Every claim below about production state is the audit's, not this
document's: live database reads were unavailable while this work was done. Nothing here was run
against live, and the items that need a live value or a live decision are listed under *Still
open* with nothing invented for them.

---

## Fixed

### 1 · `agreements` had no staleness threshold — the alarm was permanently on

`server/uptime.ts` holds `STALE_AFTER_MINUTES`; the schedule it judges against lives in
`docker/cron/entrypoint.sh`. Nothing connected them, so `agreements` shipped on 26 Oct with a
daily cadence (`30 4 * * *`) and no entry, fell to the 180-minute default, and read STALE for
about 21 hours out of every 24 while working perfectly. `cronsStale: ["agreements"]` was therefore
always true, so the one signal that would reveal a dead contract-chasing engine carried no
information.

`agreements: 1500` added beside `retention`. The recurrence is closed by
`lib/__tests__/cron-stale-thresholds.test.ts`, which reads both files as text and asserts:

- the crontab and `src/app/api/cron/*` name the same set of jobs;
- every scheduled job has an explicit entry, so none rides the default by accident;
- a threshold is always longer than the gap between two ticks;
- a daily job gets more than 1,440 minutes;
- the table names no job the scheduler does not tick.

### 2 · An armed WhatsApp channel sending nothing read as a quiet week

The audit's finding: one WhatsApp message in seven days, status `SKIPPED`, while every health
surface read calm. That is not a reporting gap in one screen — it is structural.

`tallySend` drops a skip before it reaches `attempted`, correctly: nothing was offered to WATI, so
it says nothing about whether WATI works. But `deliveryHealth()` reads `attempted === 0` as
`idle`, and `getDeliveryFailureReport` discards `idle` rows — so a channel that is armed, is being
asked to send, and declines every send over a fixable configuration fault produced exactly the
same picture as a week with nothing due.

`DeliveryTally.skippedConfig` now counts those, fed by a new `SendOutcome.skipKind` that carries
the distinction `sendWhatsApp` already made internally (`systemOff` vs `dataSkip`) and used to
throw away. `silentVerdict` reports a channel as silent when it skipped a material number (at
least three) and sent nothing in a window old enough to mean anything; `describeDelivery` gives it
words, and `/api/health` gains `skippedConfig24h`, `silent` and `deliverySilent`.

**What was deliberately NOT changed:** the escalation asymmetries. A config fault still cannot
mark a channel dead, still cannot withhold the dead-man's-switch ping, and still cannot page
anyone — `not-armed.ts` and this counter own it, and the severity is `watch`, never `risk`. The
new field is never folded into `attempted`, `failed` or `byClass`, so every verdict in the file is
arithmetically untouched. Twelve tests pin that, including one that drives 60 consecutive
all-skipped ticks and asserts the channel is never called dead. A channel off or paused, a dry
run, and a local `OUTBOUND_ALLOWLIST` block are all excluded: none is a fault.

This makes the condition visible. It does not diagnose the live instance — the reason is in that
row's `error` column, which needs a live read.

### 3 · Lead intake dropped leads with no record

Three endpoints, three different states:

| Endpoint | Before | Now |
|---|---|---|
| `/api/leads/b2consultants` | `recordDelivery(..., false)` on the 422 — visible in Console → Integrations only | also `captureMessage`, so a funnel page that stops sending a phone number reaches the error tracker |
| `/api/leads/pabbly` | **nothing at all** — not even a success stamp, so Console could not say whether the endpoint was wired up | `recordDelivery` on success, on an unreadable body and on the 422, plus `captureMessage` |
| `/api/leads/meta` | **four silent `continue`s** — no page token, a non-ok Graph fetch, unmappable fields, a thrown request — each returning 200 so Meta correctly never redelivered | every drop recorded with its cause, counted, and reported once per batch |

Field NAMES only, never the values: a lead we failed to save is not a reason to copy their details
into a third-party error tracker. For Meta the recovery key is the `leadgen_id` — Meta keeps the
answers and they can be re-pulled from the Graph API — so that is what is logged, and the PII
stays where it already is.

### 4 · `rotateInvoiceLink` had no UI, so the invoice-token decision could not be made

The B5 migration states that the admin screen "gains a 'regenerate link' action, so a weak token
can be replaced deliberately on the rows that still matter". The action was written and
capability-gated. **No screen ever called it** — `rotateInvoiceLink` had zero call sites outside
its own definition.

So the pre-26-Oct invoices kept their `cuid()` tokens not by decision but for want of a button,
and the audit's "leaving all 7 unrotated indefinitely is the part that needs a call" was a call
nobody could make.

- `InvoiceDetail` gains `tokenLegacy` / `tokenRevokedAt` / `tokenExpiresAt`. `tokenLegacy` is
  decided by SHAPE — a cuid is 25 lowercase base36 chars starting `c`, a minted token is 43 chars
  of base64url — because no column records which mint produced a token, and adding one to label
  rows identifiable by inspection would be a migration for nothing.
- A warn banner on any issued invoice still carrying a legacy token, stating what the URL exposes
  and that replacing it breaks the copy in the customer's inbox.
- The toolbar's **Link** button now opens a manager with Copy / Replace / Revoke and an optional
  expiry, instead of silently copying. A replacement goes straight to the clipboard, because a new
  link is worthless until it reaches the customer and the old one is already dead.

The judgement is still the founder's, per invoice. It is now a judgement that can be exercised.

### 5 · A comment that invited deleting live code

`lib/sections.ts` said `server/automation.ts` was "now unreferenced by any route" and offered its
removal as "a clean follow-up". The audit read that and reported the module as dead weight.

It is live code. `api/cron/workflows/route.ts` imports `runDueWorkflows` and is ticked every five
minutes by the container's crontab, and six action modules call `emitTrigger`: booking creation,
contact creation, tag add, form submission, stage change and invoice paid. Deleting it breaks
every one of those. What went away on 23/10 was the *builder*; the runtime was never touched, so
the engine is mostly quiet — and "mostly quiet" is not "unreferenced". The comment now lists the
call sites and says what removing it for real would require. (The audit also said "four
`server/automation-*` modules"; there is one, `automation-queue.ts`.)

### 6 · A deploy preflight, instead of remembering nine traps

`scripts/deploy-preflight.ps1` / `npm run deploy:preflight`. Read-only except for starting Docker
Desktop. It checks the daemon is actually answering (the Desktop process can be up while the
engine is still booting, and a build in that window fails on the socket), starts Docker Desktop
and waits up to three minutes if not, and then checks branch, tree cleanliness, unpushed commits,
`tsconfig.json` include paths that no longer exist, and the local `b2-app` tag pile.

**Docker Desktop's own "start when you sign in" is deliberately left off.** The audit suggested
auto-start; on this machine nearly every startup item is disabled, which reads as a considered
choice about boot time, and a weekly deploy is a poor reason to overturn it. The daemon is needed
at deploy time, so that is where it gets started.

The first run of this script reported six dead `tsconfig.json` include paths. That was the
script's own bug — the regex was reading the explanatory comment inside the `include` block, which
names the dead paths it exists to keep out. Fixed by stripping `//` lines first. `tsconfig.json`
itself is correct and was not touched.

---

## Did not hold

### §19 UStG — a blank fallback note cannot produce a non-compliant invoice

The audit's concern was that `invoice-compliance.ts` falls back to `fallbackTaxNote` whenever
`taxPercent === 0`, and that an empty value would make 0% invoices non-compliant under §14 Abs. 4
Nr. 8 UStG. It cannot, for new invoices: `invoiceIssueGaps` lists "a note saying why no tax is
charged" as a gap when `!(taxPercent > 0) && blank(taxNote)`, and `issueInvoice` **throws**
`InvoiceNotIssuable` on any gap. A blank note blocks issuance rather than producing a bad
document, and the editor shows the same gap before Send because both sides call
`invoiceIssueGapsFor`.

The residual risk is invoices issued *before* that gate existed. Checking that needs a live read.

### `NEXT_PUBLIC_SENTRY_DSN` does not exist

The audit reported `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` both empty. There is no
`NEXT_PUBLIC_SENTRY_DSN` anywhere in this codebase; `lib/observability.ts` reads `SENTRY_DSN`
only, and client errors travel over `/api/observability/client-error` to be captured server-side
precisely so a public DSN is not needed. `errorTracking: "off"` turns on one variable, not two.

### The 26 Oct migration's `DROP DEFAULT`

The audit is right that it was a no-op, and right that the comment is misleading: `publicToken`
was created plain `TEXT NOT NULL` by `20260711173536_synamate_payments_phase3`, and no migration
since added a database default. The default was only ever Prisma's `@default(cuid())`, applied
client-side.

**The migration file is deliberately not edited.** It has been applied on live, and editing an
applied migration changes its checksum, at which point the next `prisma migrate deploy` refuses to
run — a worse outcome than a wrong comment. The correction is recorded here and in
`server/payments-actions.ts`, beside `mintPublicToken`, where the same claim was repeated in the
present tense and is the version a developer actually reads.

---

## Still open — each needs a value or a decision that cannot be invented

| | What is needed | Why it is not done here |
|---|---|---|
| `SENTRY_DSN` | a DSN from a Sentry project | A credential. Until it is set, `captureException` writes only to the console and a 50-entry in-process ring buffer that dies with the container — so `errorsLastHour: 0` is measuring nothing, and every fix above that reports through `captureMessage` reaches only Console → System |
| `RESEND_WEBHOOK_SECRET` | the signing secret from the Resend dashboard | A credential. The webhook 503s while it is blank, so an `EMAIL.SENT` row means "Resend accepted it", never "it was delivered" |
| `WATI_TEST_RECIPIENT` / `testRecipient` | a decision: arm a test number, or accept that sends go to real customers | `WATI_ENABLED="true"` with no test fence is a legitimate production posture. It is only a fault if it is not what was intended |
| The 7 legacy invoice tokens | a per-invoice call by the founder | Now possible — see §4. Rotating breaks a link already in a customer's inbox, so it is not a decision to take on their behalf |
| `lead` holding ~7 rows where July had 23,434 | a live read, then an explanation | Not a soft delete and not done through the app. Unexplained, and the most serious item on the audit |
| Image tags on the box (16 `b2-app`, 14 `b2-cron`, 1.758 GB reclaimable) | a prune on production | A production action. The preflight reports the local pile and prints the command; running it on the box is a deliberate step |
