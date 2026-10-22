"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Paperclip } from "lucide-react";
import {
  defaultFieldLabel,
  type DocField,
  type SignerValues,
} from "@/lib/agreement-doc";

/**
 * The boxes the SIGNER fills: a consent tick, a line of text, a file.
 *
 * ── WHY THESE ARE HERE AND NOT IN THE PDF ───────────────────────────────────────────────────
 * The document is served as a PDF in an iframe, which is a picture - nothing in it can be typed
 * into. So the boxes the founder placed are reproduced here as real controls, in document order,
 * with the captions they carry on the page. What is typed here is stamped into those boxes when
 * the PDF is sealed (`lib/agreement-fill`), so what the signer fills in and what the contract
 * shows are the same thing by construction.
 *
 * ── REQUIRED MEANS REQUIRED ─────────────────────────────────────────────────────────────────
 * An unticked required box blocks signing here AND on the server (`validateSignerValues`). This
 * side exists so they find out before spending their one-time code; the server side is what makes
 * it true.
 */
export function SignerFields({
  token,
  fields,
  values,
  onChange,
  disabled,
}: {
  token: string;
  fields: DocField[];
  values: SignerValues;
  onChange: (next: SignerValues) => void;
  disabled?: boolean;
}) {
  if (fields.length === 0) return null;

  const set = (id: string, value: boolean | string) => onChange({ ...values, [id]: value });

  return (
    <div className="mt-5 space-y-4 rounded-field border border-line bg-surface-2 p-4">
      <p className="text-caption font-semibold uppercase tracking-wide text-ink-2">
        Please complete {fields.length === 1 ? "this" : `these ${fields.length}`} before you sign
      </p>

      {fields.map((field) => {
        const label = field.label?.trim() || defaultFieldLabel(field.kind, field.signer);

        if (field.kind === "CHECKBOX") {
          return (
            <label key={field.id} className="flex items-start gap-3 text-body text-ink">
              <input
                type="checkbox"
                checked={values[field.id] === true}
                disabled={disabled}
                onChange={(e) => set(field.id, e.target.checked)}
                className="mt-0.5 h-[18px] w-[18px] flex-none accent-[var(--primary)]"
              />
              <span>
                {label}
                {field.required && <span className="ml-1 text-bad">*</span>}
              </span>
            </label>
          );
        }

        if (field.kind === "ATTACHMENT") {
          return (
            <AttachmentField
              key={field.id}
              token={token}
              field={field}
              label={label}
              filename={typeof values[field.id] === "string" ? (values[field.id] as string) : null}
              onUploaded={(name) => set(field.id, name)}
              disabled={disabled}
            />
          );
        }

        // A TEXT box the signer fills in.
        return (
          <div key={field.id}>
            <label htmlFor={`f-${field.id}`} className="block text-body text-ink">
              {label}
              {field.required && <span className="ml-1 text-bad">*</span>}
            </label>
            <input
              id={`f-${field.id}`}
              type="text"
              value={typeof values[field.id] === "string" ? (values[field.id] as string) : ""}
              disabled={disabled}
              maxLength={2000}
              onChange={(e) => set(field.id, e.target.value)}
              className="mt-1 h-11 w-full rounded-field border border-line-strong bg-surface px-3 text-body text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary-soft disabled:bg-surface-2"
            />
          </div>
        );
      })}

      {fields.some((f) => f.required) && (
        <p className="text-caption text-faint">
          <span className="text-bad">*</span> required
        </p>
      )}
    </div>
  );
}

/**
 * One upload box.
 *
 * The file goes up IMMEDIATELY rather than being held until the signature is submitted, for two
 * reasons: a signing payload is a server-action argument and cannot carry megabytes, and a signer
 * on a phone deserves to find out that their photo is too large before they draw their name
 * rather than after. What the ceremony then submits is the stored FILENAME, and the server checks
 * that bytes to match it actually exist (`attachmentsSatisfied`).
 */
function AttachmentField({
  token,
  field,
  label,
  filename,
  onUploaded,
  disabled,
}: {
  token: string;
  field: DocField;
  label: string;
  filename: string | null;
  onUploaded: (filename: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("fieldId", field.id);
      form.set("file", file);
      const res = await fetch(`/agreement/${encodeURIComponent(token)}/attachment`, {
        method: "POST",
        body: form,
      });
      const json = (await res.json()) as { ok: boolean; error?: string; filename?: string };
      if (!res.ok || !json.ok || !json.filename) {
        setError(json.error ?? `The upload failed (${res.status}).`);
        return;
      }
      onUploaded(json.filename);
    } catch {
      setError("The file could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div>
      <span className="block text-body text-ink">
        {label}
        {field.required && <span className="ml-1 text-bad">*</span>}
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.docx,application/pdf,image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="block w-full cursor-pointer rounded-field border border-line bg-surface px-3 py-2 text-caption file:mr-3 file:rounded-btn file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-caption file:font-semibold file:text-primary disabled:opacity-60 sm:w-auto"
        />
        {busy && (
          <span className="flex items-center gap-1.5 text-caption text-ink-2">
            <Loader2 size={13} className="animate-spin" /> Uploading…
          </span>
        )}
        {!busy && filename && (
          <span className="flex items-center gap-1.5 text-caption font-medium text-good">
            <CheckCircle2 size={13} /> {filename}
          </span>
        )}
      </div>
      <p className="mt-1 flex items-center gap-1.5 text-caption text-faint">
        <Paperclip size={12} /> PDF, JPG, PNG, WEBP or Word, up to 8 MB.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-caption font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}
