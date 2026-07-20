import { formatEurMinor, formatInrMinor } from "@/lib/format";
import { signedColor } from "@/lib/signals";

/**
 * Money display per CONTEXT §6: INR as ₹1,00,000.99 (en-IN), EUR as 100.000,99 € (de-DE).
 * Pass minor units (paise / cents). `both` stacks the EUR aggregate under the INR.
 *
 * `signed` colours the digits themselves by sign (§5.1: a negative net profit used to
 * turn the card red while the number stayed black). Opt-in, because it only belongs on
 * figures where the sign is a verdict — profit, margin, a balance — not on revenue.
 */
export function MoneyText({
  inrMinor,
  eurMinor,
  compact = false,
  both = false,
  signed = false,
}: {
  inrMinor?: bigint | number;
  eurMinor?: bigint | number;
  compact?: boolean;
  both?: boolean;
  signed?: boolean;
}) {
  const inr = inrMinor !== undefined ? formatInrMinor(inrMinor, { compact }) : null;
  const eur = eurMinor !== undefined ? formatEurMinor(eurMinor, { compact }) : null;

  // Sign comes from whichever amount is actually being shown (INR leads when present).
  const basis = inrMinor !== undefined ? inrMinor : eurMinor;
  const color = signed && basis !== undefined ? signedColor(Number(basis)) : undefined;

  if (both && inr && eur) {
    return (
      <span className="tnum" style={color ? { color } : undefined}>
        {inr} <span className="text-muted">· {eur}</span>
      </span>
    );
  }
  return (
    <span className="tnum" style={color ? { color } : undefined}>
      {inr ?? eur ?? "-"}
    </span>
  );
}
