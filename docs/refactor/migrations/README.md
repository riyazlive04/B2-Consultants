# Schema changes the structural fixes need — proposals, not applied

**None of these has been run. Nothing in this folder has touched a database.**

Four of the structural problems in
[`02-current-state.md`](../02-current-state.md) cannot be closed in application code, because what
is wrong is the shape of the data. This folder is the list the ground rules ask for: each one
**listed, reversible, and awaiting approval** before anything is applied.

The code-level half of all four is already done and shipped in the working tree — see
[`CHANGELOG.md`](../CHANGELOG.md) §6. What is here is the part that needs your go-ahead.

---

## The files

Each proposal has a runnable `.sql` beside this document, with its pre-flight checks, its `UP`,
its `DOWN` and the `schema.prisma` change written out. Everything but the `UP` section is
commented out, so a file cannot half-apply itself if it is piped somewhere by accident.

| File | What it does | State |
|---|---|---|
| [`M1_invoice_student_link.sql`](./M1_invoice_student_link.sql) | Two nullable FK columns on `invoice` | ready |
| [`M2_level_foreign_keys.sql`](./M2_level_foreign_keys.sql) | Foreign keys onto `level(code)` | **blocked** — run `npm run fix:level-codes -- --apply` first |
| [`M3_deal_stage_drift_view.sql`](./M3_deal_stage_drift_view.sql) | A reporting view; stores nothing | ✅ **approved — now a Prisma migration**, `20261024010000_deal_stage_drift_view` |
| [`M4_one_membership_mechanism.sql`](./M4_one_membership_mechanism.sql) | Stage 1 of unifying membership | **needs a decision** (Option A or B) |

**The two APPROVED ones are now in `prisma/migrations/`** and will be applied by the next
`npm run db:deploy`:

  · `20261024000000_invoice_student_and_level_fks`  (M1 + M2)
  · `20261024010000_deal_stage_drift_view`          (M3)

The files in this folder stay as the reasoning and the rollback. M4 is declined and has no
migration folder - it must not apply itself.

**Both were rehearsed against a restore of the live dump before being proposed for deploy**, and
the behaviours were proven there rather than assumed: a bad course code is refused, a course in
use cannot be deleted, renaming one carries its plans and enrolments with it, and the drift view
reports 0 on clean data and exactly 1 when a lead's stage is moved without its card.

---

## How these would be applied, when approved

**The order matters, and so does the environment.** Standing traps in this project:

- **`.env` points at live Supabase.** A `prisma migrate deploy` with a shell-set `DATABASE_URL`
  does **not** override it — `.env` wins. This has gone wrong twice before.
- **Migrations are not in the deployed image.** `npm run db:deploy` runs *before* an image ships,
  never as part of it.
- Apply to the **local stack on `:5435` first** (`.env.local`), with a restored copy of live data,
  and read the row counts below against it before going near production.

Each proposal below is written as a pair: `up` and `down`. A migration without a tested `down` is
not reversible, whatever the file says.

## Measured against live, 23 October 2026

Read-only, via `npm run migration:audit` — the script runs each proposal's own
"report before applying" query, so these are counts and not estimates.

| Migration | What live actually holds | Verdict |
|---|---|---|
| **M1** | 7 invoices; 1 carries a `leadId`, and that lead never became a student | **Backfill does nothing.** M1 is purely forward-looking, which also makes it the safest of the four. |
| **M2** | 9 level codes in the catalogue. 0 unknown codes in enrolments, cohorts, won-levels or products — but **2 of 3 curriculum templates hold a code that does not exist**: `Guided` and `Gudied30` | **Blocked until those two are fixed.** `Gudied30` is a typo, and it is exactly the bug the missing foreign key allows: the app has been carrying a misspelled level for an unknown length of time and nothing could tell. |
| **M3** | 8 cards on the default board, **0 disagreeing** with their lead | The seam has held. M3 is insurance, not a repair. |
| **M4** | 23 cohorts, **0 `BatchMember` rows**, 1 seated enrolment | **Stage 1 would create exactly one row.** The risk is as low as it will ever be — German Note membership is entirely unused on live today. |

**What this changes about my recommendation.** M2's two bad rows are a 10-minute data fix, and
they are proof the migration is worth doing rather than an argument against it. M4 is far less
frightening than its design implies *right now*, precisely because nobody has used German Note
membership yet — if it is going to happen, the cheapest moment is before that data exists.

---

| # | Problem | Risk | Reversible | Data loss if reverted |
|---|---|---|---|---|
| M1 | **P14** — Invoice links to `Lead`, not `Student` | **low** | yes | the new links only |
| M2 | **P6** — `Level.code` has no foreign key | **medium** | yes | none |
| M3 | **P4** — one deal, two status fields | **medium** | yes | none (adds a check, stores nothing new) |
| ~~M4~~ | ~~**P1** — two batch-membership mechanisms~~ | — | — | **DECLINED 24 Oct 2026** — the two lines stay separate |

**Status after the founder's decisions of 24 Oct 2026:** M1, M2 and M3 are **approved**. M4 is
**declined** — German Note and B2 are two businesses and keep two mechanisms, with the shared
seam carrying the cost instead.

---

## M1 · `Invoice` should be able to name the student (P14)

**The problem.** `Invoice` has `leadId` and nothing else. `Agreement` may link to a lead, a student
*and* an enrolment, none required. So "what has this student paid" and "whose contract is this" are
both answerable only by joining through provenance — which fails entirely for a student who never
was a lead (a walk-in, a German Note learner, anyone imported).

**The change.** Two nullable columns and their indexes. Additive: nothing existing moves.

```sql
-- up
ALTER TABLE "invoice" ADD COLUMN "studentId" TEXT;
ALTER TABLE "invoice" ADD COLUMN "enrollmentId" TEXT;

ALTER TABLE "invoice"
  ADD CONSTRAINT "invoice_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "student"("id") ON DELETE SET NULL;
ALTER TABLE "invoice"
  ADD CONSTRAINT "invoice_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL;

CREATE INDEX "invoice_studentId_idx" ON "invoice"("studentId");
CREATE INDEX "invoice_enrollmentId_idx" ON "invoice"("enrollmentId");
```

```sql
-- down
DROP INDEX "invoice_enrollmentId_idx";
DROP INDEX "invoice_studentId_idx";
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_enrollmentId_fkey";
ALTER TABLE "invoice" DROP CONSTRAINT "invoice_studentId_fkey";
ALTER TABLE "invoice" DROP COLUMN "enrollmentId";
ALTER TABLE "invoice" DROP COLUMN "studentId";
```

**`ON DELETE SET NULL`, not `CASCADE`.** An invoice is a financial record and must outlive the
student row it points at. Cascading would let a student deletion erase issued invoices, which is
the one thing the ledger exists to prevent.

**Backfill — separate, and reversible on its own.** Written as a script rather than inside the
migration, so it can be run, read, and re-run:

```sql
-- Only where the join is unambiguous. A lead with two students is skipped, not guessed.
UPDATE "invoice" i
SET "studentId" = s.id
FROM "student" s
WHERE i."leadId" IS NOT NULL
  AND s."leadId" = i."leadId"
  AND i."studentId" IS NULL
  AND (SELECT count(*) FROM "student" x WHERE x."leadId" = i."leadId") = 1;
```

**Report before applying:** how many invoices have a `leadId`, how many of those resolve to exactly
one student, and how many resolve to several (those stay null and need a human).

**Then in code:** `payments-metrics.ts` reads the new column with a fallback to the lead join, so
an un-backfilled invoice keeps working. Nothing breaks on day one.

---

## M2 · `Level.code` should be a real foreign key (P6)

**The problem.** `Level` has **zero** schema relations. Its `code` is soft-referenced as plain text
in at least twelve columns across ten models — `Enrollment.programLevel`, `Batch.level`,
`Lead.wonLevel`, `Product.levelCode`, `InvoiceLine.levelCode`, `CurriculumTemplate.levelCode`,
`Workshop.level`, and more. A typo is undetectable, and deleting a level leaves every one of those
columns pointing at nothing.

**The change.** A foreign key per referencing column, pointing at `level(code)`.

```sql
-- up
-- `code` is already UNIQUE, so it can be a foreign-key target as it stands.

-- The required ones. These FAIL LOUDLY if any row holds an unknown code, which is the point:
-- see the audit below, and fix the data first.
ALTER TABLE "enrollment"
  ADD CONSTRAINT "enrollment_programLevel_fkey"
  FOREIGN KEY ("programLevel") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;
ALTER TABLE "batch"
  ADD CONSTRAINT "batch_level_fkey"
  FOREIGN KEY ("level") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE RESTRICT;

-- The nullable ones.
ALTER TABLE "lead"
  ADD CONSTRAINT "lead_wonLevel_fkey"
  FOREIGN KEY ("wonLevel") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "product"
  ADD CONSTRAINT "product_levelCode_fkey"
  FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;
ALTER TABLE "curriculum_template"
  ADD CONSTRAINT "curriculum_template_levelCode_fkey"
  FOREIGN KEY ("levelCode") REFERENCES "level"("code") ON UPDATE CASCADE ON DELETE SET NULL;
```

```sql
-- down
ALTER TABLE "curriculum_template" DROP CONSTRAINT "curriculum_template_levelCode_fkey";
ALTER TABLE "product" DROP CONSTRAINT "product_levelCode_fkey";
ALTER TABLE "lead" DROP CONSTRAINT "lead_wonLevel_fkey";
ALTER TABLE "batch" DROP CONSTRAINT "batch_level_fkey";
ALTER TABLE "enrollment" DROP CONSTRAINT "enrollment_programLevel_fkey";
```

**Two choices worth arguing about.**

`ON UPDATE CASCADE` is what makes a level *renameable*. Today changing a code silently orphans
every row that held it; with this, the rename propagates. That alone is worth the migration.

`ON DELETE RESTRICT` on the required columns means **a level in use cannot be deleted**. That is a
behaviour change: the Console's delete would start refusing, with a database error rather than a
sentence. So this migration must ship **with** the code change that turns that into "3 cohorts and
41 enrolments still use GN_A1 — switch it off instead", which is what `Level.active` is already
for.

**Audit before applying** — this is the part that decides whether M2 is a half-hour or a week:

```sql
SELECT 'enrollment.programLevel' AS col, e."programLevel" AS value, count(*)
FROM "enrollment" e LEFT JOIN "level" l ON l.code = e."programLevel"
WHERE l.code IS NULL GROUP BY 1, 2
UNION ALL
SELECT 'batch.level', b."level", count(*)
FROM "batch" b LEFT JOIN "level" l ON l.code = b."level"
WHERE l.code IS NULL GROUP BY 1, 2
UNION ALL
SELECT 'lead.wonLevel', x."wonLevel", count(*)
FROM "lead" x LEFT JOIN "level" l ON l.code = x."wonLevel"
WHERE x."wonLevel" IS NOT NULL AND l.code IS NULL GROUP BY 1, 2;
```

Every row this returns is a value the app is already treating as a level and the catalogue has
never heard of. Each is either a typo to correct or a retired level to re-add as `active = false`.
**Nothing can be applied until this query returns nothing.**

**Run on live, 23 Oct 2026, it returns two rows** — both on `curriculum_template.levelCode`:

| value | rows | what it is |
|---|---|---|
| `Guided` | 1 | should be `GUIDED` — the catalogue code is upper-case |
| `Gudied30` | 1 | **a typo**, for `GUIDED` |

Neither template can be matched to a programme by any screen that looks a level up by code. This
is the whole argument for M2 in two rows: nothing in the app could tell anybody, and nothing will
until the column has a foreign key on it.

**Note:** this is also the blocker behind `docs/CONFIGURABLE_LEVELS_PLAN.md` (C1/C2 support).
Doing M2 first makes that plan smaller, not larger.

---

## M3 · Stop the two status fields drifting (P4)

**The problem.** `Lead.stage` and `Opportunity.stageId` are two records of one deal, reconciled in
application code. The code-level fix is already in: one `writeLeadStage` seam, both drift bugs
fixed, and `lead-stage-writers.test.ts` fails if a new write forgets. What that cannot do is detect
rows that have **already** drifted, or drift introduced outside the app.

**The change.** No new column and no stored duplicate — a view the app and a human can both read.

```sql
-- up
CREATE OR REPLACE VIEW "deal_stage_drift" AS
SELECT
  l.id              AS lead_id,
  l.name            AS lead_name,
  l.stage           AS lead_stage,
  ps."legacyStage"  AS board_stage,
  o."updatedAt"     AS card_updated_at
FROM "lead" l
JOIN "opportunity" o ON o."leadId" = l.id AND o."deletedAt" IS NULL
JOIN "pipeline_stage" ps ON ps.id = o."stageId"
JOIN "pipeline" p ON p.id = ps."pipelineId" AND p."isDefault" = true AND p."deletedAt" IS NULL
WHERE l."deletedAt" IS NULL
  AND ps."legacyStage" IS DISTINCT FROM l.stage;
```

```sql
-- down
DROP VIEW "deal_stage_drift";
```

**Why a view and not a constraint.** The two legitimately disagree for a moment mid-transaction,
and custom pipelines are deliberately not synced at all — a hard constraint would refuse writes the
product intends. A view costs nothing when unread, stores nothing, and reverts by being dropped.

**Then in code:** one row on Console → System → Not armed — "N deals whose board column disagrees
with their stage" — so this is a number somebody sees rather than a query somebody remembers.

**Report before applying:** run the `WHERE` clause as a `SELECT count(*)`. If it returns zero, the
seam has held and this is pure insurance. If it does not, those rows need deciding on first — and
the honest default is that the **board** is wrong, because `Lead.stage` is what the history table
records.

---

## M4 · One batch-membership mechanism (P1) — ❌ DECLINED BY THE FOUNDER, 24 Oct 2026

> **"German Note and B2 Consultants are two different things and they both need different ways of
> logic building."**

**This migration will not be done, and that is the right call.** The two lines are two businesses:
a coaching client buys a tier and is tracked against a programme, a German Note learner sits a
course. Forcing one membership table on both would have meant one of them carrying fields that do
not describe it — which is exactly the objection I raised against Option B, now applied to the
whole idea.

**What stands instead.** The fork stays, and the code-level work that stops it SPREADING stays
with it:

| | Where |
|---|---|
| One capacity rule, for both lines | `seatCount` in `lib/batch.ts` |
| The convention written down, not assumed | `seatMechanism(line)` |
| One roster read, deduped, both mechanisms | `mergeBatchSeats` in `lib/batch.ts` |
| One place that writes a seat | `server/batch-seats.ts`, dispatching to the tested action per line |
| A list of every module still reaching past the seam | `batch-membership.test.ts` — may only shrink |

So the cost P1 named — "every feature touching who is in this batch must be written twice" — is
paid once, in one module, instead of by every future feature. The two tables remain because the
two businesses remain.

**The one thing that WAS wrong and is now fixed:** the two lines disagreed about *permission*.
Seating a coaching client was `batches.manage`; adding a German Note learner was `requireAdmin()`.
That difference was not a design decision, it was an accident of the two halves being built at
different times — and it is gone (24 Oct 2026). Both are `batches.manage`, granted per person from
Users → Users & access.

<details>
<summary>The original proposal, kept for the record</summary>

### M4 (not to be applied)

**The problem — the deepest one in the schema.** `Batch` has two parallel membership mechanisms:

| | B2 coaching | German Note |
|---|---|---|
| Where the seat lives | `Enrollment.batchId` | `BatchMember` join table |
| On delete | `SET NULL` | `CASCADE` |
| Carries a programme level | yes | no |
| Carries a lifecycle status | yes | no |

Nothing in the schema says which applies — `Batch.line` decides, **by convention only**. Every
feature touching "who is in this batch" has to be written twice, and when it is, the copies drift.
That is not hypothetical: two capacity checks disagreed for months, one counting members and the
other counting members plus seated enrolments, so a full German Note cohort would have admitted a
ninth person with no warning.

The code-level fix is in (`lib/batch.ts` for the rules, `server/batch-membership.ts` for the reads,
`server/batch-seats.ts` for the writes, and a test that fails if a new module reaches past the
seam). **The fork itself remains.**

### The decision this needs from you

There are two honest directions, and they are not equivalent:

**Option A — `BatchMember` becomes the only mechanism.** Every seated enrolment gains a
`BatchMember` row; `Enrollment.batchId` becomes derived/read-only and is eventually dropped.

- *For:* membership becomes a thing in its own right, with a join date, and a student can be in
  two cohorts over time without contorting the enrolment.
- *Against:* `Enrollment.batchId` is read in dozens of places including the register, session
  tasks, fees and reporting. This is the larger code change by far.

**Option B — `Enrollment.batchId` becomes the only mechanism.** Every `BatchMember` gains a
synthetic enrolment.

- *For:* fewer code changes; the richer side already carries level, status and coach.
- *Against:* **it invents data.** A German Note learner has no programme level and buys no tier, so
  every synthetic enrolment would hold placeholder values that then flow into B2's revenue and
  tracker reports. I would not do this.

**My recommendation is Option A**, staged, with nothing dropped until the new path has run for a
full cohort cycle:

```sql
-- up (stage 1 of 3 - ADDITIVE ONLY, nothing is removed and nothing changes behaviour)

-- 1. Membership gains the facts the enrolment side was carrying.
ALTER TABLE "batch_member" ADD COLUMN "enrollmentId" TEXT;
ALTER TABLE "batch_member"
  ADD CONSTRAINT "batch_member_enrollmentId_fkey"
  FOREIGN KEY ("enrollmentId") REFERENCES "enrollment"("id") ON DELETE SET NULL;
CREATE UNIQUE INDEX "batch_member_enrollmentId_key"
  ON "batch_member"("enrollmentId") WHERE "enrollmentId" IS NOT NULL;

-- 2. Backfill a member row for every seated enrolment. Idempotent: re-running adds nothing.
--
--    `SEATED_STATUSES` is ACTIVE and PAUSED, and the filter is written as the POSITIVE list to
--    match lib/enrollment-lifecycle.ts. A fifth status added later must then be considered here
--    rather than silently swept in by a NOT IN.
--
--    The id carries a `bm_mig_` prefix. Every other id in this database is a cuid, so these are
--    instantly identifiable as backfilled - which is what makes the rollback below exact rather
--    than approximate.
INSERT INTO "batch_member" ("id", "batchId", "studentId", "enrollmentId", "addedAt")
SELECT 'bm_mig_' || gen_random_uuid()::text,
       e."batchId", e."studentId", e.id, COALESCE(e."enrollmentDate", now())
FROM "enrollment" e
WHERE e."batchId" IS NOT NULL
  AND e.status IN ('ACTIVE', 'PAUSED')             -- = SEATED_STATUSES
  AND NOT EXISTS (
    SELECT 1 FROM "batch_member" m
    WHERE m."batchId" = e."batchId" AND m."studentId" = e."studentId"
  );
```

```sql
-- down (stage 1)
-- Deletes ONLY the rows this migration created, by their prefix. A seat added through the app
-- after stage 1 has a cuid and is real data; it is left alone rather than swept away with the copies.
DELETE FROM "batch_member" WHERE "id" LIKE 'bm_mig_%';
DROP INDEX "batch_member_enrollmentId_key";
ALTER TABLE "batch_member" DROP CONSTRAINT "batch_member_enrollmentId_fkey";
ALTER TABLE "batch_member" DROP COLUMN "enrollmentId";
```

**⚠ What the prefix does and does not buy.** It makes the `down` precise: backfilled copies go,
real seats stay. What it cannot do is restore the `enrollmentId` LINK on a real seat — that column
is being dropped, so a coaching seat added through the new path after stage 1 reverts to a
`BatchMember` row with no enrolment attached, and the enrolment it belonged to has a null
`batchId`. Somebody would have to re-seat them.

> **So: stage 1 is cleanly reversible until the app writes through the new mechanism, and
> re-seat-able rather than clean after that.** `npm run db:backup` is verified and must be run
> immediately before this regardless.

Stages 2 and 3 — making the app write both, then read only the join table, then dropping
`Enrollment.batchId` — are a separate conversation, and not one to have until stage 1 has sat on
live for a cycle. **The seat count must be read against live before and after stage 1 and shown to
match**, per cohort, or stage 1 is rolled back.

**Report before applying:** seated enrolments per cohort, existing member rows per cohort, and any
cohort where both are non-zero (a mixed cohort — which `levelFitsBatchLine` is supposed to prevent,
and which would be the first thing to understand).

</details>

---

## What I need from you

| Migration | Decision |
|---|---|
| **M1** (Invoice → Student) | ✅ **Approved** 24 Oct 2026. |
| **M2** (Level foreign keys) | ✅ **Approved** 24 Oct 2026, and unblocked — the two bad rows were corrected the same day, and the plan form now offers a picker so no new one can be typed. |
| **M3** (drift view) | ✅ **Approved** 24 Oct 2026. |
| ~~**M4**~~ | **Declined.** No further decision needed. |

Until then the code-level fixes stand on their own: the capacity rule is unified, both drift bugs
are fixed, every reader goes through one seam, and a test fails if any of that is undone.
