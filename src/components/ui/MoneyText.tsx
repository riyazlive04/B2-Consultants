import { formatEurMinor, formatInrMinor } from "@/lib/format";

/**
 * Money display per CONTEXT §6: INR as ₹1,00,000.99 (en-IN), EUR as 100.000,99 € (de-DE).
 * Pass minor units (paise / cents). `both` stacks the EUR aggregate under the INR.
 */
export function MoneyText({
  inrMinor,
  eurMinor,
  compact = false,
  both = false,
}: {
  inrMinor?: bigint | number;
  eurMinor?: bigint | number;
  compact?: boolean;
  both?: boolean;
}) {
  const inr = inrMinor !== undefined ? formatInrMinor(inrMinor, { compact }) : null;
  const eur = eurMinor !== undefined ? formatEurMinor(eurMinor, { compact }) : null;

  if (both && inr && eur) {
    return (
      <span className="tnum">
        {inr} <span className="text-muted">· {eur}</span>
      </span>
    );
  }
  return <span className="tnum">{inr ?? eur ?? "-"}</span>;
}
