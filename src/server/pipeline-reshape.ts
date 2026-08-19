import "server-only";
import { Prisma, type PrismaClient, type LeadStage, type PaymentPlan } from "@prisma/client";
import { SYNAMATE_STAGES } from "@/lib/pipeline-stages";
import { statusForLegacyStage } from "@/lib/opportunity-status";

/**
 * Reshape a board's columns into the twelve Synamate stages, and re-file every card.
 *
 * ── Why this exists as a function and not a one-off script ──────────────────────
 * Three callers need exactly the same behaviour and must not drift: the seed (`db:crm`) on a
 * fresh database, the CLI (`db:pipeline-sync`) on an existing one, and the Admin "Restore the
 * Synamate columns" button on the board - which is what makes the manual column editing safe to
 * hand over, since a board someone has taken apart can always be put back.
 *
 * ── Idempotent, and safe to run on a live board ─────────────────────────────────
 * Columns are matched to their target by (legacyStage, paymentPlan) - never by name - so a column
 * that has been renamed is RENAMED BACK rather than duplicated, and re-running changes nothing.
 * A second run is a no-op that still reports what it found.
 *
 * NOTHING IS DELETED WITH CARDS IN IT. Every opportunity on the pipeline is re-filed into the
 * column its lead's stage belongs to (`lib/pipeline-stages.boardColumnFor`) BEFORE the leftover
 * columns are soft-deleted, so a column can only go away once it is empty. Soft-delete, not hard:
 * `deletedAt` is set, matching `deleteStage` in opportunities-actions.
 *
 * ── Set-based on purpose ────────────────────────────────────────────────────────
 * Production holds tens of thousands of cards; re-filing them one findFirst/update at a time is
 * minutes of held connection. The re-file is sixteen UPDATE … FROM statements (one per lead
 * stage, plus the WON split) and the position renumber is a single window function, so the whole
 * reshape is a couple of dozen statements regardless of board size.
 */

export type ReshapeReport = {
  pipelineName: string;
  renamed: { from: string; to: string }[];
  created: string[];
  /** Columns that are not part of the twelve - emptied, then soft-deleted. */
  removed: string[];
  /** Cards that changed column. */
  refiled: number;
};

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Every lead stage → the column it is filed into, as (stage, plan) match keys.
 *
 * Written out rather than derived by looping `boardColumnFor` over the enum so the WON split is
 * explicit: a WON lead with no plan recorded goes to Split Pay, which is the one row here that is
 * a judgement call rather than a mapping (see `boardColumnFor`).
 */
const REFILE_GROUPS: { stage: LeadStage; plan: PaymentPlan | null; column: { legacyStage: LeadStage; paymentPlan: PaymentPlan | null } }[] = [
  { stage: "NEW_LEAD", plan: null, column: { legacyStage: "NEW_LEAD", paymentPlan: null } },
  { stage: "WHATSAPP_SENT", plan: null, column: { legacyStage: "WHATSAPP_SENT", paymentPlan: null } },
  { stage: "STRATEGY_CALL_BOOKED", plan: null, column: { legacyStage: "STRATEGY_CALL_BOOKED", paymentPlan: null } },
  { stage: "DISCO_BOOKED", plan: null, column: { legacyStage: "DISCO_BOOKED", paymentPlan: null } },
  { stage: "DISCO_COMPLETED", plan: null, column: { legacyStage: "DISCO_BOOKED", paymentPlan: null } },
  { stage: "DISCO_NOT_BOOKED", plan: null, column: { legacyStage: "LOST", paymentPlan: null } },
  { stage: "LOST", plan: null, column: { legacyStage: "LOST", paymentPlan: null } },
  { stage: "NO_SHOW", plan: null, column: { legacyStage: "NO_SHOW", paymentPlan: null } },
  { stage: "SSS_BOOKED", plan: null, column: { legacyStage: "SSS_BOOKED", paymentPlan: null } },
  { stage: "SSS_COMPLETED", plan: null, column: { legacyStage: "SSS_COMPLETED", paymentPlan: null } },
  { stage: "SENT_TO_WORKSHOP", plan: null, column: { legacyStage: "SENT_TO_WORKSHOP", paymentPlan: null } },
  { stage: "WORKSHOP_FOLLOWUP", plan: null, column: { legacyStage: "WORKSHOP_FOLLOWUP", paymentPlan: null } },
  { stage: "PROPOSAL_SENT", plan: null, column: { legacyStage: "OFFER_FOLLOWUP", paymentPlan: null } },
  { stage: "OFFER_FOLLOWUP", plan: null, column: { legacyStage: "OFFER_FOLLOWUP", paymentPlan: null } },
  { stage: "DEPOSIT_FOLLOWUP", plan: null, column: { legacyStage: "DEPOSIT_FOLLOWUP", paymentPlan: null } },
  { stage: "DEPOSIT_PAID", plan: null, column: { legacyStage: "DEPOSIT_PAID", paymentPlan: null } },
  // The WON split. `plan: "FULL_PAY"` is the only group that reaches the Full pay column; every
  // other win (SPLIT_PAY, or no plan recorded at all) lands in Split Pay.
  { stage: "WON", plan: "FULL_PAY", column: { legacyStage: "WON", paymentPlan: "FULL_PAY" } },
  { stage: "WON", plan: null, column: { legacyStage: "WON", paymentPlan: "SPLIT_PAY" } },
];

export async function applySynamateStages(db: Db, pipelineId: string): Promise<ReshapeReport> {
  const pipeline = await db.pipeline.findUnique({ where: { id: pipelineId }, select: { name: true } });
  if (!pipeline) throw new Error(`Pipeline ${pipelineId} not found`);

  const existing = await db.pipelineStage.findMany({
    where: { pipelineId, deletedAt: null },
    orderBy: { position: "asc" },
    select: { id: true, name: true, legacyStage: true, paymentPlan: true },
  });

  const report: ReshapeReport = { pipelineName: pipeline.name, renamed: [], created: [], removed: [], refiled: 0 };
  const claimed = new Set<string>();
  /** (legacyStage|paymentPlan) → the stage row that now IS that column. */
  const columnId = new Map<string, string>();

  for (let i = 0; i < SYNAMATE_STAGES.length; i++) {
    const def = SYNAMATE_STAGES[i]!;
    const free = (s: (typeof existing)[number]) => !claimed.has(s.id);
    // Exact bridge match, then name, then a same-stage column that has no plan yet - the last one
    // is what turns the pre-existing single "Won" column into "Split Pay" instead of orphaning it.
    const match =
      existing.find((s) => free(s) && s.legacyStage === def.legacyStage && s.paymentPlan === def.paymentPlan) ??
      existing.find((s) => free(s) && s.name === def.name) ??
      existing.find((s) => free(s) && s.legacyStage === def.legacyStage && s.paymentPlan === null);

    if (match) {
      claimed.add(match.id);
      columnId.set(key(def.legacyStage, def.paymentPlan), match.id);
      if (match.name !== def.name) report.renamed.push({ from: match.name, to: def.name });
      await db.pipelineStage.update({
        where: { id: match.id },
        data: { name: def.name, position: i, legacyStage: def.legacyStage, paymentPlan: def.paymentPlan },
      });
    } else {
      const created = await db.pipelineStage.create({
        data: { pipelineId, name: def.name, position: i, legacyStage: def.legacyStage, paymentPlan: def.paymentPlan },
        select: { id: true },
      });
      columnId.set(key(def.legacyStage, def.paymentPlan), created.id);
      report.created.push(def.name);
    }
  }

  // ── Re-file every card ───────────────────────────────────────────────────────
  // Runs over the WHOLE pipeline, not just the columns about to disappear: a lead whose stage
  // changed while the board was misconfigured, or a win that now has a payment plan, is put right
  // here too. `stageId <> target` keeps a repeat run at zero writes.
  for (const g of REFILE_GROUPS) {
    const stageId = columnId.get(key(g.column.legacyStage, g.column.paymentPlan));
    if (!stageId) continue;
    const status = statusForLegacyStage(g.column.legacyStage);
    // WON keeps (or gets) its won date; anything else must not carry one, or a card dragged back
    // out of a win would still read as won on Contacts.
    const wonAt = g.column.legacyStage === "WON" ? Prisma.sql`COALESCE(o."wonAt", now())` : Prisma.sql`NULL`;
    // The plan clause: FULL_PAY is exact, and the Split Pay group is "everything else won", so it
    // must also catch the legacy wins that never recorded a plan.
    const planClause =
      g.plan === null && g.stage === "WON"
        ? Prisma.sql`AND (l."paymentPlan" IS NULL OR l."paymentPlan" = 'SPLIT_PAY'::"PaymentPlan")`
        : g.plan === null
          ? Prisma.empty
          : Prisma.sql`AND l."paymentPlan" = ${g.plan}::"PaymentPlan"`;

    report.refiled += await db.$executeRaw`
      UPDATE "opportunity" o
      SET "stageId" = ${stageId}, "status" = ${status}::"OpportunityStatus", "wonAt" = ${wonAt}
      FROM "lead" l
      WHERE o."leadId" = l.id
        AND o."pipelineId" = ${pipelineId}
        AND o."deletedAt" IS NULL
        AND o."stageId" <> ${stageId}
        AND l."stage" = ${g.stage}::"LeadStage"
        ${planClause}
    `;
  }

  // ── Retire what is left ──────────────────────────────────────────────────────
  // Anything still unclaimed is a column Synamate does not have. It is empty by now (every card
  // was re-filed above), so this is a soft delete and nothing else.
  for (const s of existing) {
    if (claimed.has(s.id)) continue;
    const left = await db.opportunity.count({ where: { stageId: s.id, deletedAt: null } });
    if (left > 0) {
      // Belt and braces: refuse rather than strand cards in an invisible column.
      throw new Error(
        `Refusing to remove the "${s.name}" column - ${left} card(s) are still in it. ` +
          `That means a lead stage has no column to be re-filed into; fix the mapping in lib/pipeline-stages.ts first.`,
      );
    }
    await db.pipelineStage.update({ where: { id: s.id }, data: { deletedAt: new Date() } });
    report.removed.push(s.name);
  }

  // ── Renumber positions inside each column ────────────────────────────────────
  // The re-file leaves several cards sharing a position; the board orders by it. One window
  // function beats one UPDATE per card at production volume.
  await db.$executeRaw`
    UPDATE "opportunity" o
    SET "position" = ranked.rn - 1
    FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY "stageId" ORDER BY "position", "createdAt") AS rn
      FROM "opportunity"
      WHERE "pipelineId" = ${pipelineId} AND "deletedAt" IS NULL
    ) ranked
    WHERE o.id = ranked.id AND o."position" <> ranked.rn - 1
  `;

  return report;
}

function key(stage: LeadStage, plan: PaymentPlan | null): string {
  return `${stage}|${plan ?? ""}`;
}
