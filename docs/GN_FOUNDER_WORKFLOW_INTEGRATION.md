# German Note — Founder Workflow, Finance & Commission
## Integration Blueprint (planning only — no code in this phase)

*Sources analysed: `B2Consultants_Application_Logic_Part2.md`, `B2Consultants_ER_Diagram_v2.mermaid`, `B2Consultants_Finance_Commission_Flow.mermaid`, audited against the live app (`B2-Consultants/`, Next.js 14 App Router + Prisma + better-auth + WATI + BullMQ, ~2,800-line schema, ~100 models).*

---

## 0. Executive summary — read this first

**The app already implements most of Part 2, and implements it better than the spec draws it.** The ER v2 diagram is a clean-room model of a domain that already exists here in a more rigorous form. Building it as drawn would fork the application into two incompatible halves.

Of the 14 entities Part 2 introduces as "new":

| Verdict | Count | Entities |
|---|---|---|
| **Already exists, richer than spec** | 7 | `AD_SPEND`, `LEDGER_ENTRY`, `AGREEMENT`, `PIPELINE`/`PIPELINE_STAGE`, `CASH_RUNWAY`, `DASHBOARD_METRIC`, `THEME_PREFERENCE` |
| **Exists as hardcoded logic — needs config-ifying** | 3 | `TUTOR_FEE`, `COMMISSION_RULE`, `BONUS_RULE` |
| **Genuinely net-new** | 4 | `BOOK_ORDER`+`VENDOR`, pending pool, intake-route dimension, `INSIGHT` (partial) |

So the work is **not** "build Part 2". The work is three things:

1. **Close the seam.** German Note currently has *two disconnected worlds* (§1.1) and *its money never reaches the company books* (§1.2). Part 2's workflow is precisely the bridge between them. This is the spine of the project.
2. **Config-ify three hardcoded rule sets** so the founder can change rates without a deploy — using the pattern the app already established for gamification (§3).
3. **Add the genuinely missing pieces** — book procurement, pending pool, batch capacity enforcement.

### The five findings that change the plan

| # | Finding | Impact |
|---|---|---|
| **F1** | **GN net profit is computed on the *quoted* price, which Part 2 §6.1 explicitly says is wrong.** `pnlFrom()` (`german-note-workshops.ts:68`) computes `netProfit = final − totalExp`, where `final` = `finalPriceInrMinor` (billed). Part 2 §6.1: *"Net profit is computed on cash actually collected, not on the quoted amount… Quotation ₹4,17,000 but cash collected ₹3,65,000 → profit is calculated against ₹3,65,000."* | **The headline number on the workshop page contradicts the spec today.** Cheap to fix, but the number moves a LOT — quantified in §6.7 before you approve it. |
| **F2** | **The tutor-fee model is wrong in the code, and the spec doesn't describe it correctly either — resolved against the founder's own workbook (§6.4).** Code: flat per-*level* constants (`A1 ₹7,000`, `A2 ₹8,000`, `B1 ₹12,000`). Spec §5: per-*batch-size* tiers (`≥5 → ₹7,000`, `<5 → ₹8,000`). **The March workbook shows both are incomplete:** A1 is billed ₹7,000 in large batches but **₹8,000 in small ones** (Jitendra/B22, Pragathi/B25, Kruthiga/B22 — all `<5`), while A2 is ₹8,000 and B1 ₹12,000 *regardless* of size. Plus hand-set exceptions (₹4,000 ×1, ₹9,000 ×5, ₹11,000 ×1). | **Was the top blocker; now largely answered from your data.** The true shape is *per-level base + small-batch surcharge on A1 + per-row override*. §6.4 |
| **F3** | **The workshop P&L never touches the ledger.** Nothing writes `Income`/`Expense`/`JournalEntry` when a conversion is created. Workshop revenue, books, tutor COGS and ad spend are invisible to `/finance`, `/cash`, the founder dashboard and the trial balance. The only bridge is an admin hand-keying an `Income` row with a `GN_*` `programLevel`, and the two figures are never reconciled. | The founders dashboard cannot be trusted for GN until this closes. §2.2 |
| **F4** | **Commission is a read-only report that pays nobody.** `getCommissionReport()` derives numbers live from a hardcoded const and **writes nothing**. Payouts are hand-keyed into `TelecallerPayout`, which has no link back to the `Income` that earned them. Editing a rate silently re-prices all history. | The commission engine needs a *stamped grant* layer, not just better maths. §3.3 |
| **F5** | **Marking an instalment PAID registers no cash.** `emi-actions.ts` writes no `Income` and posts nothing. Likewise `recordPayment` (invoices) posts to the ledger but writes no `Income`. | Any workflow keyed off "payment received" fires on an incomplete picture. Appendix ★3/★4. |

### What we recommend rejecting from the spec

- **`LEDGER_ENTRY`** as drawn (flat `kind: income|expense|pending`). The app has a Postgres-trigger-enforced double-entry ledger with a hash-chained audit trail. Adding a third book would be a regression. → Map to `Income`/`Expense` + journal postings.
- **`COMMISSION`/`TUTOR_FEE`/`AD_SPEND`/`AGREEMENT`/`PIPELINE`/`CASH_RUNWAY`** as new tables. All exist. → Extend.
- **Cash-runway `÷ 3`** (spec §8.1). The app deliberately divides by *months that actually have expense data* (`cash-metrics.ts:57`): *"a young business would otherwise dilute burn and overstate runway, silencing the <3/<6-month alerts."* → Keep the app's; expose the divisor as config if the founder insists. §6.1-A4

---

## PART 1 — Functional analysis

### 1.1 The founder workflow, start to finish

Reading the three files together, the workflow is one continuous money pipeline. Mapped against what exists:

```
①  Workshop attendee                          GnWorkshop ✅ / registration funnel ❌
②  Capture name, email, phone, address        GnWorkshopConversion ✅ (all four fields exist)
③  Tag intake: Direct B2 | German Note        ❌ MISSING — GnWorkshopSource is {AD,ORGANIC}, a
    Tag workshop: internal | normal              *channel*, not a *brand route*. No internal/normal flag.
④  Advance token on WhatsApp                  WhatsApp send ✅ / no token record ❌
⑤  Call: which course / time / weekday-weekend  CallLog ✅ / dayType ✅ / times are free text 🟡
⑥  Enough joiners to open a batch?            ❌ MISSING — no pending pool
⑦  Open/fill batch, assign B-number by slot   🟡 GnBatch exists; no number, no slot, no capacity check
⑧  Batch = 8? → stop assigning                ❌ targetStrength exists but is DISPLAY-ONLY
⑨  Track paid / balance / mode / notes / EMI  ✅ PendingPayment + Instalment (landed 16 Jul)
⑩  WhatsApp reminder on next-EMI date         ✅ EMI_PRE_DUE + PAYMENT_REMINDER touchpoints ship
⑪  Book order: up-front ≥₹30k → now; EMI → defer  ❌ MISSING entirely — no BookOrder, no Vendor
⑫  Tutor fee by batch size                    🟡 exists on the wrong axis (F2)
⑬  Gross/net profit, ad spend distributed     ✅ but on the wrong basis (F1) and off-ledger (F3)
⑭  Commission 3/5/8% of cash collected        🟡 exists at different rates, hardcoded, pays nobody (F4)
⑮  Substitute split 20/80                     ❌ MISSING — no such concept anywhere in src/
⑯  Founders dashboard, runway, forex          ✅ FounderPulse + getRunwaySnapshot + FxRate all ship
```

**In one sentence:** steps ①–②, ⑨–⑩ and ⑬–⑯ are built; steps ③, ⑥–⑧, ⑪ and ⑮ are missing; and the joins between them — the arrows, not the boxes — are what this project actually has to build.

### 1.2 The two structural problems

**Problem A — German Note has two disconnected batch worlds.**

| | The relational world | The spreadsheet world |
|---|---|---|
| Tables | `GnBatch` → `GnBatchMember` → `Student` | `GnWorkshopConversion.batchA1/timeA1/…` |
| Type | FKs, cascades, indexes | free-text strings (`"B26"`, `"7:00 AM"`) |
| Powers | classroom, recordings, community, tutors | capacity grid, P&L, conversions-by-level |
| Capacity | `targetStrength` (advisory only) | none |

A converted client is a `GnWorkshopConversion` row with **no FK to `Student`, `GnBatch`, or `User`**. Someone re-keys them into a batch by hand. `capacityGrid()` (`german-note-workshops.ts:300`) reports seats from those strings and knows nothing about `targetStrength`. There are no unique constraints on `GnWorkshopConversion` at all — the same person can be entered twice.

**Problem B — GN money never reaches the company books.** (F3, above.)

**Part 2's workflow is exactly the bridge across both.** Batch assignment (§2) joins world 1 to world 2; the finance flow (§4–6) joins GN to the ledger. That framing drives the whole plan: *this is not a new module bolted onto GN — it is the connective tissue GN was built without.*

### 1.3 Entities, states and transitions

**States that exist and are correct:**
- `GnWorkshopStatus{ACTIVE, ARCHIVED}`, `GnBatchStatus{ACTIVE, ARCHIVED}`
- `GnConversionStatus{CONFIRMED, ON_HOLD}` — note ON_HOLD rows **still flow into every P&L rollup**; only counted separately (`rollup():241`)
- `PendingPaymentStatus{ACTIVE, PAID_IN_FULL, OVERDUE, DROPPED}`, `InstalmentStatus{DUE, PAID, OVERDUE}` — *nothing flips DUE→OVERDUE automatically; there is no cron for it*
- `AgreementStatus`, `JournalEntryStatus{POSTED, VOID}`, `PayoutStatus{PENDING, PAID}`

**States Part 2 needs that don't exist:**
- Conversion lifecycle: `PENDING_POOL → BATCH_ASSIGNED → ACTIVE → COMPLETED`
- Book order: `quoted → ordered → couriered` (spec's `BOOK_ORDER.status`)
- Commission grant: `PENDING → APPROVED → PAID` (`RewardGrantStatus` has this shape; `PayoutStatus` does not)

**Transition rules Part 2 defines that must be encoded:**
1. Batch opens only when fill probability is high; single joiner → pending pool (§2.1)
2. Batch full at 8 → stop assigning, open next number (§2.1)
3. Book order triggers on up-front payment ≥ ~₹30k; EMI defers (§4)
4. Tutor rate switches at batch size 5 (§5)
5. Commission attribution branches on who ran the call (§7.1)

### 1.4 Dependencies between the three documents

- **Application Logic → ER v2:** §16 explicitly names the entities added. But §16 describes a *greenfield* model; ~half already exist under different names. The mapping table in §2.1 below is the authoritative translation.
- **Application Logic → Finance Flow:** the flowchart is a faithful visual of §§1–8. One divergence: the flowchart's `F3{{Basis = CASH COLLECTED}}` gate sits *after* `F2[Net profit]`, implying net profit is recomputed on cash. The code does neither (F1).
- **ER v2 → Finance Flow:** `LEDGER_ENTRY.cash_collected_basis` (a boolean on a row) and the flowchart's basis gate (a global rule) model the same thing two incompatible ways. **The app's answer is better than both:** `Income` *is* cash collected — there is no basis flag to get wrong.
- **All three → the existing app:** the documents were written without reference to the build. Every "new" entity must be checked against §2.1 before a migration is written.

---

## PART 2 — Integration plan

### 2.1 Spec → build mapping (authoritative)

| ER v2 entity | Existing home | Action |
|---|---|---|
| `INTAKE{type, workshop_scope}` | none — `GnWorkshopSource{AD,ORGANIC}` is a channel, not a route | **Two enum columns on `GnWorkshop`/`GnWorkshopConversion`, not a table.** A 2-value lookup with no attributes of its own doesn't earn a join. |
| `AD_SPEND` | `GnWorkshopAdSet` (+reach, clicks, attended, CTR/CPC/ROAS) | ✅ Reuse. Spec is a subset. |
| `LEDGER_ENTRY` | `Income`/`Expense` + `JournalEntry`/`JournalLine` | ✅ Reuse. **Reject the spec's table.** |
| `TUTOR_FEE` | `GN_LEVEL_COST` const + `tutorCostOverrideInrMinor` | 🔧 Config-ify + resolve F2. |
| `COMMISSION_RULE` | `COMMISSION_RULES` const (`commission-metrics.ts:18`) | 🔧 Config-ify (§3.2). |
| `BONUS_RULE` | `RewardRule` + `RewardKind{BONUS, COMMISSION, PERK}` + `RewardGrant` | ✅ **Reuse — this already satisfies §7.2 "user-settable, no code change".** |
| `AGREEMENT` | `Agreement` + `AgreementEvent` + PKI e-sign + PDF + hash chain | ✅ Reuse. Far beyond spec. §10 = auto-fill only. |
| `PIPELINE`/`PIPELINE_STAGE` | `Pipeline`/`PipelineStage`/`Opportunity` | ✅ Reuse. Spec §9's "rules vs drag-drop" is already answered. |
| `CASH_RUNWAY` | `CashPosition` + `getRunwaySnapshot()` | ✅ Reuse. Formula diverges — §6.1-A4. |
| `DASHBOARD_METRIC` | `FounderPulse` + `getFinanceOverview` + `FxRate` | ✅ Reuse. |
| `THEME_PREFERENCE` | ships (dark/light, `#4949EF`) | ✅ Done. |
| `INSIGHT` | `WeeklyFunnelSnapshot`, funnel metrics, ad-set CTR/CPC/ROAS | 🟡 Partial — presentation gap, not a data gap. |
| `BOOK_ORDER` + `VENDOR` | ❌ nothing (`Expense.vendor` is free text) | **NET-NEW.** §2.4 |
| Batch pending pool | ❌ nothing | **NET-NEW.** §2.4 |
| `EMI_PLAN`/`PAYMENT` | `PendingPayment` + `Instalment` | ✅ Reuse. |
| `BATCH` capacity/slot/number | `GnBatch.targetStrength` (advisory) | 🔧 Enforce + add slot/number. |

### 2.2 Architectural fit

The module is **not** new top-level surface. It is (a) new columns and two new tables inside German Note, (b) a promotion service that joins GN to the core domain, and (c) a posting bridge that joins GN to the ledger.

```
  ┌──────────────────── /german-note (extended) ─────────────────────┐
  │  Workshops ──▶ Conversions ──▶ [NEW] Promotion service           │
  │      │              │                    │                        │
  │      │              │                    ├──▶ Student (existing)  │
  │      │              │                    ├──▶ PendingPayment ─┐   │
  │      │              │                    ├──▶ GnBatchMember   │   │
  │      │              │                    └──▶ Agreement       │   │
  │      │              │                                         │   │
  │      │              └──▶ [NEW] Batch assignment engine        │   │
  │      │                      (pending pool, capacity, slots)   │   │
  │      │                                                        │   │
  │      └──▶ AdSets ──┐                                          │   │
  └────────────────────┼──────────────────────────────────────────┼───┘
                       │                                          │
                       ▼                                          ▼
              [NEW] GN posting bridge  ────────────▶  Income / Expense (existing)
                       │                                          │
                       │                                          ▼
                       │                              postEntry() → JournalEntry ✅
                       │                                          │
                       ▼                                          ▼
              [NEW] Commission engine ───────────▶  CommissionGrant [NEW] → TelecallerPayout
                       │
                       ▼
              /finance · /cash · FounderPulse  (existing — now finally fed by GN)
```

**Reuse (do not rebuild):** the double-entry ledger + `postEntry`/`postEntryOnce`/`voidEntryForSource`; `Income`/`Expense`; `PendingPayment`/`Instalment`; `Agreement` + e-sign + PDF; `RewardRule`/`RewardGrant`; `getRunwaySnapshot`; `FxRate`/`getTodayInrPerEur`; `sumAgg`/`aggInrMinor`; the RBAC pair (`requireSection`/`capabilityCheck`); the founder-config triad; WATI + `runDueReminders`; `AuditEntry`.

**Build new:** intake-route columns; batch slot/number/capacity; pending pool; `BookOrder` + `Vendor`; GN→ledger posting bridge; `CommissionGrant`; the config documents (§3.2); workshop provisioning + cost snapshot (§3.5); `SEND_WHATSAPP` workflow action.

### 2.3 Backend changes

**New services** (`src/server/`):
| Module | Responsibility |
|---|---|
| `gn-promotion.ts` | `promoteConversion(conversionId)` — one transaction: `Student` upsert → `PendingPayment` (+`Instalment` via existing `generateInstalmentPlan`) → `GnBatchMember` → optional `Agreement` draft. **The bridge across Problem A.** |
| `gn-batch-assignment.ts` | pending pool, capacity check, next-batch suggestion, slot grid |
| `gn-posting.ts` | conversion/adset/tutor-fee/book-cost → `Income`/`Expense` + `postEntryOnce`. **The bridge across Problem B.** |
| `commission-engine.ts` | rule resolution, attribution, `CommissionGrant` derivation (idempotent) |
| `book-orders.ts` | quote → order → courier; publisher WhatsApp |

**New pure libs** (`src/lib/`, zod-free — client panels import these):
`gn-batch-policy.ts`, `commission.ts`, `gn-cost-model.ts` (replaces the `GN_LEVEL_COST` const), `book-order-policy.ts`.

**Modified:**
- `gn-workshop-pricing.ts` — `GN_LEVEL_COST` const → effective-dated config read; **keep the const as the shipped default**
- `german-note-workshops.ts` — `pnlFrom()` basis fix (F1); read costs from config
- `commission-metrics.ts` — hardcoded const → config; report reads `CommissionGrant`
- `emi-actions.ts` — mark-PAID must create `Income` (F5); align guard to `capabilityCheck("finance.write")`
- `chart-of-accounts.ts` — new codes: `5010 COGS — Books & materials`, `5020 COGS — Tutor fees`, `6021 Commissions — telecaller`. **`AccountCode` is a literal-union type — new codes must be added here to typecheck, then `npm run db:ledger`.**
- `automation-types.ts` + `automation.ts` — add `SEND_WHATSAPP`

### 2.4 Database changes

**New tables (4):**

```prisma
model Vendor {            // publisher / courier
  id, name, kind: VendorKind{PUBLISHER, COURIER, OTHER}, phone?, email?, notes?, archived
}

model BookOrder {
  id, conversionId? → GnWorkshopConversion, studentId? → Student
  vendorId? → Vendor                    // nullable: the founder may message a publisher not yet on file
  levels String[]                       // A1/A2/B1 — price scales with level count (§4)
  shipAddress, shipPhone
  quotedInrMinor BigInt @default(0)     // publisher's quote
  paidInrMinor   BigInt @default(0)     // what we paid the publisher
  // NEEDS_FOUNDER_ACTION is the interim state (§4.4): the app has prepared the publisher
  // message and is waiting for the founder to send it by hand and confirm.
  status BookOrderStatus{PENDING_TRIGGER, NEEDS_FOUNDER_ACTION, QUOTE_REQUESTED, QUOTED, ORDERED, COURIERED, CANCELLED}
  publisherMessage String?              // rendered copy-ready text the founder sends (nullable until triggered)
  founderActionedAt DateTime?           // stamped when the founder marks "sent"
  founderActionedById String? → User    // who sent it
  courierTracking?, orderedAt?, courieredAt?
  expenseId? → Expense                  // the posting link — set when we pay
}

model GnBatchSlot {       // the timetable §2.1 needs and GnBatch lacks
  id, batchId → GnBatch
  dayType GnWorkshopDayType             // reuse existing {WEEKDAY, WEEKEND}
  startTimeMins Int                     // IST minutes-of-day — sortable, no tz ambiguity
  @@unique([batchId])
}

model CommissionGrant {   // F4 — the stamped layer between report and payout
  id, incomeId → Income, teamProfileId → TeamProfile
  roleOnDeal CommissionRole{SETTER, DISCOVERY, CLOSER, SUBSTITUTE}
  rulesetId String                      // WHICH ruleset priced this
  pct Decimal(6,3)                      // STAMPED — edits never re-price history
  basisInrMinor BigInt                  // the cash it was computed on
  amountInrMinor BigInt
  substituteForId? → TeamProfile        // §7.1 cover split
  status RewardGrantStatus              // reuse: PENDING|APPROVED|DECLINED|PAID
  payoutId? → TelecallerPayout          // closes the loop
  @@unique([incomeId, teamProfileId, roleOnDeal])   // idempotent re-derivation
}
```

**Modified tables:**
```prisma
GnWorkshop          + intakeRoute IntakeRoute{DIRECT_B2, GERMAN_NOTE}
                    + scope WorkshopScope{INTERNAL, NORMAL}
                    + costModelSnapshot Json    // §3.5 — rate card frozen at creation so a later
                    //                              global change never re-prices this workshop's P&L
                    + templateId String?         // which gnWorkshopTemplate it was instantiated from
GnWorkshopConversion+ studentId?  → Student        // ← closes Problem A
                    + batchA1Id? / batchA2Id? / batchB1Id? → GnBatch
                    + placementStatus GnPlacementStatus{PENDING_POOL, ASSIGNED, ACTIVE, COMPLETED}
                    + tokenAmountInrMinor BigInt @default(0)   // §1 advance token
                    + incomeId? → Income           // ← closes Problem B
                    + @@unique([workshopId, phone])            // ← stops duplicate keying
GnBatch             + batchNumber Int?  @unique    // "B26" — §2.1 sequential-but-strategic
                    + maxStrength Int @default(8)  // ENFORCED (targetStrength stays advisory)
Enrollment          + substituteCloserId? → User   // §7.1 cover
TelecallerPayout    + commissionGrants CommissionGrant[]   // traceability
```

**Migration strategy.** All additive — every new column nullable or defaulted; no existing column changes type or drops. Sequence:
1. Additive migration (safe on a live DB, no backfill required to deploy)
2. Backfill script `scripts/backfill-gn-conversions.ts` — fuzzy-match existing conversions → `Student` by `nameKey()` (the same normaliser `finance-metrics.ts:21` and `german-note-actions.ts:184` already use), **report-only first**, then apply with an explicit `--commit` flag
3. Free-text `batchA1` → `batchA1Id`: match against `GnBatch.name`; unmatched values stay in the string column. **Keep both columns for one release** — the strings are the historical record and the migration is lossy by nature
4. Ledger backfill: post historical GN conversions via `postEntryOnce` (idempotent by `(sourceType, sourceId)`), mirroring `prisma/seed-ledger.ts`. **Guard behind a period-lock check** so it can't restate closed months.

> ⚠️ **`PeriodLock` has no UI and no server action** — engine + trigger only. If GN money is going to hit the ledger, month-close needs to become real. Add to Phase 1.

### 2.5 Frontend changes

All inside `/german-note`, extending the existing `<Tabs>` shells:

| Surface | Change |
|---|---|
| `manage/page.tsx` | Batches tab: capacity meter (`n/8`), slot editor, batch number. **New "Pending pool" tab** — unassigned joiners + "suggest batch" CTA |
| `workshops/[workshopId]/page.tsx` | Conversions table: `placementStatus` chip, "Promote → Student" CTA, intake-route + scope selectors. P&L block: **basis toggle (cash vs billed)** surfacing F1 explicitly. **New "Books" tab** → book orders |
| `[batchId]/page.tsx` | Slot + capacity in header; roster shows payment status |
| `/console` | **New tabs: Commission rules · GN cost model · Batch policy · Book-order policy · Workshop template** — the config documents (§3.2) |
| `/finance` | Commission tab reads `CommissionGrant`; approve/pay actions |
| `/` (FounderPulse) | GN revenue finally appears once §2.3 posting lands — **no code change needed**, which is the point |

**Design system:** `--on-accent` not `text-white`; program colours are fills-not-text; dark + light both ship (per `docs/DESIGN_SYSTEM.md`). Money renders via `formatInrMinor` — never hand-rolled.

### 2.6 RBAC

**No new roles.** Part 2's L1/L2/L3 are *deal positions*, not identities — the app correctly models them as attribution (`Lead.assignedToId`, `DiscoveryOutcome.enteredById`, `Enrollment.closerId`), and `CommissionGrant.roleOnDeal` continues that.

| Capability | Status | Guards |
|---|---|---|
| `finance.write` | exists | GN posting bridge, book-order payment |
| `rewards.approve` | exists | commission grant approve/pay |
| **`commission.configure`** | **new** | commission ruleset edits |
| **`gn.costs.configure`** | **new** | GN cost model edits |

All default `roles: ["ADMIN"]`. **Head must NOT get finance/commission access** — the Phase 2/3 PRD role tables supersede Phase 1 here, and the current lock-out is correct, not a bug.

Pattern is fixed and non-negotiable (`rbac.ts`): pages `await requireSection(k)` / `requireCapability(k)` (redirect); actions `const {allowed, denied} = await capabilityCheck(k); if (!allowed) return denied;` (return, never redirect). **Every action re-guards — a page guard does not protect a server action.**

> **Config writes that move money must append `AuditEntry`.** `AppSetting` has only `updatedAt` — no actor, no history, destructive overwrite. `AuditEntry` (hash-chained, append-only) exists but **`ledger-core.ts` is its only writer today**. Changing a commission rate is exactly the case it was built for. New gap to close.

### 2.7 Event flow

```
Conversion created
  └─▶ promoteConversion()  [tx]
        ├─▶ Student upsert
        ├─▶ PendingPayment + Instalment[]
        ├─▶ GnBatchMember  ──[capacity check]──▶ pending pool if full/short
        ├─▶ Agreement draft (auto-filled — §10)
        └─▶ emitTrigger("GN_CONVERSION_PROMOTED")   ← NEW TriggerType

Payment received (Income created)
  └─▶ [tx] income.create → postEntry() → appendAudit()
        ├─▶ deriveCommissionGrants(incomeId)   ← idempotent, stamped
        ├─▶ evaluateBookOrderTrigger()         ← ≥₹30k up-front → order now; EMI → defer
        │      └─ dispatchMode="remind_founder" (default): BookOrder → NEEDS_FOUNDER_ACTION,
        │         emits a founder notification with the copy-ready publisher message.
        │         Founder sends by hand, marks sent → ORDERED. (auto_send skips the human.)
        └─▶ emitTrigger("PAYMENT_RECEIVED")    ← NEW TriggerType

Cron /api/cron/whatsapp  (every ~15 min, external)
  ├─▶ EMI_PRE_DUE / PAYMENT_REMINDER          ← already ship
  └─▶ [NEW] BOOK_DISPATCHED, BATCH_ASSIGNED, PENDING_POOL_HOLD
```

> ⚠️ **`TriggerType` is a Prisma enum with exactly 6 values** — adding one is a migration + a union in `automation-types.ts` + a `TRIGGER_LABELS` entry + an `emitTrigger` call site.
>
> ⚠️ **There is no clock.** `emitTrigger` runs *inline in the request*; delayed work waits on an external cron hitting an HTTP route. BullMQ is used as a delayed-job store with **no worker process**. Nothing self-wakes. Every scheduled step below inherits: *no HTTP request → no execution.*

---

## PART 3 — Dynamic workflow design

### 3.1 The established pattern (copy it exactly)

The app already solved "founder changes rules without a deploy". `src/lib/config-schema.ts:1-13` states the contract:

> *Read path: `coerce*(json)` — a row that doesn't parse falls back to the shipped defaults rather than crashing the app. Write path: `*Schema.safeParse(input)` — the server action refuses to persist anything that wouldn't survive the read.*
>
> *zod lives ONLY here and in server modules. `gamification.ts` and `sections.ts` stay dependency-free so client components can import them without pulling zod into the browser bundle.*

Four parts, one direction:

```
src/lib/<domain>.ts       pure rules + DEFAULT_* + evaluate()   ← zod-free, client-importable
src/lib/config-schema.ts  <domain>Schema + coerce<Domain>()     ← zod lives here
src/server/founder-config.ts   get<Domain>() [cache()] / write<Domain>()  ← AppSetting upsert
src/server/console-actions.ts  save<Domain>(form)               ← requireAdmin + re-parse + revalidate
src/app/(app)/console/         a <Tabs> panel
```

**Laziness is the rule:** no `AppSetting` row = shipped defaults. Reset = delete the key, not write a default blob.

### 3.2 The config documents

| Key | Shape | Replaces |
|---|---|---|
| `commissionRulesets` | effective-dated `{id, effectiveFrom, roles[{role, pct}], substituteSplit{coverPct, ownerPct}, basis}` | `COMMISSION_RULES` const |
| `gnCostModel` | effective-dated — see below | `GN_LEVEL_COST` const |
| `gnBatchPolicy` | `{maxStrength, minToOpen, poolHoldDays, slotTaxonomy[]}` | hardcoded 8 |
| `bookOrderPolicy` | `{dispatchMode: "remind_founder" \| "auto_send", upfrontTriggerInrMinor, careerChargeInrMinor, deferOnEmi, reminderRepeatHours, publisherMessageTemplate}` | nothing |
| `gnWorkshopTemplate` | `{products[], defaultAdSets[], defaultDayType, defaultScope}` + points at the live `gnCostModel` | hardcoded workshop structure (§3.5) |

**`dispatchMode` is the flexibility you asked for, made explicit.** It ships defaulting to `"remind_founder"` — the app prepares the publisher message and nudges the founder to send it by hand (§4.4), which is the interim reality. The day the founder trusts it, flipping the single config value to `"auto_send"` turns on the automated publisher send **with no code change and no deploy** — the send path is built either way, the config just decides whether a human is in the loop. Same escape hatch every other rule in this doc uses. The threshold, the career charge, the reminder cadence and the message body are all in the same config document, so none of them is a code change either.

**`gnCostModel` — the shape the workbook actually implies (§6.4):**

```ts
{
  id, effectiveFrom,
  books:  { A1: 130000, A2: 130000, B1: 130000 },        // paise
  tutor:  {
    base:            { A1: 700000, A2: 800000, B1: 1200000 },  // per-level base
    smallBatchRule:  { threshold: 5, rate: 800000, appliesTo: ["A1"] },
    //               ↑ a batch under `threshold` bills `rate` instead of base.
    //                 Observed on A1 only; A2/B1 never move with size in the sheet.
  },
}
```
Per-row overrides (`tutorCostOverrideInrMinor`) already exist and stay — the workbook's ₹4,000/₹9,000/₹11,000 rows are exactly that, and the model should not try to explain them. **`appliesTo` is the honest encoding:** it fits the observed data without asserting a rule for A2/B1 that the data doesn't support, and widening it later is a config edit, not a migration.

### 3.3 The three patterns that make this durable

**① Effective-dated rulesets — the answer to retroactive re-pricing.** Already implemented for gamification (`lib/gamification.ts:444`), and it is the *only* existing answer:

```ts
/** The ruleset in force on `dateKey` — the last one that had started by then. */
export function rulesetFor(config, dateKey) {
  const all = sortedRulesets(config);
  let match = all[0];
  for (const r of all) if (r.effectiveFrom <= dateKey) match = r;
  return match;
}
```
Copy this shape verbatim for `commissionRulesets` and `gnCostModel`. **Today, editing `closerPct` re-prices every historical commission, and editing `GN_LEVEL_COST` retroactively rewrites every workshop P&L ever rendered.** Both are silent. Effective-dating is what stops that.

**② Stamp at grant — never re-price history.** The rule the codebase states three separate times (`schema.prisma:2142`, `telecaller-actions.ts:104`, `finance-actions.ts:137` — *"edits fix typos, they don't re-price history"*). `CommissionGrant` stamps `pct`, `basisInrMinor`, `rulesetId`. A later rule edit cannot touch a grant already made.

**③ Idempotent re-derivation.** `@@unique([incomeId, teamProfileId, roleOnDeal])` + `createMany({skipDuplicates: true})` — the exact shape `rewards.ts:12-23` uses. Re-running the engine is safe; nobody gets paid twice.

**Plus: discriminated-union-in-JSON with a lenient read.** `rewardTriggerSchema` + `parseRewardTrigger` (`config-schema.ts:225`) is the template for a rule DSL, with the failure mode already designed: *"A trigger that no longer parses (a metric was renamed in code) disables its rule rather than throwing — the founder sees it flagged in the console instead."*

### 3.4 Reusability for future business units

`GnWorkshop` is already a per-cohort container. Adding `intakeRoute` makes it a per-*brand* container. A second business unit needs: a new `IntakeRoute` value, its own effective-dated rulesets scoped by route, and its own chart-of-accounts income code. **No new tables, no new engine.**

Deliberate boundary: keep the engine generic; keep the *vocabulary* shared. `goals.ts:8-12` says why — *"the founder learns 'deals won' once, and it means the same thing whether they're setting a target, minting a badge, or paying a bonus."* A commission engine with its own private notion of "converted" would break that. **The codebase already documents three competing definitions of "converted"** (`telecaller-desk-metrics.ts:8-22`: gamification credits whoever clicked the stage; commission credits on payment; the desk asks "did the lead I worked convert?"). **Pick one deliberately and write down why.**

### 3.5 Workshop creation — fully native, templated, snapshotted

**Founder decision (17 Jul): workshop management is entirely in-app. The Google Sheets workbooks are *replaced*, not synced.** No spreadsheet is ever created, imported, or exported — creating a workshop provisions its whole workspace as native app data and screens. This section is how "create a workshop → its workspace is ready" is built correctly.

**What already works.** `createWorkshop` (`german-note-workshop-actions.ts:71`) writes the `GnWorkshop` row, and the detail page (`workshops/[workshopId]/page.tsx`) already renders the full native workspace the moment it exists: the conversions table, the ad-set funnel, the P&L rollup, conversions-by-level, and the capacity grid. The derived views (P&L, capacity, by-level) compute themselves from the rows entered. So the workspace is *structurally* auto-created today — the gaps are that it's bare, its structure is hardcoded, and its P&L is not self-contained.

**Three gaps creation must close:**

1. **Provision defaults, not an empty shell.** `createWorkshop` currently writes only the row — no ad-set, none of the Part 2 intake fields. It should scaffold a default ad-set (so the funnel isn't empty) and set `intakeRoute` / `scope` (§2.4). Sensible starting state, ready to fill.

2. **Snapshot the cost model onto the workshop — this is a correctness fix, not a nicety.** Today every workshop's P&L derives from the *current global* `GN_LEVEL_COST` const, so changing a tutor rate silently re-prices every past workshop (the exact history-rewrite trap catalogued in `FLEXIBILITY_AUDIT.md` §4). A workbook never did that — March's numbers stayed March's. So `createWorkshop` stamps `costModelSnapshot` = the `gnCostModel` in force on the workshop's month (via `rulesetFor`, §3.3), and the P&L reads the *workshop's snapshot*, not the live card. Per-row overrides (`booksCostOverrideInrMinor`/`tutorCostOverrideInrMinor`) still win on top. This makes each workshop's workspace self-contained and frozen, the way a closed period should be.

3. **Instantiate from a template, so structure is dynamic.** The products (A1/A2/B1/bundles), the columns, the default ad-sets, and which cost model to snapshot all come from the `gnWorkshopTemplate` config doc (§3.2) rather than code. `createWorkshop` *instantiates* the template. Result: a different month, a second brand, or a new business unit gets a different workspace shape **by editing config, not code** — the same "flexible now, no deploy later" contract as every other rule in this doc.

**The flow:**
```
createWorkshop(name, month, intakeRoute, scope, templateId?)   [one transaction]
  ├─ resolve template   = gnWorkshopTemplate (or the default template)
  ├─ resolve cost model = rulesetFor(gnCostModel, month)          ← effective-dated pick
  ├─ GnWorkshop.create({ …, costModelSnapshot: <frozen rates>, templateId })
  └─ adSets.createMany(template.defaultAdSets)                    ← workspace ready, not empty
  → open workshop → native conversions / ad-set / P&L / capacity views render immediately
```

**Net:** creating a workshop is one in-app action that yields a complete, self-contained, config-shaped native workspace — no spreadsheet anywhere in the loop, and no risk of a later rate change rewriting a workshop that's already closed.

### 3.6 Batch assignment & the pending pool

This is Part 2 §2 — the scheduling core, and the hardest single mechanism in the project because the spec's rule is a **judgement call, not an algorithm**: *"assign numbers only to batches that can realistically fill; a single joiner waits in a pending pool until enough accumulate."* The design principle that follows from that is **suggest + confirm, never auto-assign** — the app does the arithmetic and proposes; the human decides.

**The historical data says this is a frequent state, not an edge case.** Replaying the March + May workshops: **17** distinct batch-number+slot groups, sizes `[12, 7, 7, 5, 5, 5, 5, 4, 3, 3, 3, 2, 1, 1, 1, 1, 1]` — **5 singletons** (29%) that under the spec would sit in the pending pool, **10 of 17 short of 5**, and one slot at **12** (proof the "max 8" was never enforced — matches the `targetStrength`-is-advisory finding). Batch numbers used: `B07 B08 B09 B16 B17 B18 B19 B20 B21 B22 B23 B24 B25 B26 B27 B28` — **sequential with deliberate gaps** (B10–B15 skipped), exactly the "opened by fill-probability, not arrival order" pattern §2.1 describes. So: the pending pool must be a first-class state, capacity must be enforced (something has to stop the next "12"), and batch numbers are strategic, not auto-incremented.

**The model (from §2.4, restated here in context):**
- `GnBatch.batchNumber Int? @unique` — the "B26". Assigned when a batch is *opened*, not on create; nullable so a forming batch can exist number-less.
- `GnBatch.maxStrength Int @default(8)` — **enforced** (distinct from advisory `targetStrength`). The cap that stops the next 12-seat pile-up. Comes from `gnBatchPolicy.maxStrength` so it's config, not code.
- `GnBatchSlot { dayType, startTimeMins }` — the timetable `GnBatch` lacks; a batch is keyed to a weekday/weekend slot + IST time.
- `GnWorkshopConversion.placementStatus { PENDING_POOL, ASSIGNED, ACTIVE, COMPLETED }` + `batchA1Id/A2Id/B1Id → GnBatch` — the FK link that finally joins the conversion world to the real batch world (Problem A, §1.2).

**The pending pool is a *state*, not a table.** A conversion whose level hasn't been placed sits in `PENDING_POOL`; querying "the pool" is `placementStatus = PENDING_POOL` filtered by level+slot. No new table — consistent with how the app models such things (e.g. the notification feed is computed, not stored).

**The engine — `gn-batch-assignment.ts`, all suggest+confirm:**

```
For each level a conversion bought (bundle = one placement per level, independently):
  candidates = GnBatch{ level, slot matches dayType+time, status ACTIVE, memberCount < maxStrength }
  ├─ a candidate exists            → SUGGEST "add to B26 (5/8)"        → human confirms → ASSIGNED
  ├─ none, but pool has ≥ minToOpen at this level+slot
  │                                → SUGGEST "open a new batch (N waiting)" → human confirms number → opens + assigns
  └─ none, and pool < minToOpen    → hold in PENDING_POOL, fire gn_pending_pool_hold (§4.3)
Capacity guard: a batch at maxStrength is never suggested; the engine proposes the NEXT batch number instead.
```

- **Bundle students split across states.** An A1+A2+B1 buyer can be `ASSIGNED` for A1 (that batch is filling) yet `PENDING_POOL` for B1 (no B1 cohort yet). Placement is **per level**, tracked on the three `batchXId` columns — which is also why the capacity grid counts a bundle as one seat per level.
- **Next-batch-number suggestion is `max(batchNumber) + 1`, but the human confirms** — the historical gaps (B10–B15) exist precisely because numbers were opened out of order by judgement. The app proposes the obvious next; the founder can override. Never silent auto-increment.
- **"Realistically fill" is the one thing the app won't decide.** It surfaces the signal (how many are waiting at this slot, how close to `minToOpen`) and lets the human pull the trigger. Getting this wrong strands students, so the rail is deliberate.

**Config — `gnBatchPolicy` (§3.2):** `maxStrength` (the enforced cap), `minToOpen` (how many waiting before "open a batch" is suggested), `poolHoldDays` (how long before a pending joiner escalates to a founder nudge), `slotTaxonomy` (the allowed day/time slots). All editable without a deploy; a second brand or a change from "8" to "10" is a config edit.

**The notifications close the loop (reusing §4.4's pattern):**
- A joiner entering `PENDING_POOL` fires `gn_pending_pool_hold` — *"not enough joiners yet, we'll place you soon"* — which **stops the silence that churns a single joiner**, the exact failure §2.1 warns about.
- A joiner still pooled past `poolHoldDays` becomes a **founder attention-feed item** (computed notification, `notifications.ts`) — *"3 people waiting at A1 weekday 7 AM for 9 days — open a batch?"* — turning the judgement call into a prompt rather than something to remember.
- A batch reaching `maxStrength` fires a founder nudge — *"B26 is full; open B29?"*

**Migration reality (the historical mess):** the free-text `batchA1="B26"` strings reconcile to `GnBatch.batchNumber` where they match; unmatched strings stay in the legacy column for one release (the migration is lossy by nature, §2.4). The one slot with **12** seats can't be split retroactively without inventing history — it's imported as a single over-cap batch and flagged, not silently "fixed". Enforcement applies going forward only.

**Net:** the pending pool becomes visible and actionable instead of living in someone's head; capacity is enforced so no batch silently hits 12; batch numbers stay strategic (suggested, human-confirmed); and a bundle student is correctly placed level-by-level. The app does the counting and the reminding; the founder keeps the judgement — the same assistive-then-automatable shape as the book-order flow.

---

## PART 4 — Templates & notifications

### 4.1 What exists

| Store | State |
|---|---|
| `MessageTemplate` table (Email/SMS) | **EMPTY.** Nothing seeds it. Runtime-created only, via Conversations UI. |
| `DEFAULT_TEMPLATE_MAP` (WATI kind→template) | **`{}` — deliberately.** *"an unmapped touchpoint never sends"* |
| WATI live account (`MessageTemplate.json`) | **119 templates** — workshop/webinar broadcasts: `gn_webinar_*`, `gn_workshop*`, `german_note_*`, `workshop_attended_follow_up_1..3`, `workshop_absent_followup_1..3`, `summit_promo_1..7`, `new_chat_v1` |
| SOP templates (`whatsapp-submission.ts:105`) | 9 defined in code, **0 submitted to WATI** (`grep b2_sop MessageTemplate.json` → 0 hits) |
| `WhatsAppKind` | 22 values — includes `PAYMENT_REMINDER`, `EMI_PRE_DUE`, `AGREEMENT_SEND/OTP/REMINDER` |

> **Part 2 §14 says "69 message templates exist". The live export contains 119.** Discrepancy to confirm — 69 may be a stale count, or a subset (e.g. approved-only). Doesn't block, but the founder's mental model and the account disagree.

**Three placeholder syntaxes coexist** — do not unify them casually, each fails differently:
| Layer | Syntax | Missing-value behaviour |
|---|---|---|
| Email/SMS (`messaging.ts:12`) | `{{name}}` — hardcoded 4-token allowlist | renders `""` → *"Hi ,"* (fails open) |
| SOP (`outreach-sop.ts:45`) | `[Prospect's First Name]` (U+2019!) | `unresolvedVars()` **blocks the send** (fails closed) |
| WATI (`wati.ts:156`) | `{{var}}` by declared name | skips with an explanatory row |

### 4.2 Are the existing templates sufficient? **No.**

Sufficient already: **EMI/payment reminders** (§3 — `EMI_PRE_DUE` + `PAYMENT_REMINDER` ship, including *"#2 of 3"* sequencing) and **agreements** (§10 — `AGREEMENT_SEND`/`OTP`/`REMINDER` ship).

Missing: everything in §§1, 2, 4 and 11 — the token, the batch, the books, the recordings.

### 4.3 New templates required

| Template name | Trigger | Channel | Variables | Purpose | Spec |
|---|---|---|---|---|---|
| `gn_token_ack` | advance token recorded | WhatsApp | `name, amount, workshop, next_step` | Acknowledge advance token | §1 |
| `gn_course_confirm` | course/time/day confirmed on call | WhatsApp | `name, course, day_type, time` | Confirm what they chose | §1 |
| `gn_batch_assigned` | `GnBatchMember` created | WhatsApp | `name, batch_number, level, day_type, time, start_date, tutor` | The batch is open | §2 |
| `gn_pending_pool_hold` | conversion → `PENDING_POOL` | WhatsApp | `name, level, day_type, expected_window` | *"Not enough joiners yet"* — **stops the silence that makes a single joiner churn** | §2.1 |
| `gn_publisher_order` | `BookOrder` → `NEEDS_FOUNDER_ACTION` (interim) / `QUOTE_REQUESTED` (auto) | WhatsApp | `student_name, address, phone, levels, books_list` | The publisher message. **Interim: rendered into `BookOrder.publisherMessage` for the founder to copy-send** (not auto-sent). Flips to auto-send via `dispatchMode`. §4.4 | §4 |
| `gn_books_dispatched` | `BookOrder` → `COURIERED` | WhatsApp | `name, courier, tracking, eta` | Books are on the way | §4 |
| `gn_recording_posted` | `GnRecording` created | WhatsApp | `name, batch_number, class_date, title` | Replaces the tutor pasting links by hand | §11 |
| `gn_tutor_fee_statement` | month close | Email + PDF | `tutor_name, month, batches[], levels[], students_count, rate, total` | Internal — tutor payout | §5 |
| `gn_commission_statement` | grant approved | Email + PDF | `member_name, month, deals[], basis, pct, amount` | Internal — telecaller payout | §7 |
| `gn_workshop_pnl_digest` | month close | Email + PDF | `workshop, revenue, cash_collected, cogs, ads, gross, net, np_pct` | Internal — founder digest | §6 |

**`gn_publisher_order` is architecturally new.** Every existing WhatsApp touchpoint targets a lead/student and resolves the number from `lead.phone`/`student.phone`; `WhatsAppOptOut` is keyed by phone. A vendor is neither. It needs `Vendor.phone` as an explicit recipient and must **bypass the student opt-out list** (a publisher opting out of order messages would silently break procurement). Flag for design. **In interim mode this seam isn't exercised at all** — the founder sends from their own WhatsApp, so the vendor-recipient / opt-out-bypass work can be deferred until `dispatchMode` flips to `auto_send`.

### 4.4 Interim: remind the founder, don't auto-message the publisher

**Decision (founder, 17 Jul): for now the app must *remind the founder* to send the publisher message by hand, and this whole section must stay flexible.** This is the right call — it matches how the Outreach SOP already works (a step surfaces as *due* with its text ready, a human sends it and marks it done) and it defers the one genuinely new/risky seam (vendor-addressed WhatsApp) until the flow is trusted.

**The mechanism reuses infrastructure that already exists — nothing new is built for the reminder itself:**

- **The reminder is a computed notification.** `computeNotifications(role, userId)` (`notifications.ts:130`) already derives the founder's "attention feed" live from DB state — overdue money, red flags, GN community activity — with a clean `{ severity, title, body, href }` shape (`:23`), rendered risk-first in `FounderPulse` (`:271-272`). A book order sitting in `NEEDS_FOUNDER_ACTION` becomes one more computed source: it surfaces as a `risk`/`watch` card — *"Send book order to the publisher for Meghna Suresh (A1+A2+B1)"* — deep-linking (`href`) to the order. No stored reminder rows, no read-state, no new table, consistent with every other notification.
- **The message is pre-rendered and copy-ready.** `evaluateBookOrderTrigger` renders `bookOrderPolicy.publisherMessageTemplate` (student name, address, phone, levels, book list) into `BookOrder.publisherMessage`. The founder opens the order, copies the text, sends it from their own WhatsApp, and clicks **"Sent"** → the order advances to `ORDERED` (`founderActionedAt`/`ById` stamped). One button, no retyping — the app removes the *lookup-and-compose* toil, the founder keeps the *send*.
- **A pre-due nudge, so it isn't missed.** The existing WhatsApp reminder cron (`runDueReminders`) already walks payment/EMI touchpoints; a `BOOK_ORDER_DUE` touchpoint can nudge the founder (in-app, or to their own number) on `reminderRepeatHours` until the order is marked sent — reusing the same throttle/cadence machinery, not a new scheduler.

**Why "flexible/dynamic" is satisfied structurally, not just promised:**

1. **`dispatchMode` is a one-value flip.** `"remind_founder"` (default) → the human-in-the-loop flow above. `"auto_send"` → the same trigger sends `gn_publisher_order` to the vendor directly. Both paths are built; config picks. No code change, no deploy — the exact escape hatch §3 mandates for every rule.
2. **Everything about the step is config, not code:** the trigger threshold (`upfrontTriggerInrMinor`), the career charge, the EMI-defer switch, the reminder cadence, *and the publisher message text itself* all live in `bookOrderPolicy`. The founder can reword the publisher message, move the threshold, or change how often they're nudged — none touches the codebase.
3. **Reusable by future business units.** A second brand/publisher is a new `Vendor` row + its own `bookOrderPolicy` values; the engine, the reminder, and the notification are shared. Same principle as the commission and cost-model engines.

This makes the book section start as **assistive** (the app does the remembering and the drafting; the founder does the sending) and become **autonomous** later by config alone — which is precisely the "flexible now, automated when ready" the founder asked for.

### 4.5 The blocker

**Marketing-category templates need Meta approval (days, not hours), and none of these exist in the WATI account yet.** `npm run docs:whatsapp` regenerates the submission pack (`WhatsApp_Templates_for_Approval.docx`). Two known rejection risks already flagged in `outreach-sop.ts` — adjacent variables (`{{name}}\n{{sender}}`) and a body ending on a variable — apply to the new set too.

**Submit templates in Phase 1, not Phase 6.** The approval clock is the longest lead time in this project and it is fully parallelisable. This is the single highest-leverage scheduling decision in the roadmap.

**Also required for §14's "automate the sends":** the workflow engine **cannot send WhatsApp today** — `MessageChannel` has no `WHATSAPP` member and `WorkflowActionType` has no `SEND_WHATSAPP`. Either add the action (recommended — config-driven, matches §14's intent) or hardcode touchpoints into `runDueReminders` (faster, less flexible, more debt).

---

## PART 5 — Implementation roadmap

> Estimates are relative sizing, not calendar commitments.

### Phase 0 — Decisions & unblocking *(days, parallel with everything)*
| | |
|---|---|
| **Tasks** | Resolve the §6.1 blockers (esp. **F2 tutor-fee axis** and **F1 basis fix**). Draft + submit the 10 WhatsApp templates to Meta. Confirm the 69-vs-119 template count. |
| **Depends on** | Founder availability |
| **Risk** | **F2 unresolved blocks Phase 5.** Mitigated by the `tutor.mode` union (§3.2) — ship both readings, default to today's behaviour. |
| **Output** | Signed-off decision log; templates in Meta review |

### Phase 1 — Database *(M)*
| | |
|---|---|
| **Tasks** | Additive migration (4 tables + ~12 columns). New account codes + `npm run db:ledger`. Backfill script (report-only → `--commit`). **`PeriodLock` UI + action** (§2.4 ⚠). |
| **Depends on** | Phase 0 |
| **Risk** | Backfill name-matching is fuzzy — two students sharing a name cross-credit. `finance-metrics.ts:65` already documents this trap: *"id-linked rows NEVER fall back to name matching."* Report-only first. |
| **Output** | Migration; backfill report; period-lock UI |

### Phase 2 — Config layer *(M)*
| | |
|---|---|
| **Tasks** | 4 pure libs + 4 zod schemas + 4 reader/writer pairs + 4 console panels + 2 new capabilities. Wire `AuditEntry` into config writes. |
| **Depends on** | Phase 1 |
| **Risk** | Effective-dating must land **before** any rate is edited in anger, or history silently re-prices. **Non-negotiable ordering.** |
| **Output** | Founder can change every rate from `/console`, audited |

### Phase 3 — Backend APIs & services *(L)*
| | |
|---|---|
| **Tasks** | `gn-promotion.ts`, `gn-batch-assignment.ts`, `book-orders.ts`. **`createWorkshop` provisioning: instantiate `gnWorkshopTemplate`, snapshot `gnCostModel` onto the workshop, scaffold default ad-set + intake fields (§3.5); repoint the P&L to read `costModelSnapshot`.** New `TriggerType` values + `SEND_WHATSAPP` action. |
| **Depends on** | Phases 1–2 |
| **Risk** | `promoteConversion` spans 4 tables — must be one transaction or partial promotion corrupts the roster. |
| **Output** | Conversion → Student/batch/EMI in one click |

### Phase 4 — Business logic *(M)*
| | |
|---|---|
| **Tasks** | Capacity enforcement; pending-pool rules; next-batch suggestion; book-order trigger evaluation; slot grid. **Book orders ship in `remind_founder` mode (§4.4): render `publisherMessage` + emit the founder notification + "mark sent" action. Build the `auto_send` path but leave it off.** |
| **Depends on** | Phase 3 |
| **Risk** | §2.1's *"assign numbers only to batches that can realistically fill"* is a **judgement call, not an algorithm** (full design §3.6). Build **suggest + confirm**, never auto-assign. Getting this wrong strands students in the pool. Same principle for books: the app drafts and reminds, the founder sends. |
| **Output** | Batch engine + book-order reminders, both human-in-the-loop; auto-send one config flip away |

### Phase 5 — Finance & commission engine *(L — highest risk)*
| | |
|---|---|
| **Tasks** | **F1 basis fix.** `gn-posting.ts` bridge. `CommissionGrant` derivation + approve/pay. **F5**: instalment-PAID → `Income`. Substitute split. |
| **Depends on** | Phases 1–4, **F2 resolved** |
| **Risk** | **Highest in the project.** Posting historical GN revenue restates the P&L — the founder will see numbers move. Socialise before deploy. Period-lock the backfill. `postEntryOnce` is idempotent by `(sourceType, sourceId)`, and a Postgres advisory lock already prevents double-posting — *"the single worst thing this ledger could do."* |
| **Output** | GN money on the ledger; commissions that actually pay |

### Phase 6 — Frontend *(M)*
| | |
|---|---|
| **Tasks** | Manage tabs (pending pool, capacity, slots); workshop tabs (books, basis toggle); console panels; commission approve/pay UI. |
| **Depends on** | Phases 2–5 |
| **Risk** | Low. Extends existing `<Tabs>` shells. |
| **Output** | Founder-operable UI |

### Phase 7 — Notifications *(S — but gated by Phase 0)*
| | |
|---|---|
| **Tasks** | Map approved templates → `WhatsAppKind`; new touchpoints in `runDueReminders`; PDF statements. |
| **Depends on** | **Meta approval (Phase 0)**, Phase 3 |
| **Risk** | Approval rejections. Vendor-recipient opt-out semantics (§4.3). |
| **Output** | Automated sends |

### Phase 8 — Testing & validation *(M)*
| | |
|---|---|
| **Tasks** | Unit: `pnlFrom` basis, commission attribution + substitute split, capacity, book trigger, `rulesetFor` effective-dating. Integration: promote → pay → post → grant. **Reconciliation: GN P&L vs trial balance vs `/finance` must agree to the paise.** Idempotence: re-run everything twice, assert no double-post. |
| **Depends on** | All |
| **Risk** | The reconciliation test is the real acceptance gate. If GN P&L ≠ ledger ≠ dashboard, the founders dashboard is still a lie. |
| **Output** | `node --test`; green reconciliation |

**Critical path:** `Phase 0 (F2) → 1 → 2 → 3 → 4 → 5 → 8`. Phase 7 hangs off Meta approval and can slip without blocking. **Phase 2 before any rate edit** is the one ordering constraint that cannot flex.

---

## PART 6 — Assumptions & ambiguities

### 6.1 Blocking — need the founder before Phase 5

| # | Question | Why it blocks |
|---|---|---|
| **A1** | ~~Is the tutor fee per-level or batch-size-tiered?~~ **Largely answered from the March workbook — see §6.4.** Two residuals: **(a) does B1 take a large-batch discount?** Every B1 batch on record is size 1–2, so the data can't say. **(b) Are ₹4,000 / ₹9,000 / ₹11,000 ad-hoc negotiations, or a rule we're missing?** | Narrow. Ship `appliesTo: ["A1"]` + per-row overrides; widen by config if wrong. **No longer blocks Phase 5.** |
| **A2** | **Substitute split: is 20/80 applied to the 5% discovery fee (cover gets 1%, owner 4%), or is it a separate arrangement?** Spec §7.1 says the substitute *"keeps 20%"* but §18-1 admits *"confirm how it stacks with the 3%/5%"*. | Cannot implement `SUBSTITUTE` from the docs. |
| **A3** | **Is the commission ladder 2 legs or 3?** — see §6.5. Part 1 §8.2 states **L1 = 3%** and leaves L2/L3 *"TBD — client input needed"*. **Part 2 §7 is that missing input**: setter 3%, discovery-caller-who-closes 5%, combined 8%. So Part 1 and Part 2 agree, and **the code (5 / 3+3 / +4-`PLACEHOLDER`) disagrees with both** — it was written while L2/L3 were unknown. **Recommendation: seed `3 / 5 / 8` from Part 2.** The residual: Part 2 describes **two** legs (set, discovery+close), but Part 1 and the live sheets show **three** real people (Nilofer touchpoint → Asma discovery → Ameen SSS close). Does the L3/SSS closer earn a separate leg, or did the ladder collapse to two? | Real money. `Enrollment.closerId` was built for a 3-leg model Part 2 doesn't describe. |
| **A4** | **Runway: spec §8.1 says `÷ 3`. Code divides by *months with data* — deliberately.** Change or keep? | We recommend **keep** and expose as config. |
| **A5** | **Book-order threshold ₹30k — hard rule or the founder's example?** And what is the "career charge" (§4)? | The trigger is unbuildable without it. Spec §18-3 flags this too. |

### 6.2 Non-blocking — need answers before Phase 6

- **A6** Net-profit colour bands. Spec §6's examples (90%, 41% green; 48% pink) **do not form a monotonic band** — 48% pink sits *between* two greens. We checked the founder-dashboard mockup: it does carry a band (`Red <50% · Amber 50–80% · Green >80%`) but that is **pipeline target attainment**, not net profit — and the §6 examples don't fit it either (41% would be red, yet the founder calls it green). **Working hypothesis: green/pink does not encode margin at all — it encodes collection status** (pink = balance outstanding, green = fully collected), and the percentages are incidental to the colour. That would explain every example. **Please confirm or correct** — it changes whether the colour is a config band or a derived flag.
- **A7** Currency. `GnWorkshopConversion` is INR-only (`BigInt` paise, no EUR side); `Income` is dual-currency; §8 wants a per-section EUR/INR lock. **Data check: exactly one GN row is a EUR-adjacent payment** — Arvind Raj, ₹43,035, method `"German Bank"` — and it was booked in INR. So EUR *does* touch GN, rarely, and is currently flattened to rupees at an unrecorded rate. Do GN conversions need a real EUR side, or is "German Bank, booked INR" the honest model?
- **A8b** **GST is entirely absent from the app** (`grep -rliE '\bgst\b|\bhsn\b|taxRate|\bcgst\b' src/` → zero hits), yet `Clone_Spec_1_Books_Accounting` treats GST as mandatory and Part 2 §15 prices the engagement as *"₹49k + GST"*. Are GN course fees (₹16,999 etc.) GST-inclusive, GST-exempt (education), or out of scope? **If GN revenue is going on the ledger, this decides whether the income posting needs a tax split.** Out of scope to build, but not to decide.
- **A8** "69 templates" vs 119 in the account (§4.1).
- **A9** Which "converted" definition does commission use? Three coexist (§3.4).
- **A10** Spec §18-7's *"secret/watch integration"* is referenced and never defined. Out of scope until specified.

### 6.3 Assumptions we've made (flag if wrong)

1. GN money is **cash-basis**, like the rest of the app. §6.1 supports this.
2. Batch numbers are **globally sequential**, not per-level.
3. A student's advance token is an `Income` row, not a separate deposit liability. *(Strictly, a token before delivery is deferred revenue — but the app is cash-basis throughout and has no deferred-revenue account. Consistency beats correctness here; revisit only if the accountant asks.)*
4. `targetStrength` (advisory, exists) and `maxStrength` (enforced, new) are **different fields**. Overloading the existing one would silently change behaviour on batches already over 8.
5. Promotion is **admin-triggered**, not automatic. §2.1's fill-probability judgement is human.

### 6.4 Evidence: the tutor-fee model, resolved against the March workbook

Rather than ask, we tested both readings against the founder's own sheet (`Required_Document/03_26_Workshop.xlsx - Google Sheets.pdf`) and the reconstructed seed. **Both the code and the spec are wrong, in different places.**

Batch sizes recovered from `prisma/seed-workshops.ts` (20 batches; 7 at ≥5, 13 at <5, max 7):

| Level | Batch | Size | Code says | Spec says | **Workbook actually billed** |
|---|---|---|---|---|---|
| A1 | B21, B23, B24, B26 | 5–7 | ₹7,000 | ₹7,000 | **₹7,000** ✅ both agree |
| A1 | **B22** | **3** | ₹7,000 | ₹8,000 | **₹8,000** ← *spec right, code wrong* |
| A1 | **B25** | **1** | ₹7,000 | ₹8,000 | **₹8,000** ← *spec right, code wrong* |
| A2 | B16, B17, B18 | 1–3 | ₹8,000 | ₹8,000 | **₹8,000** ✅ both agree |
| A2 | **B19, B20** | **5** | ₹8,000 | ₹7,000 | **₹8,000** ← *code right, spec wrong* |
| B1 | B07, B08, B09 | 1–2 | ₹12,000 | ₹8,000 | **₹12,000** ← *code right, spec wrong* |

**Conclusions:**
1. **The batch-size rule is real** — but observed on **A1 only**. Small A1 batches genuinely bill ₹8,000 (Jitendra/B22, Pragathi/B25, Kruthiga/B22). The code's flat `A1 = ₹7,000` overcharges nothing but *undercosts* those rows.
2. **A2 does not move with size.** B19 and B20 both had 5 students and still billed ₹8,000. This is positive evidence, not absence of evidence — the spec's `≥5 → ₹7,000` is simply not what happens.
3. **B1 = ₹12,000 always**, and the spec's rule cannot produce ₹12,000 at all. It's a level premium the spec never mentions.
4. **Why the confusion:** A1 correlates with large batches (the entry level fills) and A2 with small ones. Reading the sheet level-by-level makes size look like level. It's a confounded variable — the code sampled the correlation, the recording sampled the cause.
5. **The sheet is "default + override", not a formula.** Distinct tutor values across March: ₹7,000 ×19, ₹8,000 ×14, ₹12,000 ×10, ₹9,000 ×5, ₹11,000 ×1, ₹4,000 ×1. The last three are hand-set. `tutorCostOverrideInrMinor` already models this — **the seed discarded it** (zero overrides seeded), which is a likely contributor to the known ~2% March variance.

**Impact:** across March + May, the two models differ by **₹21,000 of tutor COGS (4.3%)** — material, but not the headline. The bigger prize is that the config shape in §3.2 now has evidence behind it instead of a guess.

### 6.5 Evidence: the commission ladder, traced across all three specs

The rates looked like a straight spec-vs-code conflict. Reading Part 1 alongside Part 2 shows it isn't — **it's a question Part 1 asked and Part 2 answered, with the code frozen at the moment before the answer arrived.**

| Source | Says |
|---|---|
| **Part 1 §8.2** | *"if ₹30,000 cash is collected, the **L1 person receives 3%**; the L2/L3 people receive their own configured percentages."* |
| **Part 1 §18.4 + Build Checklist** | ⚠️ *"Client input needed: L2/L3 percentages (**only L1 = 3% known**)."* |
| **Part 2 §7** | Setter **3%** · discovery caller who closes **5%** · combined **8%** |
| **Code** (`commission-metrics.ts:18`) | both-calls **5%** · split **3+3** · closer **+4%** — commented `PLACEHOLDER, confirm with client` |

**Part 1 and Part 2 agree** (L1 = 3%, and 8 = 3 + 5 composes cleanly). **The code agrees with neither** — unsurprising, since it was written while L2/L3 were explicitly unknown, and it says so in its own comment. Part 2 *is* the client input Part 1 was waiting for. → **Seed the config with 3 / 5 / 8.**

**The residual is structural, not numeric.** Part 1 models a **three-tier ladder** (L1 setter → L2 discovery → L3 sales/SSS close) and proposes an `ENROLLMENT_TEAM` row per contributor. `SHEETS_PROCESS_AND_FORMULAS.md` confirms three *real* people occupying those tiers: **Nilofer** took first-touch from March 2026, **Asma** shifted to discovery (962 DISCO), **Ameen** closes SSS (229 DISCO + *"on 24th ameen did SSS call"*). But **Part 2 §7 names only two legs** — set, and discovery-that-closes — because its framing is *"the assigned person (e.g. Asma or the founder)"* running one call that converts.

Both readings are defensible:
- **2-leg:** Part 2 is the current reality; discovery and close merged; `closerId` becomes redundant.
- **3-leg:** Part 2 describes the common case and omits Ameen's separate SSS close; `Enrollment.closerId` (added 16 Jul) already models it and would need its own rate.

**This is the one commission question the documents cannot settle** — Part 2's 8% = 3 + 5 leaves no room for a third leg, yet the sheets show one happening. Needs the founder.

### 6.6 Two findings surfaced while checking the above

- **The FX fallback is ~16% stale and silently wrong.** `fx.ts:7` hardcodes `FALLBACK_INR_PER_EUR = 90`, used whenever the Frankfurter API is unreachable *and* no cached `fx_rate` row exists. `Clone_Spec_1_Books_Accounting` §7 records **€1 ≈ ₹107.5** (29 Jun 2026). The rate is returned with `stale: true`, so the seam is honest — but nothing surfaces that flag to the founder, and the same doc's own rule is *"never hardcode this."* Bump the constant and surface staleness in the UI. Cheap; unrelated to GN; worth doing while we're here.
- **GST does not exist in this codebase.** See §6.2-A8b. Decide before GN revenue posts.

### 6.7 Evidence: what the F1 basis fix actually costs

F1 is a one-line change. Its consequences are not. We replayed `pnlFrom()`/`rollup()` over the seeded March and May workshops under both bases:

| | March 2026 (32 conv.) | May 2026 (17 conv.) |
|---|---|---|
| Quoted (Σ `final`) | ₹8,29,723 | ₹6,49,924 |
| Cash (Σ `paid`) | ₹7,59,121 | ₹4,55,522 |
| **Outstanding** | **₹70,602** | **₹1,94,402** |
| Net profit — **now** (quoted) | ₹2,96,550 · **35.74%** | ₹2,48,872 · **38.29%** |
| Net profit — **spec** (cash) | ₹2,25,948 · **29.76%** | ₹54,470 · **11.96%** |
| **Change** | **−₹70,602 (−23.8%)** | **−₹1,94,402 (−78.1%)** |

**May's headline net profit falls by 78%.** That is not a bug being fixed — it's the two bases answering different questions. May is recent: most of its deals are still collecting on EMI, so ₹1.94L of billed revenue hasn't landed. Cash-basis profit for a young workshop is *structurally* low and **rises as instalments arrive**; quoted-basis profit is stable but counts money that may never come.

**This changes the recommendation from "fix it" to "show both, default to cash."**
- Part 2 §6.1 is unambiguous that the founder's number is cash — so cash is the default and the headline.
- But a bare cash number on a 6-week-old workshop reads as failure when it's just immaturity. The workshop page should show **cash NP as the headline, quoted NP beside it, and outstanding as the bridge between them** — three numbers that explain each other, rather than one number that misleads either way.
- `GnPnlRollup` already carries `revenue`, `cashCollected` *and* `balance`. **No schema change is needed** — only `pnlFrom`'s choice of numerator and the UI.

> **This also probably solves A6 (the colour bands).** Green/pink never fit a margin scale — 41% green vs 48% pink is not monotonic. But it fits *collection status* perfectly: May, with ₹1.94L outstanding, would be full of pink rows; a fully-collected 41% row is green. **Pink = money still owed, green = settled.** The percentage was always incidental to the colour. Confirm before building.

### 6.8 Conflicts with current architecture, and our call

| Conflict | Our recommendation | Why |
|---|---|---|
| `LEDGER_ENTRY` vs double-entry ledger | **Reject the spec's table.** Map to `Income`/`Expense` + `postEntry`. | The ledger is trigger-enforced, hash-chained, append-only. The spec's flat table is strictly weaker. A third book is a regression. |
| Spec's `revenue = Σ quoted` vs app's `revenue = Σ cash` | **Cash.** Fix `pnlFrom` (F1). | §6.1 says cash explicitly. The code contradicts the spec today. |
| `INTAKE` as a table | **Two enum columns.** | 2 values, no attributes. A join buys nothing. |
| L1/L2/L3 as `Role` | **Keep as attribution.** | Roles are identity; deal position is per-deal. One person is a setter on Monday and a closer on Tuesday. |
| `COMMISSION_RULE.editable` boolean | **Drop it.** | Editability is RBAC (`commission.configure`), not a data attribute. |
| `BONUS_RULE` as new table | **Use `RewardRule`.** | Already effective-dated, approvable, stamped, idempotent. Already has `RewardKind.COMMISSION`. |
| Spec's runway `÷3` | **Keep app's.** Config the divisor. | `cash-metrics.ts:57` documents why: a flat /3 dilutes burn for a young business and **silences the <3-month alert**. |

---

## Appendix — Hazards inherited from the current build

These are pre-existing and will bite this project specifically. Fix the starred ones as part of it.

| # | Hazard | Where |
|---|---|---|
| ★1 | **Dashboards don't read the ledger.** `finance-metrics`/`cash-metrics`/`commission-metrics` aggregate `Income`/`Expense` directly. Comments claiming otherwise are aspirational. Two books; the founder sees one. | `finance-metrics.ts` |
| ★2 | **AR (1100) is structurally wrong** — only credited, never debited; trends negative forever. Invoice *issuance* is never posted. | `finance-posting.ts:182` (flagged in-code) |
| ★3 | **`recordPayment` writes no `Income`** → invisible to Finance/Cash/Commission. | `payments-actions.ts:357` |
| ★4 | **Instalment PAID registers no cash** (F5). | `emi-actions.ts` |
| ★5 | **`PeriodLock` has no UI/action.** | engine only |
| 6 | Receivables filter disagreement: `finance-metrics.ts:163` includes `OVERDUE`; `cash-metrics.ts:106` doesn't. Same concept, two totals. | both |
| 7 | `FounderPulse.tsx:176` uses **float FX math**, bypassing `aggInrMinor`'s Decimal + ROUND_HALF_UP. Off by a paise vs every other screen. | `FounderPulse.tsx` |
| 8 | Auth inconsistency: `emi-actions` guards on `requireSection("finance")`, `finance-actions` on `capabilityCheck("finance.write")`. The former ignores the capability. | both |
| 9 | `money.ts:resolveAmounts` is **dead code with a misleading docstring** (claims to derive the missing currency side; doesn't). Don't call it. | `money.ts:10` |
| 10 | `GnWorkshopAdSet.conversions` is a **manually keyed int**, unreconciled against `GnWorkshopConversion` rows. | `schema.prisma:1957` |
| 11 | `monthsToTarget` hardcodes ₹8L instead of reading `MonthlyTarget`. | `cash-metrics.ts:180` |
| 12 | Nothing flips `Instalment` `DUE → OVERDUE`. Manual-only. | no cron |

**Non-negotiables when writing the code** (from `ledger-core.ts` + `finance-actions.ts`):
- Money is **integer minor units** (paise/cents) as `BigInt`. Never float. `Decimal(14,6)` for FX only.
- `postEntry` **must** run inside a transaction — the balance trigger is `DEFERRABLE INITIALLY DEFERRED` and fires at COMMIT.
- INR lines **must** carry `fxRate = 1`. Amounts strictly `> 0` — use `side`, never a negative.
- Edit = `voidEntryForSource` then `postEntry`. **Never mutate a posted entry.**
- Every money write posts in the **same transaction** as the row it records: *"A finance row that exists without its journal entry is the one state this app must never reach."*
- New account codes go in `CHART_OF_ACCOUNTS` (`AccountCode` is a literal union) → `npm run db:ledger`.

---

*Blueprint prepared 17 Jul 2026. Read alongside `docs/SYNAMATE_CLONE_SPEC.md`, `docs/DESIGN_SYSTEM.md`, and `Required_Document/B2Consultants_Spec_vs_Build_Reconciliation.md` (partially superseded — `Instalment`, `JobApplication`, `Enrollment.closerId`, `GnBatch.targetStrength` and `GnEventType` all landed in `20260716084728_spec_parity_commission_emi_jobs_lms`).*
