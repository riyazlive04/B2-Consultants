"use client";

import { useEffect, useRef, useState } from "react";
import { Field, TextInput } from "@/components/ui/form";
import { formatDate, formatEurMinor, formatInrMinor } from "@/lib/format";

/**
 * The ₹ / € amount boxes shared by every money form (income, expense, pending fee).
 *
 * These are NOT two views of the same amount: a record's aggregate is
 * `INR part + EUR part converted` (lib/money.ts), so a payment can be part-INR and
 * part-EUR. Writing the converted value into the sibling box would therefore count
 * the money twice. Instead the equivalent is shown as a live hint, computed at the
 * same rate the server stamps on save (getTodayInrPerEur), so the preview matches
 * what actually gets stored.
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
  const inrRef = useRef<HTMLInputElement>(null);

  // The inputs stay uncontrolled so a successful save's form.reset() still clears
  // them; we mirror their values into state only to render the hints, and clear
  // that state on the same reset event.
  useEffect(() => {
    const form = inrRef.current?.closest("form");
    if (!form) return;
    const onReset = () => {
      setInr("");
      setEur("");
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  const usable = fxRate > 0;
  // §4.2: the conversion preview used to assert a rate with no provenance, so there
  // was no way to tell a live ECB rate from a cached or fallback one. Name the source
  // and the publication date every time the number is shown.
  const rateNote = usable
    ? `at ${formatInrMinor(toMinor(fxRate))}/€ · ECB${fxDate ? ` ${formatDate(fxDate)}` : ""}${
        fxStale ? " · cached, may be stale" : ""
      }`
    : "";

  const inrAmount = parseMajor(inr);
  const eurAmount = parseMajor(eur);

  const inrHint =
    usable && inrAmount !== null
      ? `≈ ${formatEurMinor(toMinor(inrAmount / fxRate))} ${rateNote}`
      : baseHint;

  const eurHint =
    usable && eurAmount !== null
      ? `≈ ${formatInrMinor(toMinor(eurAmount * fxRate))} ${rateNote}`
      : undefined;

  return (
    <>
      <Field label={inrLabel} hint={inrHint}>
        <TextInput
          ref={inrRef}
          name={inrName}
          kind="money"
          placeholder="0.00"
          defaultValue={defaultInr}
          onChange={(e) => setInr(e.currentTarget.value)}
        />
      </Field>
      <Field label={eurLabel} hint={eurHint}>
        <TextInput
          name={eurName}
          kind="money"
          placeholder="0.00"
          defaultValue={defaultEur}
          onChange={(e) => setEur(e.currentTarget.value)}
        />
      </Field>
    </>
  );
}
