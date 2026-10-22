"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Loader2 } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Field, FormError, TextArea, TextInput } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { PLACEHOLDER_HELP } from "@/lib/docx-blocks";

/**
 * Upload a `.docx` or `.pdf`.
 *
 * It posts to a ROUTE, not a server action, and that is not a style choice: a file cannot ride in
 * a server-action argument without being serialised into the action call, which Next caps well
 * below the 10MB a scanned agreement can reach. See the note at the top of
 * `/api/agreements/templates/upload`.
 *
 * Warnings come back from the parse (images dropped, a style mammoth did not recognise) and are
 * shown rather than toasted away: "12 images were left out" is something the founder needs to
 * read before they send the contract, not a message that disappears in four seconds.
 */
export function UploadBox({
  action,
  extra,
  /** New-template mode asks for a name; a new version or a replacement does not. */
  withName = false,
  label = "Choose a .docx or .pdf",
  hint,
  submitLabel = "Upload",
  onDone,
}: {
  action: string;
  /** Extra form fields posted alongside the file - `templateId`, when adding a version. */
  extra?: Record<string, string>;
  withName?: boolean;
  label?: string;
  hint?: string;
  submitLabel?: string;
  /** Where to go afterwards. Omitted means refresh in place. */
  onDone?: (result: { templateId?: string; versionId?: string }) => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const submit = async () => {
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    setError(null);
    setWarnings([]);
    setBusy(true);
    try {
      const form = new FormData();
      form.set("file", file);
      for (const [key, value] of Object.entries(extra ?? {})) form.set(key, value);
      if (withName) {
        form.set("name", name);
        form.set("description", description);
      }
      const res = await fetch(action, { method: "POST", body: form });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        warnings?: string[];
        templateId?: string;
        versionId?: string;
        kind?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `The upload failed (${res.status}).`);
        return;
      }
      setWarnings(json.warnings ?? []);
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
      setName("");
      setDescription("");
      toast(
        json.kind === "PDF"
          ? "PDF uploaded. Place the signature boxes on the pages."
          : "Document uploaded and converted. Check it over and place the signature zones.",
      );
      if (onDone) onDone(json);
      router.refresh();
    } catch {
      setError("The upload could not be sent. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      {withName && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Template name" required>
            <TextInput
              value={name}
              placeholder="GM Coaching Agreement"
              maxLength={120}
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="What it is for">
            <TextArea
              rows={2}
              value={description}
              maxLength={500}
              placeholder="Guided Mode, batches from 2026"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      )}

      <Field label={label} hint={hint}>
        <input
          ref={inputRef}
          type="file"
          accept=".docx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setError(null);
          }}
          className="block w-full cursor-pointer rounded-field border border-line bg-surface px-3 py-2 text-sm file:mr-3 file:rounded-btn file:border-0 file:bg-primary-soft file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-primary hover:border-primary"
        />
      </Field>

      <details className="rounded-field border border-line bg-surface-2 px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-muted">
          Marking up where people sign, in Word
        </summary>
        <ul className="mt-2 space-y-1">
          {PLACEHOLDER_HELP.map((line) => (
            <li key={line} className="font-mono text-[11px] text-ink-2">
              {line}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted">
          Optional - you can place every box here after uploading. A PDF is always marked up here,
          because its text cannot be scanned for placeholders.
        </p>
      </details>

      <FormError message={error} />

      {warnings.length > 0 && (
        <div className="rounded-field border border-warn/40 bg-warn-soft px-3 py-2">
          <p className="text-xs font-semibold text-warn">Worth knowing</p>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
            {warnings.map((w) => (
              <li key={w}>· {w}</li>
            ))}
          </ul>
        </div>
      )}

      <Btn
        variant="primary"
        icon={busy ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
        onClick={submit}
        disabled={busy || !file}
        busy={busy}
      >
        {submitLabel}
      </Btn>
    </div>
  );
}
