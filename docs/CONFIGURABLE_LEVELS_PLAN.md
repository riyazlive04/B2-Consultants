# Configurable Levels — implementation & migration plan

**Status:** proposed · no code written yet
**Goal:** replace the hardcoded German-level enums with a `Level` config table + an admin section, so the founders can add levels (C1, C2, …) — and bundles — from the dashboard instead of shipping a migration each time.

This document is the design of record. It changes no code. Read the two "wrinkles" first — they drive every decision below.

---

## 1. Why this isn't a one-line change

### Wrinkle A — `ProgramLevel` is a *mixed* enum
`prisma/schema.prisma` defines one Postgres enum that carries three unrelated concerns:

```prisma
enum ProgramLevel { SOLO GUIDED ELITE  GN_A1 GN_A2 GN_B1 GN_B2 GN_BUNDLE  OTHER }
```

- `SOLO / GUIDED / ELITE` — English coaching tiers (drive student program duration + commission)
- `GN_A1 … GN_B2 / GN_BUNDLE` — German course levels (the thing we want configurable)
- `OTHER`

It is the column type for **seven** columns: `Income.programLevel`, `PendingPayment.programLevel`, `Enrollment.programLevel`, `Lead.wonLevel`, `GnBatch.level`, `GnPendingJoiner.level`, `BookOrder.level`. So German levels are tangled into **finance, students and pipeline**, not just German Note.

**Decision:** the `Level` table holds *all* values (coaching tiers included, so the columns have one consistent domain), but the admin UI only lets you add/edit **German levels & bundles**. Coaching tiers are seeded, `locked` (immutable `code`, not deletable) because `students-actions.ts` `derivedDuration` keys the 90/120-day logic off the `SOLO/GUIDED/ELITE` literals.

### Wrinkle B — Workshops bake the level universe into columns
`GnWorkshopConversion` stores fixed columns `batchA1 / batchA2 / batchB1` + `timeA1 / timeA2 / timeB1` (schema ~2127–2132) and a `GnWorkshopProduct` enum (`A1 A2 B1 A1_A2 A2_B1 A1_A2_B1`). The set {A1, A2, B1} is hardcoded into the *table shape*. Supporting C1 in a workshop conversion means reshaping those columns into child rows — a self-contained sub-project.

**Decision:** split the work. Stage 1 delivers configurable levels everywhere **except** workshops. Stage 2 reshapes workshops. This keeps the risky finance migration and the risky workshop reshape in separate, independently-verifiable steps.

### Wrinkle C — Losing the compile-time safety net
Today the finite enum *forces* every hardcoded map to stay in sync — a new level breaks the build **loudly** at [`chart-of-accounts.ts:82`](../src/lib/chart-of-accounts.ts#L82), `gn-workshop-pricing.ts`, etc. Once levels are runtime data, those same spots would fail **silently** (e.g. an income row posted to *no* GL account → an unbalanced journal). Every such spot must be converted to a data lookup with an explicit fallback, not left to "degrade."

---

## 2. Target model

```prisma
enum LevelKind {
  COACHING_TIER   // SOLO / GUIDED / ELITE  — locked, not user-editable
  GERMAN_LEVEL    // GN_A1 … GN_C2          — user adds these
  GERMAN_BUNDLE   // GN_BUNDLE, A1_A2, …    — composed of GERMAN_LEVELs
  OTHER
}

model Level {
  id     String    @id @default(cuid())
  code   String    @unique   // STABLE natural key, stored on every FK column: "GN_A1", "SOLO", "GN_C1"
  label  String              // display: "GN A1"
  kind   LevelKind
  order  Int       @default(0)
  active Boolean   @default(true)
  locked Boolean   @default(false)  // coaching tiers: code immutable, not deletable

  // Finance — which GL income account this level's revenue posts to.
  incomeAccountCode String @default("4030")   // 4000 Solo / 4010 Guided / 4020 Elite / 4030 German / 4090 Other

  // German-Note economics (null for coaching tiers / OTHER). Rupee-minor (paise), like the rest of the schema.
  booksCostInrMinor BigInt?
  tutorCostInrMinor BigInt?

  // Bundle composition — ordered member codes, only for kind = GERMAN_BUNDLE.
  bundleMembers String[] @default([])   // ["GN_A1","GN_A2"]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([kind, active, order])
  @@map("level")
}
```

### Storage decision: text `code`, not a hard FK
The seven enum columns become `String` holding the **same value** they hold today (`"GN_A1"` etc.), validated in server actions against the `Level` table. Rationale:

- The enum→text migration is near-zero-risk: values are preserved verbatim, no per-row backfill, and the `@@unique([studentId, level])` constraints on `BookOrder` and `GnPendingJoiner` stay as-is.
- `code` is treated as an **immutable natural key** (you edit a level's `label`, never its `code`), so there is nothing for a FK to protect against that the "code is immutable + delete is guarded" rule doesn't already cover.

*Alternative considered:* real `levelId` FK columns. Stronger integrity, but forces a backfill of every row and rewrites both unique constraints to `(studentId, levelId)`. Rejected for Stage 1 as churn without payoff given `code` is immutable. **(Open decision D1 — confirm.)**

---

## 3. Stage 1 — configurable levels everywhere except workshops

### 3.1 Migration (`prisma/migrations/<ts>_configurable_levels/migration.sql`)
1. `CREATE TABLE "level"` + `CREATE TYPE "LevelKind"`.
2. Seed `level` from today's values:

   | code | label | kind | locked | incomeAccountCode | books | tutor |
   |---|---|---|---|---|---|---|
   | SOLO | Solo | COACHING_TIER | ✔ | 4000 | — | — |
   | GUIDED | Guided | COACHING_TIER | ✔ | 4010 | — | — |
   | ELITE | Elite | COACHING_TIER | ✔ | 4020 | — | — |
   | GN_A1 | GN A1 | GERMAN_LEVEL | | 4030 | 1300·100 | 7000·100 |
   | GN_A2 | GN A2 | GERMAN_LEVEL | | 4030 | 1300·100 | 8000·100 |
   | GN_B1 | GN B1 | GERMAN_LEVEL | | 4030 | 1300·100 | 12000·100 |
   | GN_B2 | GN B2 | GERMAN_LEVEL | | 4030 | — | — |
   | GN_BUNDLE | GN Bundle | GERMAN_BUNDLE | | 4030 | — | — |
   | OTHER | Other | OTHER | ✔ | 4090 | — | — |

   (Book/tutor costs from `gn-workshop-pricing.ts:44` `GN_LEVEL_COST`.)
3. For each of the 7 columns: `ALTER TABLE … ALTER COLUMN … TYPE text USING "col"::text;` (Postgres casts enum→text by label — values unchanged).
4. `DROP TYPE "ProgramLevel";` (all references now gone). **Leave `GnWorkshopProduct` in place — Stage 2 owns it.**

Prisma schema: swap the 7 columns from `ProgramLevel` to `String`, add `Level` + `LevelKind`, keep every `@@unique`/`@@index`.

### 3.2 New server code
- **`src/lib/levels.ts`** (isomorphic types + pure helpers: `LevelSummary`, kind predicates, `isGerman(code)`).
- **`src/server/levels.ts`** — `getLevels()` (cached via `React.cache`), returns active levels + lookup maps: `labelByCode`, `incomeAccountByCode`, `costByCode`, `bundleMembersByCode`, `optionsFor(kind[])`. This is the single source every page/action reads.
- **`src/server/level-actions.ts`** — `requireAdmin()` CRUD: `createLevel`, `updateLevel` (label/order/active/costs/incomeAccount/bundleMembers; **rejects `code`/`kind` edits on `locked`**), `reorderLevels`, `setLevelActive`. Guarded delete: refuse if the `code` is referenced by any Income/Pending/Enrollment/Lead/GnBatch/GnPendingJoiner/BookOrder row — offer *deactivate* instead. `logActivity` on every write (mirror `german-note-actions.ts` `createBatch`).

### 3.3 Finance rework (the risky part — do first, verify hardest)
- **`src/lib/chart-of-accounts.ts:82`** — delete the no-`default` `incomeAccountFor` switch. Replace callers with a lookup on the `Level.incomeAccountCode` map, **falling back to `4090` (Other)** for an unknown code (never `undefined`).
- **`src/server/finance-posting.ts:85`** — `incomeEntryDraft` takes an `incomeAccountByCode` map (loaded once by the caller from `getLevels()`); use `map.get(level) ?? "4090"`. Same for `seed-ledger.ts`.
- **`src/server/finance-metrics.ts:160`** — replace the `.startsWith("GN_")` bucket with `kindByCode.get(level)` so a level named without the `GN_` prefix still buckets to German Note.

### 3.4 Validation — retire the duplicated `z.enum`s
Replace the 7 hardcoded level enums with a shared runtime check against `getLevels()` (parse the string, then `assertKnownLevel(code, allowedKinds)` in the action):
`finance-actions.ts:50,623` · `pipeline-actions.ts:76` · `students-actions.ts:36` (coaching tiers only) · `german-note-actions.ts:41` · `pending-pool-actions.ts:20` · `book-order-actions.ts:21`. Tedious, low-risk; miss one and that form rejects a valid new level (fails safe).

### 3.5 Labels & dropdowns
`src/lib/labels.ts:3` `PROGRAM_LEVEL_LABELS` is isomorphic and can't query the DB. Pattern: **server pages fetch `getLevels()` and pass `levelOptions` / `levelLabels` as props** to client components; keep a tiny fallback `?? code` for display of historical values. Replace the hardcoded arrays in:
`german-note/_components/BatchesPanel.tsx:15` · `PendingPoolPanel.tsx:24` · `students/_components/BookOrdersPanel.tsx:22` · finance `IncomeSection`/`PendingSection` + pipeline `LeadSection` (currently `optionsFrom(PROGRAM_LEVEL_LABELS)` → `optionsFrom(levelLabels)` from props).

### 3.6 Admin section
New **`LevelsPanel.tsx`** + a "Levels" tab in `src/app/(app)/german-note/manage/page.tsx:38` (next to Batches/Members/Tutors/Costs). Mirrors `BatchesPanel`: `Modal` + `Field`/`Select`, list with drag-order or up/down, add/edit German levels & bundles (bundle = multi-select of member `GERMAN_LEVEL` codes), per-level books/tutor cost + GL account, activate/deactivate. Coaching tiers shown read-only (locked).

### 3.7 Stage 1 done =
Add "GN C1" / "GN C2" from the dashboard → it appears in book-order, batch, waitlist, student-program, income & pending dropdowns; income posts to the German GL account; revenue-by-level counts it. Workshops untouched (still A1/A2/B1 + existing bundles).

---

## 4. Stage 2 — workshops

- Convert `GnWorkshopProduct` uses to `Level` codes (single `GERMAN_LEVEL` or `GERMAN_BUNDLE`).
- **Reshape `GnWorkshopConversion`:** drop `batchA1/A2/B1` + `timeA1/A2/B1`, add child **`GnConversionSeat`** (`conversionId, levelCode, batchName, time`). Migration backfills the three existing column-pairs into up to three seat rows per conversion.
- Make `gn-workshop-pricing.ts` derived: `PRODUCT_LEVELS` → `bundleMembers`; `GN_LEVEL_COST` → `booksCost/tutorCost` columns; `SEAT_LEVELS` → active `GERMAN_LEVEL` codes. `german-note-workshops.ts` (`buildRows:154`, `capacityGrid:300`, `bySeatLevel:284`, `levelRank:311`) iterates dynamic levels instead of `{A1,A2,B1}` literals.
- `ConversionsPanel.tsx` renders one seat row per constituent level of the chosen product.
- `workshopFormat.tsx` `PRODUCT_LABELS`/`PRODUCT_OPTIONS` → from `getLevels()`.

---

## 5. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Silent bad ledger entry for an unmapped level (was a loud compile error) | Every finance lookup has an explicit `?? "4090"` fallback; add a unit test asserting every active `Level.incomeAccountCode` resolves to a real account in the chart. |
| enum→text migration on live Supabase data | Values are preserved by `::text`; take a DB snapshot first; run on a copy, diff `SELECT DISTINCT programLevel` before/after. |
| A missed `z.enum` rejects a valid new level | Fails *safe* (form rejects, nothing corrupted); grep audit checklist in the PR ensures all 7 are converted. |
| Deleting a level that's in use | No hard delete — `setLevelActive(false)`; delete refused with a usage count. |
| Coaching-tier duration logic keys off literals | Coaching tiers are `locked`; `code` can't change; `derivedDuration` untouched. |

## 6. Verification
- Unit: `chart-of-accounts` fallback; bundle cost = Σ members; `getLevels` maps.
- Migration: distinct-value diff on all 7 columns before/after; row counts unchanged.
- E2E (Stage 1): add `GN_C1` in the admin panel → create a book order at C1 → record C1 income → confirm the journal credits `4030` and the revenue-by-level tile counts it. Then deactivate C1 → it drops from pickers but historical rows still render.

## 7. Open decisions (please confirm before build)
- **D1 — Storage:** text `code` columns (recommended, low-churn) vs real `levelId` FK (stronger integrity, backfill + constraint rewrite). Plan assumes text `code`.
- **D2 — GL accounts:** keep all German levels → `4030` with an optional per-level override (recommended), or a distinct GL account per new level (more granular ledger, more chart maintenance)?
- **D3 — Coaching tiers:** keep `SOLO/GUIDED/ELITE` locked & hidden from the Levels admin (recommended), or expose them as editable too?
- **D4 — Stage 2 timing:** build now after Stage 1 lands & is verified, or defer until workshops actually need C1?

---
*Blast-radius references verified against the codebase on 2026-07-18. Companion to the WhatsApp submission pack work; unrelated to it beyond sharing this German-Note subsystem.*
