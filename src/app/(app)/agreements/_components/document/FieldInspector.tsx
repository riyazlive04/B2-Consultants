"use client";

import { Trash2 } from "lucide-react";
import { Field, Select, TextArea, TextInput } from "@/components/ui/form";
import { Btn } from "@/components/ui/controls";
import {
  FIELD_KINDS,
  FIELD_KIND_LABELS,
  SIGNER_LABELS,
  SIGNER_ROLES,
  defaultFieldLabel,
  type DocField,
  type FieldKind,
  type SignerRole,
} from "@/lib/agreement-doc";

/**
 * One field's settings: who signs it, what it is, what it says.
 *
 * The signer picker is the single most consequential control on the screen - it is what makes a
 * box B2's countersignature rather than the student's - so it is a labelled select with the
 * parties written out, never a two-state toggle the founder has to remember the meaning of.
 */
export function FieldInspector({
  field,
  onChange,
  onRemove,
  /** PDF only: which page it sits on, shown so the list and the canvas agree. */
  pageNote,
}: {
  field: DocField;
  onChange: (next: DocField) => void;
  onRemove: () => void;
  pageNote?: string;
}) {
  const placeholder = defaultFieldLabel(field.kind, field.signer);

  return (
    <div className="space-y-3 rounded-field border border-line bg-surface-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          {FIELD_KIND_LABELS[field.kind]}
          {pageNote ? ` · ${pageNote}` : ""}
        </p>
        <Btn variant="ghost" size="sm" icon={<Trash2 size={14} />} onClick={onRemove} title="Remove this field">
          Remove
        </Btn>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Signed by">
          <Select
            size="sm"
            value={field.signer}
            options={SIGNER_ROLES.map((r) => ({ value: r, label: SIGNER_LABELS[r] }))}
            onChange={(e) => onChange({ ...field, signer: e.target.value as SignerRole })}
          />
        </Field>
        <Field label="Field type">
          <Select
            size="sm"
            value={field.kind}
            options={FIELD_KINDS.map((k) => ({ value: k, label: FIELD_KIND_LABELS[k] }))}
            onChange={(e) => {
              const kind = e.target.value as FieldKind;
              // A kind change drops a value that no longer means anything: only TEXT prints one,
              // and leaving it behind would hide it in the hash with nothing showing it.
              const next: DocField = { ...field, kind };
              if (kind !== "TEXT") delete next.value;
              onChange(next);
            }}
          />
        </Field>
      </div>

      <Field label="Caption" hint="Printed under the box, in small caps. Leave blank for the default.">
        <TextInput
          value={field.label ?? ""}
          placeholder={placeholder}
          maxLength={60}
          onChange={(e) => {
            const label = e.target.value;
            const next = { ...field };
            if (label.trim()) next.label = label;
            else delete next.label;
            onChange(next);
          }}
        />
      </Field>

      {field.kind === "TEXT" && (
        <Field
          label="What it says"
          hint="You fill this in while drafting - the student cannot change it. Merge fields work here too."
        >
          <TextArea
            rows={2}
            value={field.value ?? ""}
            maxLength={2000}
            onChange={(e) => {
              const value = e.target.value;
              const next = { ...field };
              if (value) next.value = value;
              else delete next.value;
              onChange(next);
            }}
          />
        </Field>
      )}
    </div>
  );
}
