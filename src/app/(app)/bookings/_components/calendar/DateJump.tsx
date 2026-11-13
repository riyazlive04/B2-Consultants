"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DatePicker } from "@/components/ui/DatePicker";

/**
 * The range being shown, and the picker that jumps to another date - Synamate puts both in the
 * label itself, but the house DatePicker renders its own date on the trigger, and giving a shared
 * control a one-caller "custom trigger text" prop costs more than putting the range beside it.
 * All this has to do is write `?date=` and let the page re-render on the server.
 */
export function DateJump({ dayKey, label }: { dayKey: string; label: string }) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-sm font-semibold">{label}</span>
      <DatePicker
        size="sm"
        aria-label="Jump to a date"
        value={dayKey}
        onChange={(e) => {
          const value = e.currentTarget.value;
          if (!value) return;
          const next = new URLSearchParams(params);
          next.set("date", value);
          router.push(`/bookings?${next}`);
        }}
      />
    </div>
  );
}
