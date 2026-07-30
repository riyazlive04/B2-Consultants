"use client";

import { useEffect, useRef, useState } from "react";
import { Field, TextInput } from "@/components/ui/form";
import { formatDate, formatInrMinor } from "@/lib/format";

/**
 * The ₹ / € amount boxes shared by every money form (income, expense, pending fee).
 *
 * TYPE IN ONE, SEE THE OTHER. Enter ₹75,000 and the € box fills in with the converted amount,
 * and vice versa — the conversion is visible in the field itself rather than as a hint the eye
 * skips.
 *
 * ONLY THE ENTERED CURRENCY IS STORED, and that is not a detail. A record's aggregate is
 * `INR part + EUR part converted` (lib/money.ts `aggInrMinor`) — the two columns ADD. So a
 * mirrored value left in the sibling box would post ₹75,000 AND its own €818 back as another
 * ₹75,000, silently doubling every amount entered. The derived box is therefore `disabled`,
 * which is what keeps it out of the submitted FormData; the currency the money actually
 * arrived in is the one that reaches the database.
 *
 * SPLIT PAYMENTS still work. A payment genuinely part-INR and part-EUR was the reason these
 * were two independent boxes to begin with, so "Enter each currency separately" unlocks them
 * and turns the mirroring off — at which point both figures are real and both are stored.
 */

/**
 * Major-unit input ("25000.50") → number, or null when it isn't a usable amount.
 * `kind="money"` already strips separators as they're typed, so the box only ever holds
 * digits and one dot; the comma strip stays as a belt-and-braces for a programmatic default.
 */
function parseMajor(value: string): number | null {
  const n = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

const toMinor = (major: number) => Math.round(major * 100);
/** Plain major-unit string for an input box — no grouping, so it round-trips through parseMajor. */
const toInput = (major: number) => (Math.round(major * 100) / 100).toFixed(2);

type Source = "INR" | "EUR" | null;

export function AmountPair({
  fxRate,
  fxStale = false,
  fxDate,
  inrName,
  eurName,
  inrLabel,
  eurLabel,
  baseHint,
  defaultInr = "",
  defaultEur = "",
}: {
  /** INR per EUR, as the server will stamp it. */
  fxRate: number;
  fxStale?: boolean;
  /** ISO date the rate was published — shown so the number is auditable (§4.2). */
  fxDate?: string;
  inrName: string;
  eurName: string;
  inrLabel: string;
  eurLabel: string;
  baseHint?: string;
  defaultInr?: string;
  defaultEur?: string;
}) {
  const [inr, setInr] = useState(defaultInr);
  const [eur, setEur] = useState(defaultEur);
  /**
   * Which box the person actually typed in. Seeded from the defaults so EDITING an existing
   * record does not immediately overwrite the other stored amount: a row saved with both parts
   * (a real split payment) opens unlocked rather than silently collapsing to one currency.
   */
  const [source, setSource] = useState<Source>(() => {
    const hasInr = parseMajor(defaultInr) !== null;
    const hasEur = parseMajor(defaultEur) !== null;
    if (hasInr && hasEur) return null; // stored split — leave both editable
    if (hasInr) return "INR";
    if (hasEur) return "EUR";
    return null;
  });
  const [split, setSplit] = useState(
    () => parseMajor(defaultInr) !== null && parseMajor(defaultEur) !== null,
  );
  const inrRef = useRef<HTMLInputElement>(null);

  const usable = fxRate > 0;
  const mirroring = !split && usable;

  // A successful save calls form.reset(); clear our state with it, or the boxes would keep
  // showing the previous entry's amounts while the rest of the form empties.
  useEffect(() => {
    const form = inrRef.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setInr("");
      setEur("");
      setSource(null);
      setSplit(false);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  /** Typing in one box drives the other, until the box is emptied again. */
  const onInr = (raw: string) => {
    setInr(raw);
    if (!mirroring) return;
    const amount = parseMajor(raw);
    if (amount === null) {
      // Emptied — release the pairing so the other currency can be used instead.
      if (source === "INR") { setSource(null); setEur(""); }
      return;
    }
    setSource("INR");
    setEur(toInput(amount / fxRate));
  };

  const onEur = (raw: string) => {
    setEur(raw);
    if (!mirroring) return;
    const amount = parseMajor(raw);
    if (amount === null) {
      if (source === "EUR") { setSource(null); setInr(""); }
      return;
    }
    setSource("EUR");
    setInr(toInput(amount * fxRate));
  };

  // §4.2: the conversion used to assert a rate with no provenance, so there was no way to tell
  // a live ECB rate from a cached or fallback one. Name the source and the publication date.
  const rateNote = usable
    ? `at ${formatInrMinor(toMinor(fxRate))}/€ · ECB${fxDate ? ` ${formatDate(fxDate)}` : ""}${
        fxStale ? " · cached, may be stale" : ""
      }`
    : "";

  const derived = (side: "INR" | "EUR") => mirroring && source !== null && source !== side;
  const inrDerived = derived("INR");
  const eurDerived = derived("EUR");
  const convertedHint = `Converted ${rateNote} — not stored separately`;

  return (
    <>
      <Field label={inrLabel} hint={inrDerived ? convertedHint : baseHint}>
        <TextInput
          ref={inrRef}
          name={inrName}
          kind="money"
          placeholder="0.00"
          value={inr}
          // `disabled`, not `readOnly`: a disabled control is omitted from FormData, which is
          // precisely what stops the mirrored figure being added on top of the real one.
          disabled={inrDerived}
          onChange={(e) => onInr(e.currentTarget.value)}
        />
      </Field>
      <Field
        label={eurLabel}
        hint={
          eurDerived
            ? convertedHint
            : usable && parseMajor(eur) !== null && !mirroring
              ? `≈ ${formatInrMinor(toMinor(parseMajor(eur)! * fxRate))} ${rateNote}`
              : undefined
        }
      >
        <TextInput
          name={eurName}
          kind="money"
          placeholder="0.00"
          value={eur}
          disabled={eurDerived}
          onChange={(e) => onEur(e.currentTarget.value)}
        />
      </Field>

      {/* The escape hatch for a payment that genuinely arrived as part ₹ and part €. Rendered
          only once an amount exists, so an empty form stays uncluttered. */}
      {usable && (source !== null || split) && (
        <p className="-mt-2 text-caption text-muted sm:col-span-2">
          {split ? (
            <>
              Both currencies are stored as entered.{" "}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => { setSplit(false); setSource("INR"); setEur(toInput((parseMajor(inr) ?? 0) / fxRate)); }}
              >
                Convert automatically instead
              </button>
            </>
          ) : (
            <>
              Stored in {source === "EUR" ? "EUR" : "INR"} — the other box is the converted
              equivalent.{" "}
              <button
                type="button"
                className="font-medium text-accent hover:underline"
                onClick={() => setSplit(true)}
              >
                Enter each currency separately
              </button>
            </>
          )}
        </p>
      )}
    </>
  );
}
