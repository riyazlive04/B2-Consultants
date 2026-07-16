import { createHash } from "node:crypto";
import { Prisma, type Currency, type LedgerSourceType } from "@prisma/client";
import { eurMinorToInrMinor } from "@/lib/fx";
import { CHART_OF_ACCOUNTS, type AccountCode } from "@/lib/chart-of-accounts";

/**
 * The double-entry posting engine (SPEC §10).
 *
 * Nothing outside this module may write to `journal_entry` / `journal_line`. Every money
 * figure the dashboards show is a slice of what gets posted here, so two rules are absolute:
 *
 *   1. An entry balances in the BASE currency (INR paise): Σ base debits = Σ base credits.
 *   2. History is never edited. A mistake is corrected by voiding and re-posting.
 *
 * Both are enforced by the database too (see the `ledger_integrity` migration). The checks
 * here fail early with a message a human can act on; the triggers exist because application
 * code is not a place to keep a promise this important.
 *
 * NO "server-only" AND NO "use server" IN THIS FILE, deliberately, mirroring agreement-core.ts:
 *  - "use server" would publish `postEntry` as an RPC endpoint reachable from the internet,
 *    letting anyone mint journal entries.
 *  - "server-only" throws under plain Node, and `prisma/seed-ledger.ts` and the backfill
 *    script must import these functions.
 * Reach for `ledger.ts` from app code; it re-exports everything here.
 */

/** Anything that can run a query: the PrismaClient itself or a transaction handle. */
export type LedgerDb = Prisma.TransactionClient;

const BASE_CURRENCY: Currency = "INR";
const ONE = new Prisma.Decimal(1);

export type DraftLine = {
  accountCode: AccountCode;
  side: "debit" | "credit";
  /** minor units of `currency` — paise for INR, cents for EUR */
  amountMinor: bigint;
  currency: Currency;
  /** INR per 1 unit of `currency`, as at the transaction date. Must be 1 for INR. */
  fxRate: Prisma.Decimal;
  isCogs?: boolean;
};

export type DraftEntry = {
  date: Date;
  narration: string;
  sourceType: LedgerSourceType;
  sourceId?: string | null;
  postedById?: string | null;
  lines: DraftLine[];
};

export class LedgerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerError";
  }
}

/** "YYYY-MM" — the same key `period_lock.month` and the Finance month picker use. */
export function monthKeyOf(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** A line's value in base currency (INR paise). */
function baseMinorOf(line: DraftLine): bigint {
  if (line.currency === BASE_CURRENCY) {
    if (!line.fxRate.equals(ONE)) {
      throw new LedgerError(`INR line on ${line.accountCode} must use rate 1, got ${line.fxRate}`);
    }
    return line.amountMinor;
  }
  return eurMinorToInrMinor(line.amountMinor, line.fxRate);
}

async function resolveAccountIds(
  db: LedgerDb,
  codes: readonly string[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(codes)];
  const rows = await db.ledgerAccount.findMany({
    where: { code: { in: wanted } },
    select: { id: true, code: true },
  });
  const byCode = new Map(rows.map((r) => [r.code, r.id]));
  const missing = wanted.filter((c) => !byCode.has(c));
  if (missing.length) {
    throw new LedgerError(
      `Chart of accounts is missing ${missing.join(", ")} — run \`npm run db:ledger\` to seed it.`,
    );
  }
  return byCode;
}

/**
 * Post one balanced entry. MUST run inside a transaction: the balance trigger is
 * DEFERRABLE INITIALLY DEFERRED, so it fires at COMMIT. Outside a transaction each
 * statement commits on its own and the first line of every entry would fail the check.
 */
export async function postEntry(tx: LedgerDb, draft: DraftEntry): Promise<string> {
  if (draft.lines.length < 2) throw new LedgerError("A journal entry needs at least two lines");

  const lines = draft.lines.map((l) => {
    if (l.amountMinor <= BigInt(0)) {
      throw new LedgerError(`Line on ${l.accountCode} must have a positive amount`);
    }
    return { ...l, baseMinor: baseMinorOf(l) };
  });

  let debits = BigInt(0);
  let credits = BigInt(0);
  for (const l of lines) {
    if (l.side === "debit") debits += l.baseMinor;
    else credits += l.baseMinor;
  }
  if (debits !== credits) {
    throw new LedgerError(
      `Entry does not balance: debits ${debits} ≠ credits ${credits} (INR paise) — ${draft.narration}`,
    );
  }

  const month = monthKeyOf(draft.date);
  if (await tx.periodLock.findUnique({ where: { month } })) {
    throw new LedgerError(`Accounting period ${month} is locked — no entry can be posted into it.`);
  }

  const byCode = await resolveAccountIds(
    tx,
    lines.map((l) => l.accountCode),
  );

  const entry = await tx.journalEntry.create({
    data: {
      date: draft.date,
      narration: draft.narration,
      sourceType: draft.sourceType,
      sourceId: draft.sourceId ?? null,
      postedById: draft.postedById ?? null,
      lines: {
        create: lines.map((l) => ({
          accountId: byCode.get(l.accountCode)!,
          currency: l.currency,
          fxRate: l.fxRate,
          isCogs: l.isCogs ?? false,
          debitMinor: l.side === "debit" ? l.amountMinor : BigInt(0),
          creditMinor: l.side === "credit" ? l.amountMinor : BigInt(0),
          baseDebitMinor: l.side === "debit" ? l.baseMinor : BigInt(0),
          baseCreditMinor: l.side === "credit" ? l.baseMinor : BigInt(0),
        })),
      },
    },
    select: { id: true },
  });
  return entry.id;
}

/**
 * Post unless this source row already has a LIVE entry. Returns null when it does.
 *
 * This is what stops a retried action — or a re-run backfill — from booking the same
 * revenue twice. The `journal_entry_one_live_source` trigger enforces the same rule at
 * the database, including the advisory lock that makes it safe under concurrency.
 */
export async function postEntryOnce(
  tx: LedgerDb,
  draft: DraftEntry & { sourceId: string },
): Promise<string | null> {
  const existing = await liveEntryForSource(tx, draft.sourceType, draft.sourceId);
  if (existing) return null;
  return postEntry(tx, draft);
}

/** The one POSTED entry for a source row, if it has one. Voided entries keep their sourceId. */
export async function liveEntryForSource(
  db: LedgerDb,
  sourceType: LedgerSourceType,
  sourceId: string,
): Promise<{ id: string } | null> {
  return db.journalEntry.findFirst({
    where: { sourceType, sourceId, status: "POSTED" },
    select: { id: true },
  });
}

/**
 * Void an entry by posting its mirror image and flagging the original.
 *
 * The reversal is dated `on` (today), not the original's date: reversing into a month Ameen
 * has already closed and reported would restate it, which is precisely what period locking
 * exists to prevent.
 */
export async function voidEntry(
  tx: LedgerDb,
  entryId: string,
  opts: { reason: string; actorId?: string | null; on: Date },
): Promise<string> {
  const original = await tx.journalEntry.findUnique({
    where: { id: entryId },
    include: { lines: true },
  });
  if (!original) throw new LedgerError(`Journal entry ${entryId} not found`);
  if (original.status === "VOID") throw new LedgerError(`Journal entry ${entryId} is already void`);

  const reversal = await tx.journalEntry.create({
    data: {
      date: opts.on,
      narration: `Reversal of "${original.narration}" — ${opts.reason}`,
      sourceType: original.sourceType,
      // sourceId stays null: the reversal is not the source row, and reusing the id would
      // collide with the (sourceType, sourceId) uniqueness that prevents double-posting.
      sourceId: null,
      postedById: opts.actorId ?? null,
      reversalOfId: original.id,
      lines: {
        create: original.lines.map((l) => ({
          accountId: l.accountId,
          currency: l.currency,
          fxRate: l.fxRate,
          isCogs: l.isCogs,
          // swapping the sides is the whole of a reversal
          debitMinor: l.creditMinor,
          creditMinor: l.debitMinor,
          baseDebitMinor: l.baseCreditMinor,
          baseCreditMinor: l.baseDebitMinor,
        })),
      },
    },
    select: { id: true },
  });

  await tx.journalEntry.update({ where: { id: original.id }, data: { status: "VOID" } });
  return reversal.id;
}

/**
 * Void the live entry for a source row, if it has one. Used when Finance edits or deletes
 * a record: the old entry is reversed, and an edit then posts the restated one.
 */
export async function voidEntryForSource(
  tx: LedgerDb,
  sourceType: LedgerSourceType,
  sourceId: string,
  opts: { reason: string; actorId?: string | null; on: Date },
): Promise<string | null> {
  const entry = await liveEntryForSource(tx, sourceType, sourceId);
  if (!entry) return null;
  return voidEntry(tx, entry.id, opts);
}

// ───────────────────────── Immutable audit chain ─────────────────────────

const GENESIS_HASH = "0".repeat(64);
/** Arbitrary but fixed: serialises audit appends across concurrent transactions. */
const AUDIT_LOCK_KEY = 8_142_026;

/** Stable JSON: sorted keys, BigInt → string, Date → ISO. A hash must not depend on key order. */
function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (typeof v === "bigint") return v.toString();
    if (v instanceof Date) return v.toISOString();
    if (Prisma.Decimal.isDecimal(v)) return v.toString();
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, norm((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(norm(value));
}

function hashLink(prevHash: string, payload: unknown): string {
  return createHash("sha256").update(`${prevHash}|${canonicalJson(payload)}`).digest("hex");
}

export type AuditInput = {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  payload: Prisma.InputJsonValue;
};

/**
 * Append to the hash-chained audit log (SPEC §3, §10.1).
 *
 * The advisory lock serialises concurrent appends. Without it, two writers read the same
 * `prevHash` and the chain forks into two branches that each verify on their own — the
 * failure mode that makes an audit trail worthless in front of an auditor.
 */
export async function appendAudit(tx: LedgerDb, input: AuditInput): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`;
  const last = await tx.auditEntry.findFirst({ orderBy: { seq: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS_HASH;
  const body = {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    actorId: input.actorId ?? null,
    payload: input.payload,
  };
  await tx.auditEntry.create({ data: { ...body, prevHash, hash: hashLink(prevHash, body) } });
}

/**
 * Walk the chain and recompute every link (SPEC §15 "hash verifies"). Returns the first row
 * whose recorded hash disagrees with the recomputed one — the point where history was altered.
 */
export async function verifyAuditChain(
  db: LedgerDb,
): Promise<{ ok: true; length: number } | { ok: false; brokenAtSeq: bigint; length: number }> {
  const rows = await db.auditEntry.findMany({ orderBy: { seq: "asc" } });
  let prevHash = GENESIS_HASH;
  for (const r of rows) {
    const body = {
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actorId: r.actorId,
      payload: r.payload,
    };
    if (r.prevHash !== prevHash || r.hash !== hashLink(prevHash, body)) {
      return { ok: false, brokenAtSeq: r.seq, length: rows.length };
    }
    prevHash = r.hash;
  }
  return { ok: true, length: rows.length };
}

// ───────────────────────────── Reports ─────────────────────────────

export type TrialBalanceRow = {
  code: string;
  name: string;
  type: string;
  debitMinor: bigint;
  creditMinor: bigint;
};

/**
 * Trial balance (SPEC §10.1, §15 "trial balance balances").
 *
 * Every line is summed, including those of VOID entries. A void leaves the original entry
 * in place and adds a mirrored reversal; the pair nets to zero. Summing POSTED-only would
 * drop the original but keep the reversal, and the trial balance would show the negative
 * of every voided entry.
 */
export async function getTrialBalance(db: LedgerDb, upTo?: Date) {
  const grouped = await db.journalLine.groupBy({
    by: ["accountId"],
    where: upTo ? { entry: { date: { lte: upTo } } } : undefined,
    _sum: { baseDebitMinor: true, baseCreditMinor: true },
  });

  const accounts = await db.ledgerAccount.findMany({
    select: { id: true, code: true, name: true, type: true },
  });
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const rows: TrialBalanceRow[] = grouped
    .map((g) => {
      const a = byId.get(g.accountId)!;
      return {
        code: a.code,
        name: a.name,
        type: a.type as string,
        debitMinor: g._sum.baseDebitMinor ?? BigInt(0),
        creditMinor: g._sum.baseCreditMinor ?? BigInt(0),
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  const totalDebit = rows.reduce((s, r) => s + r.debitMinor, BigInt(0));
  const totalCredit = rows.reduce((s, r) => s + r.creditMinor, BigInt(0));
  return { rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

/** The read-only Journal view (SPEC §10.4): newest entries with their lines. */
export async function getJournal(db: LedgerDb, opts: { take?: number; skip?: number } = {}) {
  const [entries, total] = await Promise.all([
    db.journalEntry.findMany({
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
      include: {
        postedBy: { select: { name: true } },
        lines: {
          include: { account: { select: { code: true, name: true, type: true } } },
          orderBy: { baseDebitMinor: "desc" },
        },
      },
    }),
    db.journalEntry.count(),
  ]);
  return { entries, total };
}

// ───────────────────────────── Seeding ─────────────────────────────

/** Idempotent: upsert the chart of accounts. Safe to run on every deploy. */
export async function seedChartOfAccounts(db: LedgerDb): Promise<{ created: number; total: number }> {
  let created = 0;
  for (const [i, a] of CHART_OF_ACCOUNTS.entries()) {
    const existing = await db.ledgerAccount.findUnique({ where: { code: a.code } });
    if (!existing) created += 1;
    // Name/type/currency are code-owned; sortKey keeps the Ledger view in chart order.
    await db.ledgerAccount.upsert({
      where: { code: a.code },
      update: {
        name: a.name,
        type: a.type,
        currency: a.currency,
        isCogs: "isCogs" in a ? a.isCogs : false,
        sortKey: i,
      },
      create: {
        code: a.code,
        name: a.name,
        type: a.type,
        currency: a.currency,
        isCogs: "isCogs" in a ? a.isCogs : false,
        sortKey: i,
      },
    });
  }
  return { created, total: CHART_OF_ACCOUNTS.length };
}
