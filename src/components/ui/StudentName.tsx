/**
 * A student's name with their code beside it (§6.1).
 *
 * Used in every list where a payment or receivable is attributed to a person, because the
 * name alone is not an identifier: the roster holds two "Anna Smith" and two "Karthik", and
 * a payment has already been credited to the wrong one. The code is muted — it is a
 * disambiguator, not the thing being read — and simply absent for records created before
 * the backfill, which keeps old rows readable instead of showing a hole.
 */
export function StudentName({ name, code }: { name: string; code?: string | null }) {
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5">
      <span className="truncate">{name}</span>
      {code && <span className="tnum flex-none text-caption font-medium text-ink-3">{code}</span>}
    </span>
  );
}
