"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { UploadBox } from "../../_components/document/UploadBox";

/**
 * "New template", as an ACTION rather than a permanently-open form.
 *
 * It used to sit expanded at the top of the library, taking the whole first screen - so the
 * templates themselves, which is what somebody arriving here is looking for, began below the
 * fold. A form you are not filling in is not worth a screen of space.
 *
 * It opens expanded when there are no templates at all (`startOpen`), because then the form IS
 * the page: there is nothing else to look at and the next thing to do is obvious.
 */
export function NewTemplate({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);

  if (!open) {
    return (
      <Btn variant="primary" icon={<Plus size={16} />} onClick={() => setOpen(true)}>
        New template
      </Btn>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-h2 font-semibold">New template</h2>
          <p className="mt-1 text-xs text-muted">
            A <strong>.docx</strong> becomes an editable document here - you can fix wording afterwards
            and merge fields work. A <strong>.pdf</strong> keeps Word&apos;s exact layout and is marked up
            by dragging boxes onto the pages. A template cannot change between the two later.
          </p>
        </div>
        {!startOpen && (
          <Btn variant="ghost" size="sm" icon={<X size={14} />} onClick={() => setOpen(false)}>
            Close
          </Btn>
        )}
      </div>
      <UploadBox
        action="/api/agreements/templates/upload"
        withName
        submitLabel="Create template"
        hint="Up to 10 MB. Older .doc files are not supported - save as .docx."
      />
    </div>
  );
}
