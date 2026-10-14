"use client";

import { useRef, useState } from "react";
import { PiggyBank } from "lucide-react";
import {
  archiveEquityEntry, createEquityEntry, restoreEquityEntry, updateEquityEntry,
} from "@/server/equity-actions";
import type { EquityContributorRow, EquityEntryRow, EquityOverview } from "@/server/equity-metrics";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Card, Pill } from "@/components/ui/kit";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { guardAction, safeAction } from "@/lib/action-guard";
import { Field, FormError, NotesField, Select, SubmitButton, TextInput } from "@/components/ui/form";
import { AmountPair } from "@/components/ui/AmountPair";
import { useUnsavedGuard } from "@/components/ui/use-unsaved-guard";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";
import { MONEY_ACCOUNTS } from "@/lib/chart-of-accounts";

/**
 * OWNER'S EQUITY - the capital side of Cash Health.
 *
 * ── What this replaces ────────────────────────────────────────────────────────────
 * A single box on the weekly cash-position form: "Personal savings (₹, optional) - planning only,
 * never counted in runway". One unattributed figure a week, excluded from every calculation, so
 * it could answer nothing: not whose money it was, not when it went in, not whether it was a
 * contribution at all. With a second person contributing it could say nothing whatsoever.
 *
 * ── Two things this section is careful to SAY ─────────────────────────────────────
 * Capital confuses people precisely because it is real money that is not income, so the page
 * states both halves rather than leaving them to be inferred:
 *   · it is NOT revenue - it never reaches the P&L, so profit and margin do not move;
 *   · it is NOT added to Cash in Hand - that figure is the bank balance typed each Monday, which
 *     already contains it. Adding it again would double it.
 *
 * A DRAWING is the same entry reversed, so one table answers "put in, taken out, left in".
 */

const minorToInput = (raw: string) => {
  const v = BigInt(raw);
  return v === BigInt(0) ? "" : (Number(v) / 100).toFixed(2);
};

const KIND_OPTIONS = [
  { value: "CONTRIBUTION", label: "Money put in (contribution)" },
  { value: "DRAWING", label: "Money taken out (drawing)" },
];

export function EquitySection({
  overview,
  today,
  fxRate,
  fxStale,
  fxDate,
}: {
  overview: EquityOverview;
  today: string;
  fxRate: number;
  fxStale?: boolean;
  fxDate?: string;
}) {
  const [editing, setEditing] = useState<EquityEntryRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useUnsavedGuard(formRef);

  const { rows, contributors, totals, unpostedCount, archived } = overview;

  const submit = async (form: FormData) => {
    setError(null);
    const guarded = await guardAction(() =>
      editing ? updateEquityEntry(editing.id, form) : createEquityEntry(form),
    );
    if (!guarded.ok) return setError(guarded.error);
    if (!guarded.value.ok) return setError(guarded.value.error);
    toast(editing ? "Equity entry updated" : "Equity entry recorded");
    setEditing(null);
    formRef.current?.reset();
  };

  const startEdit = (row: EquityEntryRow) => {
    setEditing(row);
    setError(null);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const archive = async (row: EquityEntryRow) => {
    const ok = await askConfirm({
      title: `Archive ${row.contributorName}'s entry?`,
      body: "It leaves the totals and its journal entry is reversed. You can restore it from the archived list.",
      confirmLabel: "Archive",
      danger: true,
    });
    if (!ok) return;
    const res = await safeAction(() => archiveEquityEntry(row.id));
    if (!res.ok) return toast(res.error, "error");
    toast("Entry archived");
  };

  const contributorColumns: Column<EquityContributorRow>[] = [
    { key: "name", header: "Contributor", cell: (r) => r.name, value: (r) => r.name },
    {
      key: "in", header: "Put in", align: "right",
      cell: (r) => <span className="tnum">{formatInrMinor(r.inInr)}</span>,
      value: (r) => r.inInr / 100,
    },
    {
      key: "out", header: "Taken out", align: "right",
      cell: (r) => (r.outInr === 0 ? "-" : <span className="tnum text-warn">{formatInrMinor(r.outInr)}</span>),
      value: (r) => r.outInr / 100,
    },
    {
      key: "net", header: "Stake in the business", align: "right",
      // Signed, with the sign carrying the meaning: a negative stake means somebody has drawn
      // out more than they put in, which is a real and reportable state, not an error.
      cell: (r) => (
        <span className={`tnum font-semibold ${r.netInr < 0 ? "text-risk" : "text-ink"}`}>
          {formatInrMinor(r.netInr)}
        </span>
      ),
      value: (r) => r.netInr / 100,
    },
    {
      key: "last", header: "Last entry",
      cell: (r) => (r.lastDate ? formatDate(r.lastDate) : "-"),
      value: (r) => r.lastDate?.slice(0, 10) ?? "",
    },
    {
      key: "entries", header: "Entries", align: "right",
      cell: (r) => String(r.entries), value: (r) => r.entries,
    },
  ];

  const entryColumns = (archivedView: boolean): Column<EquityEntryRow>[] => [
    { key: "date", header: "Date", cell: (r) => formatDate(r.date), value: (r) => r.date.slice(0, 10) },
    {
      key: "who", header: "Contributor",
      cell: (r) => (
        <span>
          {r.contributorName}
          {/* Recorded, but carrying no journal entry - so it is in this section's totals and
              not in the trial balance. Said on the row, because the remedy (re-save it once the
              period is open, or once the chart of accounts is seeded) belongs to this row. */}
          {r.unposted && !archivedView && (
            <span
              className="ml-1.5 cursor-help text-caption text-watch"
              title="Not posted to the ledger - the period may be closed. Edit and save it again to post."
            >
              not posted
            </span>
          )}
        </span>
      ),
      value: (r) => r.contributorName,
    },
    {
      key: "kind", header: "Direction",
      cell: (r) =>
        r.kind === "CONTRIBUTION" ? <Pill tone="good">In</Pill> : <Pill tone="warn">Out</Pill>,
      value: (r) => r.kind,
    },
    {
      key: "inr", header: "₹", align: "right",
      cell: (r) => (BigInt(r.amountInrRaw) === BigInt(0) ? "-" : formatInrMinor(BigInt(r.amountInrRaw))),
      value: (r) => Number(BigInt(r.amountInrRaw)) / 100,
    },
    {
      key: "eur", header: "€", align: "right",
      cell: (r) => (BigInt(r.amountEurRaw) === BigInt(0) ? "-" : formatEurMinor(BigInt(r.amountEurRaw))),
      value: (r) => Number(BigInt(r.amountEurRaw)) / 100,
    },
    { key: "account", header: "Into / out of", cell: (r) => r.accountLabel, value: (r) => r.accountLabel },
    { key: "notes", header: "Notes", cell: (r) => r.notes ?? "", value: (r) => r.notes ?? "" },
    {
      key: "actions", header: "", sortable: false,
      cell: (r) =>
        archivedView ? (
          <Btn
            variant="ghost"
            size="sm"
            onClick={async () => {
              const res = await safeAction(() => restoreEquityEntry(r.id));
              if (!res.ok) return toast(res.error, "error");
              toast("Entry restored");
            }}
          >
            Restore
          </Btn>
        ) : (
          <span className="flex gap-2 whitespace-nowrap">
            <Btn variant="ghost" size="sm" onClick={() => startEdit(r)}>Edit</Btn>
            <Btn variant="danger" size="sm" onClick={() => archive(r)}>Archive</Btn>
          </span>
        ),
      value: () => null,
    },
  ];

  return (
    <section className="space-y-4">
      {/* The three figures the section exists to answer, and the two sentences that stop them
          being misread as revenue or as extra cash. */}
      <Card>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <div>
            <p className="text-caption text-muted">Put in</p>
            <p className="font-display text-h2 font-bold tnum">{formatInrMinor(totals.inInr, { compact: true })}</p>
          </div>
          <div>
            <p className="text-caption text-muted">Taken out</p>
            <p className="font-display text-h2 font-bold tnum">{formatInrMinor(totals.outInr, { compact: true })}</p>
          </div>
          <div>
            <p className="text-caption text-muted">Owners’ stake</p>
            <p className={`font-display text-h2 font-bold tnum ${totals.netInr < 0 ? "text-risk" : ""}`}>
              {formatInrMinor(totals.netInr, { compact: true })}
            </p>
          </div>
          <div>
            <p className="text-caption text-muted">Contributors</p>
            <p className="font-display text-h2 font-bold tnum">{contributors.length}</p>
          </div>
        </div>
        <p className="mt-4 border-t border-line pt-3 text-caption text-muted">
          Equity is <strong className="text-ink">not revenue</strong> - it never reaches the profit
          and loss, so recording it here does not move revenue, profit or margin. It is also{" "}
          <strong className="text-ink">not added to Cash in Hand</strong>: that figure is the bank
          balance you enter each Monday, which already contains the money once it has arrived.
          Each entry posts to the ledger as Owner’s equity.
          {unpostedCount > 0 && (
            <>
              {" "}
              <span className="text-warn">
                {unpostedCount} {unpostedCount === 1 ? "entry is" : "entries are"} recorded but not
                posted - they are flagged in the table below.
              </span>
            </>
          )}
        </p>
      </Card>

      <Card
        title={editing ? `Edit entry - ${editing.contributorName}` : "Record an equity entry"}
        subtitle="Money an owner puts into the business, or takes back out."
        actions={
          editing ? (
            <Btn variant="ghost" size="sm" onClick={() => setEditing(null)}>Cancel edit</Btn>
          ) : undefined
        }
      >
        <form ref={formRef} action={submit} key={editing?.id ?? "new"}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Date">
              <TextInput
                type="date"
                name="date"
                required
                defaultValue={editing ? editing.date.slice(0, 10) : today}
                defaultToday={!editing}
              />
            </Field>
            {/* Free text and not a user picker: an owner is very often not somebody with a
                login - a family member, a silent partner - and requiring an account would make
                the commonest case unrecordable. */}
            <Field label="Who" hint="Whose money this is - they do not need a login">
              <TextInput
                kind="name"
                name="contributorName"
                required
                placeholder="e.g. Ameen"
                defaultValue={editing?.contributorName ?? ""}
              />
            </Field>
            <Field label="Direction">
              <Select name="kind" options={KIND_OPTIONS} defaultValue={editing?.kind ?? "CONTRIBUTION"} />
            </Field>
            <Field label="Into / out of" hint="Which account the money actually moved through">
              <Select
                name="accountCode"
                options={MONEY_ACCOUNTS.map((a) => ({ value: a.code, label: a.label }))}
                defaultValue={editing?.accountCode ?? "1000"}
              />
            </Field>
            <AmountPair
              fxRate={fxRate}
              fxStale={fxStale}
              fxDate={fxDate}
              inrName="amountInr"
              eurName="amountEur"
              inrLabel="Amount (₹)"
              eurLabel="Amount (€)"
              baseHint="INR, EUR, or both"
              defaultInr={editing ? minorToInput(editing.amountInrRaw) : ""}
              defaultEur={editing ? minorToInput(editing.amountEurRaw) : ""}
            />
            <NotesField
              placeholder="e.g. seed capital, equipment loan repaid"
              defaultValue={editing?.notes ?? ""}
              key={`notes-${editing?.id ?? "new"}`}
            />
          </div>
          <div className="mt-4 flex items-center gap-3">
            <SubmitButton>{editing ? "Save entry" : "Record entry"}</SubmitButton>
            <FormError message={error} />
          </div>
        </form>
      </Card>

      <Card
        title="By contributor"
        subtitle="Contributions less drawings - what each person actually has in the business."
      >
        <DataTable
          rows={contributors}
          columns={contributorColumns}
          csvName="owners-equity-by-contributor"
          emptyMessage="Nothing recorded yet - add the first contribution above."
          defaultSort="net"
        />
      </Card>

      <Card
        title={
          <span className="flex items-center gap-2 font-display text-h3 text-ink">
            <span className="text-primary"><PiggyBank size={18} /></span>
            Every entry
          </span>
        }
        actions={
          archived.length > 0 ? (
            <Btn variant="ghost" size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? "Hide archived" : `Archived (${archived.length})`}
            </Btn>
          ) : undefined
        }
      >
        <DataTable
          rows={showArchived ? archived : rows}
          columns={entryColumns(showArchived)}
          csvName="owners-equity"
          filterPlaceholder="Filter entries…"
          rowClassName={(r) => (r.id === editing?.id ? "bg-accent-soft" : undefined)}
          emptyMessage={
            showArchived ? "Nothing archived." : "No equity entries yet."
          }
        />
      </Card>
    </section>
  );
}
