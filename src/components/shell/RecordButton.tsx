"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { QuickRecordModal } from "./QuickRecordModal";

/**
 * Top-bar CTA (§5.4 primary) for the two things the founder records most: an income entry and an
 * expense. Clicking it opens a modal with Income / Expense tabs and the entry form right there, so
 * a payment or cost can be logged from anywhere without navigating to Finance and losing the
 * current screen. Admin-only — Finance is an Admin section — so it's only rendered when the shell
 * knows the viewer can reach it.
 */
export function RecordButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Record income or expense"
        className="press flex h-10 items-center gap-1.5 rounded-full bg-primary px-3.5 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong sm:px-4"
      >
        <Plus size={17} className="flex-none" />
        <span className="hidden sm:inline">Record</span>
      </button>

      <QuickRecordModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
