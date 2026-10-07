import type { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { csvStreamResponse } from "@/lib/csv";
import { ACTIVE } from "@/lib/soft-delete";
import { parsePeriod, resolvePeriod } from "@/lib/period";
import { contactsWhere } from "@/server/contacts-metrics";
import { LEAD_SOURCE_LABELS, LEAD_STAGE_LABELS, PAYMENT_METHOD_LABELS } from "@/lib/labels";
import { BUSINESS_LINE_LABELS, lineForKind } from "@/lib/business-line";
import { aggInrMinor } from "@/lib/money";
import { paymentTypeLabel, RECURRENCE_INTERVAL_LABELS } from "@/lib/payment-types";
import { levelKinds, levelLabels } from "@/server/levels";
import { getPaymentTypesConfig } from "@/server/founder-config";
import { answerToText, isStaticItem, normaliseItems, type FormAnswers } from "@/lib/sites-types";
import { logActivity } from "@/server/activity-log";

/**
 * Server-side CSV export - the file follows the FILTER, not the page.
 *
 * ── Why this route exists ───────────────────────────────────────────────────────
 * Export was a `DataTable` button that serialised the rows currently rendered. Those rows are a
 * capped, paginated slice, so "download all leads for July" silently produced whatever part of
 * July had fitted on screen - an export that looks complete and is not, which is worse than no
 * export at all. This runs the same `where` clause the screen ran, with no page cap.
 *
 * ── Guards, in order ────────────────────────────────────────────────────────────
 *   · `requireSection` - the same gate the screen itself is behind. An export endpoint that
 *     skipped it would be a way to read a section you cannot open.
 *   · `MAX_ROWS` - a stated ceiling, and the file SAYS when it truncated (see below). A silent
 *     cap on an export is the same lie as the paginated one it replaces.
 *   · `logActivity` - 23,545 lead records with names, phones and emails leaving the building is
 *     the single largest data movement this app permits. It leaves a trace.
 *
 * Rows are read in keyset-paginated batches and streamed, so the whole table is never held in
 * memory on a 1 vCPU host.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Bounded, and reported in the file when hit. ~50k rows is a ~10MB CSV. */
const MAX_ROWS = 50_000;
const BATCH = 1_000;

type ExportDef = {
  section: Parameters<typeof requireSection>[0];
  /**
   * A function when the columns are not knowable until the request arrives - a form's export has
   * one column per question, and every form has different questions.
   */
  header: string[] | ((req: NextRequest) => Promise<string[]>);
  filename: (label: string) => string;
  /**
   * May be async: an export that needs the founder's configured labels (the income one does, to
   * print "Full payment" rather than FULL_PAYMENT) has to resolve them before it can start
   * yielding rows. Awaited once by the caller, so a synchronous `run` is unaffected.
   */
  run: (
    req: NextRequest,
    period: { start: Date; endExclusive: Date },
  ) => AsyncIterable<unknown[][]> | Promise<AsyncIterable<unknown[][]>>;
};

/** Keyset pagination over `id` - stable, index-backed, and unaffected by rows inserted mid-export. */
async function* batched<T extends { id: string }>(
  fetchPage: (cursorId: string | null, take: number) => Promise<T[]>,
  toRow: (row: T) => unknown[],
): AsyncIterable<unknown[][]> {
  let cursor: string | null = null;
  let emitted = 0;
  for (;;) {
    const take = Math.min(BATCH, MAX_ROWS - emitted);
    if (take <= 0) {
      yield [[`… truncated at the ${MAX_ROWS.toLocaleString("en-IN")}-row export limit - narrow the filter and export again`]];
      return;
    }
    const rows: T[] = await fetchPage(cursor, take);
    if (!rows.length) return;
    emitted += rows.length;
    cursor = rows[rows.length - 1]!.id;
    yield rows.map(toRow);
    if (rows.length < take) return;
  }
}

const EXPORTS: Record<string, ExportDef> = {
  /**
   * Leads / contacts. Honours every filter the Contacts screen exposes - search, owner, stage,
   * source, city, tag and the date range - by reusing `contactsWhere`.
   */
  leads: {
    section: "contacts",
    filename: (label) => `b2-leads-${label}.csv`,
    header: [
      "Name", "Phone", "Email", "City", "Stage", "Source", "Owner",
      "Created", "First contacted", "BANT avg", "BANT verdict", "Notes",
    ],
    run(req) {
      const p = req.nextUrl.searchParams;
      const where: Prisma.LeadWhereInput = contactsWhere({
        search: p.get("q") ?? undefined,
        ownerId: p.get("owner") ?? undefined,
        stage: p.get("stage") ?? undefined,
        source: p.get("source") ?? undefined,
        city: p.get("city") ?? undefined,
        dateFrom: p.get("from") ?? undefined,
        dateTo: p.get("to") ?? undefined,
        tagId: p.get("tag") ?? undefined,
      });
      return batched(
        (cursorId, take) =>
          prisma.lead.findMany({
            where: cursorId ? { AND: [where, { id: { gt: cursorId } }] } : where,
            orderBy: { id: "asc" },
            take,
            select: {
              id: true, name: true, phone: true, email: true, city: true, stage: true,
              leadSource: true, createdAt: true, contactedAt: true, notes: true,
              bantAvg: true, bantVerdict: true,
              assignedTo: { select: { name: true } },
            },
          }),
        (l) => [
          l.name, l.phone, l.email, l.city,
          LEAD_STAGE_LABELS[l.stage] ?? l.stage,
          LEAD_SOURCE_LABELS[l.leadSource] ?? l.leadSource,
          l.assignedTo?.name ?? "",
          l.createdAt, l.contactedAt,
          // "" not 0 - an unscored lead is one nobody asked, not one that scored zero.
          l.bantAvg != null ? l.bantAvg : "", l.bantVerdict ?? "",
          l.notes,
        ],
      );
    },
  },

  /** Money in. Scoped by the period's `date` window, matching the Finance screen exactly. */
  income: {
    section: "finance",
    filename: (label) => `b2-income-${label}.csv`,
    /**
     * ── Readable, and reconcilable (issue 22) ─────────────────────────────────────
     * The file used to come out full of raw enum codes - FULL_PAYMENT, GUIDED - with no business
     * line, no student code, and a "Price INR" column reading 0 for a euro payment because it
     * printed the raw INR field rather than the aggregate. A reconciliation file that needs the
     * schema open beside it to be read is not a reconciliation file.
     *
     * Added: the student code (the identifier printed on agreements and quoted on the phone, so
     * the one a row can be matched on), the business line, and the aggregate rupee value - the
     * figure every total on screen is built from. The as-entered INR and EUR columns are kept
     * beside it, because what arrived in which currency is the record and the aggregate is a
     * view of it.
     */
    header: [
      "Date", "Student code", "Student", "Level", "Business line",
      "Received INR", "Received EUR", "Value INR", "FX rate",
      "Payment type", "Method", "Recurs", "Next payment", "Settles receivable", "Notes",
    ],
    async run(_req, period) {
      const where: Prisma.IncomeWhereInput = {
        ...ACTIVE,
        date: { gte: period.start, lt: period.endExclusive },
      };
      // The founder's own labels for the configured lists, resolved ONCE for the whole file
      // rather than per row - both are cached app-wide, but a 50k-row loop should not ask.
      const [levels, types] = await Promise.all([levelLabels(), getPaymentTypesConfig()]);
      const kindByLevel = await levelKinds();
      return batched(
        (cursorId, take) =>
          prisma.income.findMany({
            where: cursorId ? { AND: [where, { id: { gt: cursorId } }] } : where,
            orderBy: { id: "asc" },
            take,
            select: {
              id: true, date: true, studentName: true, programLevel: true,
              amountInrMinor: true, amountEurMinor: true, fxRateUsed: true,
              paymentType: true, paymentMethod: true, paymentMethodOther: true,
              recurrenceInterval: true, recurrenceNextDate: true, notes: true,
              student: { select: { code: true } },
              pendingPayment: { select: { programLevel: true } },
            },
          }),
        (i) => [
          i.date.toISOString().slice(0, 10),
          i.student?.code ?? "",
          i.studentName,
          levels[i.programLevel] ?? i.programLevel,
          BUSINESS_LINE_LABELS[lineForKind(kindByLevel.get(i.programLevel))],
          // Minor units → major, as plain numbers so a spreadsheet can sum the columns.
          Number(i.amountInrMinor) / 100,
          Number(i.amountEurMinor) / 100,
          // The aggregate: the INR part plus the EUR part at this row's own stamped rate. This
          // is the figure every total on screen adds up, and it is what used to read 0 on a
          // euro-only payment.
          Number(aggInrMinor(i.amountInrMinor, i.amountEurMinor, i.fxRateUsed)) / 100,
          i.fxRateUsed.toString(),
          paymentTypeLabel(types, i.paymentType),
          // The typed answer replaces a bare "OTHER" - that note is the only record of
          // which rail the money came down, and a CSV is where reconciliation happens.
          i.paymentMethod === "OTHER" && i.paymentMethodOther
            ? i.paymentMethodOther
            : PAYMENT_METHOD_LABELS[i.paymentMethod] ?? i.paymentMethod,
          i.recurrenceInterval ? RECURRENCE_INTERVAL_LABELS[i.recurrenceInterval] ?? i.recurrenceInterval : null,
          i.recurrenceNextDate?.toISOString().slice(0, 10) ?? null,
          // Which receivable this payment pays off, where one was named (FIN-12).
          i.pendingPayment ? levels[i.pendingPayment.programLevel] ?? i.pendingPayment.programLevel : "",
          i.notes,
        ],
      );
    },
  },

  /** Money out. Same window, same shape. */
  expenses: {
    section: "finance",
    filename: (label) => `b2-expenses-${label}.csv`,
    header: ["Date", "Category", "Vendor", "Price INR", "Price EUR", "Business line", "COGS", "Notes"],
    run(_req, period) {
      const where: Prisma.ExpenseWhereInput = {
        ...ACTIVE,
        date: { gte: period.start, lt: period.endExclusive },
      };
      return batched(
        (cursorId, take) =>
          prisma.expense.findMany({
            where: cursorId ? { AND: [where, { id: { gt: cursorId } }] } : where,
            orderBy: { id: "asc" },
            take,
            select: {
              id: true, date: true, category: true, vendor: true,
              amountInrMinor: true, amountEurMinor: true,
              businessLine: true, isCogs: true, notes: true,
            },
          }),
        (e) => [
          e.date.toISOString().slice(0, 10), e.category, e.vendor,
          Number(e.amountInrMinor) / 100, Number(e.amountEurMinor) / 100,
          e.businessLine, e.isCogs ? "Yes" : "No", e.notes,
        ],
      );
    },
  },

  /**
   * One form's responses - Google Forms' "Download responses (.csv)".
   *
   * The columns are the form's own questions, in the order the form asks them, resolved per
   * request. Answers are keyed by `key` rather than by position, so a question added later does
   * not shunt every older response one column to the right.
   */
  "form-responses": {
    section: "forms",
    filename: (label) => `b2-form-responses-${label}.csv`,
    header: async (req) => {
      const items = await formQuestions(req.nextUrl.searchParams.get("formId"));
      return ["Submitted", "Contact", ...items.map((i) => i.label || i.key), "UTM source", "UTM campaign"];
    },
    run: (req, period) => {
      const formId = req.nextUrl.searchParams.get("formId") ?? "";
      const where: Prisma.FormSubmissionWhereInput = {
        formId,
        createdAt: { gte: period.start, lt: period.endExclusive },
      };
      // The question list is needed for the row order as well as the header; the header call and
      // this one are the same cheap single-row read.
      const itemsPromise = formQuestions(formId);
      return (async function* () {
        const items = await itemsPromise;
        yield* batched(
          (cursorId, take) =>
            prisma.formSubmission.findMany({
              where: cursorId ? { AND: [where, { id: { gt: cursorId } }] } : where,
              orderBy: { id: "asc" },
              take,
              select: { id: true, createdAt: true, data: true, utm: true, lead: { select: { name: true } } },
            }),
          (s) => {
            const answers = (s.data as FormAnswers) ?? {};
            const utm = (s.utm as Record<string, string> | null) ?? {};
            return [
              s.createdAt.toISOString(),
              s.lead?.name ?? "",
              ...items.map((i) => answerToText(answers[i.key])),
              utm.utm_source ?? "",
              utm.utm_campaign ?? "",
            ];
          },
        );
      })();
    },
  },
};

/** The answerable questions of one form, in ask order. Empty for a missing or unreadable form. */
async function formQuestions(formId: string | null) {
  if (!formId) return [];
  const form = await prisma.form.findUnique({ where: { id: formId }, select: { fields: true } });
  return normaliseItems(form?.fields).filter((i) => !isStaticItem(i.type));
}

export async function GET(req: NextRequest, { params }: { params: { entity: string } }) {
  const def = EXPORTS[params.entity];
  // 404 rather than 400: an unknown entity is an unknown URL, and enumerating which entity names
  // are valid is information this endpoint has no reason to hand out.
  if (!def) return new Response("Not found", { status: 404 });

  // The same section gate the screen is behind. `requireSection` redirects an unauthorised
  // browser; here the caller is a download, so a redirect would produce an HTML file named .csv.
  const session = await requireSection(def.section);

  const period = resolvePeriod(
    parsePeriod(Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>),
  );
  const label = period.label.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();

  /**
   * Audited BEFORE the stream opens.
   *
   * Awaited on purpose: once the response starts streaming the request may end at any point, and
   * a fire-and-forget write is lost precisely on the large exports most worth recording.
   */
  await logActivity(session, {
    action: "data.export",
    section: def.section,
    entityType: "Export",
    entityId: params.entity,
    summary: `Exported ${params.entity} as CSV - ${period.label}`,
    meta: { entity: params.entity, period: period.label, filters: Object.fromEntries(req.nextUrl.searchParams) },
  });

  const header = typeof def.header === "function" ? await def.header(req) : def.header;
  // `run` may be async (see its type) - awaited here so the stream starts from a real iterable.
  return csvStreamResponse(def.filename(label), header, await def.run(req, period));
}
