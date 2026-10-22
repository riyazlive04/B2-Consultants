/**
 * Merge fields for uploaded agreement documents - isomorphic, pure, no prisma.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────────────────────
 * An uploaded `.docx` supplies the PROSE. It must not also supply the money, the party or the
 * dates: those are `AgreementData`, which is validated, which the invoice, the receivable
 * schedule and the enrol prompt all read, and which a founder re-typing a fee into a Word file
 * would quietly put out of step with the ledger.
 *
 * So the draft is written once with `{{payment.total}}` where the number goes, and that is what
 * makes one uploaded template serve every student.
 *
 * ── WHY AN UNKNOWN TOKEN IS AN ERROR AND NOT A BLANK ────────────────────────────────────────
 * Two failure modes were available and both are worse than refusing:
 *   - printing nothing turns "a fee of {{payment.totl}}" into "a fee of" on an executed contract;
 *   - printing the token leaves "{{payment.totl}}" in the middle of §7 of something somebody has
 *     signed.
 * `unresolvedMergeTokens` therefore names every token it cannot answer, the editor shows them,
 * and `issueAgreement` refuses. A typo costs a correction, not a contract.
 */

import {
  AGREEMENT_PROVIDER,
  formatGermanDate,
  formatInrPlainForDocument,
  type AgreementData,
} from "./agreement";
import {
  blockTexts,
  customToken,
  mapBlockText,
  type DocBlock,
  type DocCustomField,
  type DocField,
} from "./agreement-doc";

/** `{{ student.fullName }}` - whitespace tolerated, because a founder will type it. */
const TOKEN_RE = /\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g;

export type MergeContext = {
  documentNo: string;
  /** The date the document speaks as of: the issue date once issued, else today. */
  asOf: Date;
  /**
   * The founder's own `{{custom.*}}` definitions, straight off the document body's options.
   *
   * It rides on the CONTEXT rather than on a parameter of its own because the context already
   * reaches every merge call site - `mergeBlocks`, `mergeFieldValue` and `fillFields` all take
   * one - so a renderer cannot resolve the built-in tokens and silently miss these.
   */
  custom?: readonly DocCustomField[];
};

/**
 * Every token this codebase can answer, with the value for THIS agreement.
 *
 * Money is written the way the master document writes it - "69,999 INR", no ₹ - because ₹ is
 * absent from WinAnsi and renders as a blank box in react-pdf's built-in Helvetica. See the note
 * on `formatInrPlainForDocument`.
 */
export function mergeValues(data: AgreementData, ctx: MergeContext): Record<string, string> {
  const { student, batch, payment } = data;
  const extra = payment.option === "INSTALMENT" && payment.planExtraInrMinor ? BigInt(payment.planExtraInrMinor) : BigInt(0);
  const total = BigInt(payment.totalInrMinor);
  const addOns = data.addOns ?? [];

  const schedule =
    payment.option === "FULL"
      ? `${formatInrPlainForDocument(total)} - ${payment.dueMilestone}`
      : payment.instalments
          .map(
            (i, n) =>
              `${n + 1}. ${formatInrPlainForDocument(i.amountInrMinor)} - ${i.dueMilestone}${
                i.dueDate ? ` (${formatGermanDate(i.dueDate)})` : ""
              }`,
          )
          .join("\n");

  return {
    "document.no": ctx.documentNo,
    "document.date": formatGermanDateOfLocal(ctx.asOf),

    "provider.name": AGREEMENT_PROVIDER.name,
    "provider.entity": AGREEMENT_PROVIDER.entity,
    "provider.address": AGREEMENT_PROVIDER.address,
    "provider.email": AGREEMENT_PROVIDER.email,
    "provider.mobile": AGREEMENT_PROVIDER.mobile,
    "provider.website": AGREEMENT_PROVIDER.website,

    "student.fullName": student.fullName,
    "student.firstName": student.fullName.trim().split(/\s+/)[0] ?? student.fullName,
    "student.address": student.address,
    "student.phone": student.phone,
    "student.email": student.email || "-",

    "batch.number": batch.number,
    "batch.startDate": formatGermanDate(batch.startDate),

    "payment.option": payment.option === "FULL" ? "Full payment" : "Instalments",
    "payment.total": formatInrPlainForDocument(total),
    "payment.planCharge": extra > BigInt(0) ? formatInrPlainForDocument(extra) : "-",
    "payment.collects": formatInrPlainForDocument(total + extra),
    "payment.instalmentCount": payment.option === "INSTALMENT" ? String(payment.instalments.length) : "1",
    "payment.schedule": schedule,
    "payment.addOns":
      addOns.length === 0
        ? "-"
        : addOns.map((a) => `${a.label} - ${formatInrPlainForDocument(a.amountInrMinor)}`).join("\n"),

    ...customValues(ctx.custom),
  };
}

/**
 * The founder's own tokens, as `custom.<token>` -> value.
 *
 * A declaration with NO VALUE is left out on purpose, so its token stays verbatim in the output
 * and `mergeProblems` names it. The alternative - mapping it to "" - would print "a fee of "
 * where the draft says "a fee of {{custom.levy}}", which is the precise failure the note at the
 * top of this file refuses to allow.
 */
function customValues(custom: readonly DocCustomField[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of custom ?? []) {
    const value = c.value?.trim();
    if (value) out[customToken(c)] = value;
  }
  return out;
}

/** IST, like every other date this app prints. Local to this module so it takes a Date, not an ISO string. */
function formatGermanDateOfLocal(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}.${get("month")}.${get("year")}`;
}

/** What the editor offers, grouped the way a founder thinks about a contract. */
export const MERGE_FIELD_GROUPS: { group: string; tokens: { token: string; label: string }[] }[] = [
  {
    group: "The student",
    tokens: [
      { token: "student.fullName", label: "Full name" },
      { token: "student.firstName", label: "First name" },
      { token: "student.address", label: "Postal address" },
      { token: "student.phone", label: "WhatsApp number" },
      { token: "student.email", label: "Email" },
    ],
  },
  {
    group: "Programme",
    tokens: [
      { token: "batch.number", label: "Batch" },
      { token: "batch.startDate", label: "Start date" },
    ],
  },
  {
    group: "Money",
    tokens: [
      { token: "payment.total", label: "Programme fee" },
      { token: "payment.planCharge", label: "Instalment plan charge" },
      { token: "payment.collects", label: "Total collected (fee + plan charge)" },
      { token: "payment.option", label: "Full payment or instalments" },
      { token: "payment.instalmentCount", label: "Number of instalments" },
      { token: "payment.schedule", label: "The whole payment schedule, one line each" },
      { token: "payment.addOns", label: "Books and materials, itemised" },
    ],
  },
  {
    group: "Document",
    tokens: [
      { token: "document.no", label: "Document number" },
      { token: "document.date", label: "Date of the document" },
    ],
  },
  {
    group: "B2 Consultants",
    tokens: [
      { token: "provider.name", label: "Signatory name" },
      { token: "provider.entity", label: "Entity" },
      { token: "provider.address", label: "Address" },
      { token: "provider.email", label: "Email" },
      { token: "provider.mobile", label: "Phone" },
      { token: "provider.website", label: "Website" },
    ],
  },
];

/** Every token name this module can resolve - the editor's autocomplete and the gate's allow-list. */
export const MERGE_TOKENS: string[] = MERGE_FIELD_GROUPS.flatMap((g) => g.tokens.map((t) => t.token));

/** Substitute in one string. An unknown token is left verbatim - the gate below is what catches it. */
export function applyMerge(text: string, values: Record<string, string>): string {
  return text.replace(TOKEN_RE, (whole, token: string) => values[token] ?? whole);
}

/** Every token that appears anywhere a reader can see it, in order of first appearance. */
export function collectMergeTokens(blocks: readonly DocBlock[], fields: readonly DocField[]): string[] {
  const found: string[] = [];
  const push = (text: string) => {
    for (const m of text.matchAll(TOKEN_RE)) {
      const token = m[1]!;
      if (!found.includes(token)) found.push(token);
    }
  };
  for (const t of blockTexts(blocks)) push(t);
  // A TEXT field's typed value is printed too, so a token in it must resolve like any other.
  for (const f of fields) if (f.value) push(f.value);
  return found;
}

/**
 * The ones nothing can answer. Non-empty means the document must not go out.
 *
 * A `{{custom.*}}` token counts as answerable only once it has a VALUE: declaring the name is
 * half the job, and a declaration left blank would print nothing. Those are reported separately
 * by `mergeProblems`, in words that say which half is missing.
 */
export function unresolvedMergeTokens(
  blocks: readonly DocBlock[],
  fields: readonly DocField[],
  custom: readonly DocCustomField[] = [],
): string[] {
  const answerable = new Set([...MERGE_TOKENS, ...Object.keys(customValues(custom))]);
  return collectMergeTokens(blocks, fields).filter((t) => !answerable.has(t));
}

/**
 * EVERY merge problem, in the words the founder reads - the editor's panel, the save response and
 * the issue gate all call this one function.
 *
 * It exists because those three sites used to each build the same sentence from
 * `unresolvedMergeTokens`, and a fourth case (a token declared but not filled in) would have had
 * to be added to all three by hand. One function means the gate and the editor cannot disagree
 * about what is wrong with a document.
 */
export function mergeProblems(
  blocks: readonly DocBlock[],
  fields: readonly DocField[],
  custom: readonly DocCustomField[] = [],
): string[] {
  const declared = new Map((custom ?? []).map((c) => [customToken(c), c]));
  return unresolvedMergeTokens(blocks, fields, custom).map((token) => {
    const blank = declared.get(token);
    return blank
      ? `“{{${token}}}” (${blank.label}) has no value yet. Fill it in beside the document.`
      : `“{{${token}}}” is not a field this app can fill. Fix or remove it.`;
  });
}

/** Resolve the whole document for rendering. The renderer never sees a token. */
export function mergeBlocks(
  blocks: readonly DocBlock[],
  data: AgreementData,
  ctx: MergeContext,
): DocBlock[] {
  const values = mergeValues(data, ctx);
  return mapBlockText(blocks, (t) => applyMerge(t, values));
}

/** Same, for a TEXT field's printed value. */
export function mergeFieldValue(
  value: string | undefined,
  data: AgreementData,
  ctx: MergeContext,
): string {
  if (!value) return "";
  return applyMerge(value, mergeValues(data, ctx));
}
