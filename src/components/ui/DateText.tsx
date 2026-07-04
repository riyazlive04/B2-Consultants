import { formatDate } from "@/lib/format";

/** DD/MM/YYYY, IST - the only date rendering used anywhere (CONTEXT §6). */
export function DateText({ date }: { date: Date | string | null | undefined }) {
  if (!date) return <span className="text-muted">-</span>;
  return <time className="tnum">{formatDate(date)}</time>;
}
