"use client";

import { useRef, useState } from "react";
import { FileText, Image as ImageIcon, Paperclip, Sheet, X } from "lucide-react";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_ACCEPT_LABEL,
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
  attachmentRejection,
  extensionOf,
  formatFileSize,
} from "@/lib/attachment";

type Props = {
  files: File[];
  onChange: (files: File[]) => void;
  /** Set while the report is being sent, so nothing can be added to a batch already uploading. */
  disabled?: boolean;
};

/**
 * THE ATTACHMENT PICKER, inside the report form.
 *
 * Plain `<input type="file">` behind a styled button, which is the whole implementation on
 * purpose. A drag-and-drop zone was the alternative and it is worse here: it has to be big enough
 * to aim at, which pushes the rest of this form off a phone screen, and it does nothing for the
 * people most likely to attach something - a student photographing a broken screen, who taps a
 * button and gets their camera roll.
 *
 * ── CHOSEN HERE, UPLOADED AFTER SEND ───────────────────────────────────────────────────────
 * Nothing leaves the browser while this panel is open. The files sit in component state as `File`
 * handles and go up once the report exists and has an id - see `SuggestImprovementModal`. So
 * everything this panel refuses, it refuses for free, and somebody who changes their mind has
 * uploaded nothing.
 *
 * ── REFUSED HERE AND AGAIN ON THE SERVER, FROM ONE FUNCTION ────────────────────────────────
 * `attachmentRejection` is the same call the upload route makes, so the limit the person is
 * shown and the limit that is enforced cannot drift, and the refusal reads the same either way.
 * This panel checks SIZE and COUNT only; the file TYPE is sniffed from the bytes server-side,
 * because `accept` on an input is a hint a browser is free to ignore and a filename proves
 * nothing. A type this app cannot store therefore fails at upload rather than at pick - stated
 * plainly below the button, since the alternative is reading 10 MB in the browser to say so a
 * few seconds earlier.
 */
export function ReportAttachments({ files, onChange, disabled }: Props) {
  const input = useRef<HTMLInputElement>(null);
  /**
   * Held on the panel rather than hoisted into the form: it is about the picking, not about the
   * report, and it must not sit in the same place as a submit error - "that could not be sent"
   * and "that file is too big" are different problems and showing them in one slot means the
   * second one silently replaces the first.
   */
  const [error, setError] = useState<string | null>(null);
  const total = files.reduce((sum, f) => sum + f.size, 0);

  function add(picked: FileList | null) {
    if (!picked?.length) return;
    const next = [...files];
    const refused: string[] = [];

    for (const file of Array.from(picked)) {
      // Checked against `next`, not `files`: picking four files at once has to count the three
      // already accepted in this same loop, or the budget is only enforced one file at a time.
      const why = attachmentRejection(next, { size: file.size, name: file.name });
      if (why) {
        refused.push(why);
        continue;
      }
      // A second pick of the same file is the commonest mis-click here, and silently storing two
      // copies spends the budget on nothing.
      if (next.some((f) => f.name === file.name && f.size === file.size)) continue;
      next.push(file);
    }

    onChange(next);
    /**
     * The input is cleared so that picking the SAME file again still fires `change`. Without it,
     * somebody who removed a file by mistake cannot re-add it - the value has not changed, so the
     * browser raises no event and the button appears dead.
     */
    if (input.current) input.current.value = "";
    // One message, the first one. A list of four refusals for four files is not read.
    setError(refused[0] ?? null);
  }

  return (
    <div className="rounded-field border border-line bg-surface-2 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink">Attach a file (optional)</p>
          <p className="mt-0.5 text-caption text-muted">
            {files.length
              ? `${files.length} of ${ATTACHMENT_MAX_COUNT} · ${formatFileSize(total)}`
              : `The statement, the invoice, the spreadsheet, or a photo of the screen. ${ATTACHMENT_ACCEPT_LABEL}, up to ${formatFileSize(ATTACHMENT_MAX_BYTES)} each.`}
          </p>
        </div>

        <button
          type="button"
          disabled={disabled || files.length >= ATTACHMENT_MAX_COUNT}
          onClick={() => input.current?.click()}
          title={
            files.length >= ATTACHMENT_MAX_COUNT
              ? `You can attach ${ATTACHMENT_MAX_COUNT} files to one report`
              : undefined
          }
          className="press inline-flex h-9 flex-none items-center gap-1.5 rounded-btn border border-line bg-surface px-3 text-caption font-semibold text-ink transition-colors hover:border-primary hover:text-primary-strong disabled:opacity-60"
        >
          <Paperclip size={14} />
          {files.length ? "Add another" : "Choose a file"}
        </button>
      </div>

      <input
        ref={input}
        type="file"
        multiple
        accept={ATTACHMENT_ACCEPT}
        onChange={(e) => add(e.currentTarget.files)}
        className="sr-only"
        /**
         * HIDDEN FROM ASSISTIVE TECH, BUT NOT FROM THE LAYOUT.
         *
         * `aria-hidden` and `tabIndex={-1}` because the styled button above is the control: it is
         * focusable, it is labelled, and it opens this picker. Leaving the input announced too
         * would put two controls in the tab order for one action, the second of them unlabelled.
         *
         * `sr-only` rather than `display:none`, though, which is the part worth writing down -
         * a `display:none` input does not reliably open its picker from a script on every
         * browser, Safari included, and most people filing from a phone are on Safari. Visually
         * hidden but still laid out always works.
         */
        tabIndex={-1}
        aria-hidden="true"
      />

      {!!files.length && (
        <ul className="mt-2.5 space-y-1.5">
          {files.map((file) => (
            <li
              key={`${file.name}:${file.size}`}
              className="flex items-center gap-2 rounded-btn border border-line bg-surface px-2.5 py-1.5"
            >
              <FileGlyph name={file.name} />
              <span className="min-w-0 flex-1 truncate text-caption text-ink" title={file.name}>
                {file.name}
              </span>
              <span className="flex-none text-caption text-muted">{formatFileSize(file.size)}</span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(files.filter((f) => f !== file))}
                title={`Remove ${file.name}`}
                aria-label={`Remove ${file.name}`}
                className="grid h-7 w-7 flex-none place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-caption text-bad">{error}</p>}
    </div>
  );
}

/**
 * An icon from the filename's extension - the one place the client's extension is used for
 * anything, and it decides nothing but which of three glyphs is drawn. The stored type comes from
 * the server's sniff, and the triage screen labels files from that instead.
 */
function FileGlyph({ name }: { name: string }) {
  const ext = extensionOf(name);
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) {
    return <ImageIcon size={14} className="flex-none text-ink-3" aria-hidden />;
  }
  if (["xls", "xlsx", "xlsm", "csv"].includes(ext)) {
    return <Sheet size={14} className="flex-none text-ink-3" aria-hidden />;
  }
  return <FileText size={14} className="flex-none text-ink-3" aria-hidden />;
}
