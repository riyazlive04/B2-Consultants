"use client";

import Link from "next/link";
import { FileSignature, FileText, FileType } from "lucide-react";

/**
 * Which document this agreement is drawn up on: the built-in Guided Mode clause set, or one of
 * the uploaded templates.
 *
 * Radio cards rather than a dropdown, because the difference between them is not a label - one is
 * a contract typeset in code with fixed clauses, the others are documents somebody wrote in Word,
 * and the founder needs to see which is which before they pick.
 */

export type UsableTemplate = {
  id: string;
  name: string;
  description: string | null;
  kind: "GUIDED" | "DOCX" | "PDF";
  version: number;
  label: string | null;
  fieldSummary: string;
  sourceName: string;
};

export function DocumentChooser({
  templates,
  value,
  defaultTemplateId = null,
  onChange,
}: {
  templates: UsableTemplate[];
  value: string | null;
  /**
   * Which one the founder set as the default for one-tap sends. Marked rather than merely
   * pre-selected: the form opens on it, and without the badge the founder cannot tell whether
   * the selection is their standing choice or something this screen picked.
   */
  defaultTemplateId?: string | null;
  onChange: (templateId: string | null) => void;
}) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="mb-1 font-display text-h2 font-semibold">The document</h2>
      <p className="mb-4 text-xs text-muted">
        The fields below fill in whichever document you pick - the money and the party stay the same.{" "}
        <Link href="/agreements/templates" className="text-primary hover:underline">
          Manage templates
        </Link>
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <Option
          checked={value === null}
          onSelect={() => onChange(null)}
          icon={<FileSignature size={15} />}
          title="Guided Mode clause set"
          meta={`Built in · the contract B2 has always sent${defaultTemplateId === null ? " · your default" : ""}`}
          body="Fixed clauses, the §7 payment table and the signature block at the end. Nothing to mark up."
        />
        {templates.map((t) => (
          <Option
            key={t.id}
            checked={value === t.id}
            onSelect={() => onChange(t.id)}
            icon={t.kind === "PDF" ? <FileText size={15} /> : <FileType size={15} />}
            title={t.name}
            meta={`${t.kind === "PDF" ? "PDF" : "Word"} · v${t.version}${t.label ? ` · ${t.label}` : ""}${
              t.id === defaultTemplateId ? " · your default" : ""
            } · ${t.fieldSummary}`}
            body={t.description ?? t.sourceName}
          />
        ))}
      </div>
    </section>
  );
}

function Option({
  checked,
  onSelect,
  icon,
  title,
  meta,
  body,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  meta: string;
  body: string;
}) {
  return (
    <label
      className={`flex cursor-pointer gap-3 rounded-field border p-3 transition-colors ${
        checked ? "border-primary bg-primary-soft" : "border-line hover:border-primary/50"
      }`}
    >
      {/* A real radio, kept in the tab order: the cards are the visible control, not the only one. */}
      <input
        type="radio"
        name="agreement-document"
        checked={checked}
        onChange={onSelect}
        className="mt-1 h-4 w-4 flex-none accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-sm font-semibold">
          <span className={checked ? "text-primary" : "text-muted"}>{icon}</span>
          <span className="truncate">{title}</span>
        </span>
        {/*
          Not uppercase. A field summary runs to "3 signatures · 1 set of initials · 3 dates
          signed · 1 printed name · 2 text boxes · 1 tick box · 1 file upload" - which in caps
          with letter-spacing wrapped to three shouting lines and buried the template's name
          directly above it. Caps suit a two-word label, not a sentence.
        */}
        <span className="mt-0.5 block text-[11px] font-medium text-muted">{meta}</span>
        <span className="mt-1 block text-xs text-muted">{body}</span>
      </span>
    </label>
  );
}
