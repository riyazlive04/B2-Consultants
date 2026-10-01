"use client";

import { Modal } from "@/components/ui/Modal";
import { Btn } from "@/components/ui/controls";
import { Pill } from "@/components/ui/kit";
import { StudentName } from "@/components/ui/StudentName";
import type { IncomeRow } from "@/server/finance-metrics";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS, SOURCE_LABELS } from "@/lib/labels";
import { BUSINESS_LINE_LABELS, type BusinessLine } from "@/lib/business-line";
import { moneyAlt, money } from "@/lib/money-display";
import { useFinanceCcy } from "./FinanceCurrency";

/**
 * One payment, in full.
 *
 * The table can only ever show what fits on a line. Notes are truncated at 28 characters, the
 * method sits in a column most screens scroll past, and the two as-entered amounts are easy to
 * confuse with the aggregate beside them - so the row that records the money says less about it
 * than the form that captured it did. Clicking the row opens the whole record here, read-only,
 * with Edit one button away for when reading turns into correcting.
 *
 * Deliberately NOT a second edit form. A popup that looks editable but saves nothing is worse
 * than no popup; this one states what was recorded and hands off to the form that owns it.
 */

/** A labelled line. `value` is a node so an amount can carry its secondary currency beneath it. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5 last:border-b-0">
      <span className="flex-none text-label uppercase text-ink-2">{label}</span>
      <span className="min-w-0 text-right text-sm text-ink">{children}</span>
    </div>
  );
}

export function IncomeDetailCard({
  row,
  studentCode,
  levelLabel,
  line,
  upcoming,
  onEdit,
  onClose,
}: {
  row: IncomeRow | null;
  studentCode?: string | null;
  levelLabel: string;
  /** Which book this payment lands in - derived from the programme level, never stored. */
  line?: BusinessLine;
  /** The rest of this student's plan, if this payment started one. */
  upcoming?: { dueDate: string; inr: number; eur: number }[];
  onEdit: (row: IncomeRow) => void;
  onClose: () => void;
}) {
  const { ccy } = useFinanceCcy();
  if (!row) return null;

  const inr = BigInt(row.amountInrRaw);
  const eur = BigInt(row.amountEurRaw);
  const extraInr = BigInt(row.instalmentExtraInrRaw);
  const extraEur = BigInt(row.instalmentExtraEurRaw);
  /**
   * The two "as entered" figures stay currency-labelled and show a dash where nothing arrived -
   * same rule as the table. A €500 PayPal payment and a ₹54,372 UPI one are different facts, and
   * quoting both in one currency erases which of them actually happened.
   */
  const asEntered = [
    ...(inr > BigInt(0) ? [formatInrMinor(inr)] : []),
    ...(eur > BigInt(0) ? [formatEurMinor(eur)] : []),
  ];
  const extras = [
    ...(extraInr > BigInt(0) ? [formatInrMinor(extraInr)] : []),
    ...(extraEur > BigInt(0) ? [formatEurMinor(extraEur)] : []),
  ];

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Payment record"
      subtitle={`${row.studentName} · ${formatDate(row.date)}`}
    >
      <div className="space-y-4">
        {/* The amount leads, because it is what anyone opening a payment came to check. */}
        <div className="rounded-field border border-line bg-surface-2 p-4">
          <p className="text-label uppercase text-ink-2">Amount received</p>
          <p className="tnum mt-1 font-display text-metric text-ink">{money(row.agg, ccy)}</p>
          <p className="tnum text-caption text-muted">{moneyAlt(row.agg, ccy)}</p>
          {asEntered.length > 0 && (
            <p className="mt-2 text-caption text-muted">
              Entered as {asEntered.join(" + ")}
              {asEntered.length === 1 ? " - the other currency is the converted equivalent." : "."}
            </p>
          )}
        </div>

        <div>
          <Row label="Student">
            <StudentName name={row.studentName} code={studentCode ?? null} />
          </Row>
          <Row label="Date">{formatDate(row.date)}</Row>
          <Row label="Programme level">
            <span className="inline-flex items-center gap-2">
              {levelLabel}
              {line && <Pill tone="neutral">{BUSINESS_LINE_LABELS[line]}</Pill>}
            </span>
          </Row>
          <Row label="Payment type">
            {PAYMENT_TYPE_LABELS[row.paymentType]}
            {row.instalmentCount ? ` · ${row.instalmentCount}×` : ""}
            {extras.length > 0 && (
              <span className="block text-caption text-muted">+{extras.join(" + ")} extra</span>
            )}
          </Row>
          <Row label="Method">{PAYMENT_METHOD_LABELS[row.paymentMethod]}</Row>
          {/* Where the record came from. A Razorpay row and a hand-typed one are the same money
              but not the same evidence, and only one of them can be mistyped. */}
          <Row label="Recorded">{SOURCE_LABELS[row.source] ?? row.source}</Row>
          <Row label="Notes">
            {row.notes ? (
              // The one field that genuinely runs long, and the reason this card exists: in the
              // table it is clipped at 28 characters.
              <span className="block whitespace-pre-wrap text-left">{row.notes}</span>
            ) : (
              <span className="text-muted">-</span>
            )}
          </Row>
        </div>

        {upcoming && upcoming.length > 0 && (
          <div>
            <p className="text-label uppercase text-ink-2">Still to come on this plan</p>
            <ul className="mt-1 divide-y divide-line">
              {upcoming.map((u, i) => (
                <li key={`${u.dueDate}-${i}`} className="flex items-baseline justify-between gap-4 py-2 text-sm">
                  <span className="text-muted">{formatDate(u.dueDate)}</span>
                  <span className="tnum">{money({ inr: u.inr, eur: u.eur }, ccy)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Btn variant="ghost" onClick={onClose}>Close</Btn>
          <Btn onClick={() => onEdit(row)}>Edit this entry</Btn>
        </div>
      </div>
    </Modal>
  );
}
