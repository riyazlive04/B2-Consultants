"use client";

import { useRef, type ReactNode } from "react";
import Image from "next/image";
import { Plus, Trash2, GripVertical, ImagePlus, X } from "lucide-react";
import { Field, TextInput, TextArea, Select } from "@/components/ui/form";
import { Btn } from "@/components/ui/controls";
import { Panel } from "@/components/ui/kit";
import type {
  ResumeData,
  ExperienceItem,
  EducationItem,
  CertificationItem,
  LanguageSkill,
  ComputerSkill,
  SkillLevel,
} from "@/lib/resume-types";

/**
 * The structured CV editor. It edits a ResumeData object through a single onChange —
 * every keystroke produces a new immutable copy so the live preview and the exporters
 * always see the same shape the DB stores. All template sections are editable here;
 * whether a section actually PRINTS is the founder's template call, applied at render.
 */

type Props = { data: ResumeData; onChange: (d: ResumeData) => void };

const LEVELS: SkillLevel[] = ["Very good", "Good", "Basic"];

export function ResumeEditor({ data, onChange }: Props) {
  const patch = (p: Partial<ResumeData>) => onChange({ ...data, ...p });
  const setHeader = (k: keyof ResumeData["header"], v: string) =>
    onChange({ ...data, header: { ...data.header, [k]: v } });

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <EditorSection title="Contact & header">
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Only the four identity fields below carry a `kind`. Everything else in this editor
              is the candidate's own CV copy — a headline reads "Engineer II", a skill is "C++",
              a date is "05/2021" — and a character filter there would silently eat real content.
              A person's name, their email, their phone and their links are the only inputs whose
              alphabet is genuinely fixed. */}
          <Field label="Full name">
            <TextInput kind="name" value={data.header.fullName} onChange={(e) => setHeader("fullName", e.target.value)} placeholder="Jane Doe" />
          </Field>
          <Field label="Headline / target position">
            <TextInput value={data.header.headline} onChange={(e) => setHeader("headline", e.target.value)} placeholder="Mechanical Engineer" />
          </Field>
          <Field label="Email">
            <TextInput kind="email" value={data.header.email} onChange={(e) => setHeader("email", e.target.value)} placeholder="jane@example.com" />
          </Field>
          <Field label="Phone">
            <TextInput kind="phone" value={data.header.phone} onChange={(e) => setHeader("phone", e.target.value)} placeholder="+49 …" />
          </Field>
          <Field label="Location">
            <TextInput value={data.header.location} onChange={(e) => setHeader("location", e.target.value)} placeholder="Frankfurt, Germany" />
          </Field>
          <Field label="Date of birth">
            <TextInput value={data.header.dob} onChange={(e) => setHeader("dob", e.target.value)} placeholder="14.03.1996" />
          </Field>
          <Field label="Nationality">
            <TextInput value={data.header.nationality} onChange={(e) => setHeader("nationality", e.target.value)} placeholder="Indian" />
          </Field>
          <Field label="Relocation / travel readiness">
            <TextInput value={data.header.relocation} onChange={(e) => setHeader("relocation", e.target.value)} placeholder="Open to relocation across Germany" />
          </Field>
          <Field label="LinkedIn">
            <TextInput kind="url" value={data.header.linkedin} onChange={(e) => setHeader("linkedin", e.target.value)} placeholder="linkedin.com/in/…" />
          </Field>
          <Field label="Website / portfolio">
            <TextInput kind="url" value={data.header.website} onChange={(e) => setHeader("website", e.target.value)} placeholder="jane.dev" />
          </Field>
        </div>
        <PhotoField value={data.header.photoDataUrl} onChange={(v) => setHeader("photoDataUrl", v)} />
      </EditorSection>

      {/* ── Highlights ── */}
      <EditorSection title="What I have to offer (highlights)" hint="6–7 crisp bullets — the recruiter's 10-second scan.">
        <StringList items={data.highlights} onChange={(highlights) => patch({ highlights })} placeholder="e.g. 5 years designing HVAC systems" addLabel="Add highlight" />
      </EditorSection>

      {/* ── Summary ── */}
      <EditorSection title="Profile summary" hint="Optional paragraph. Only prints if the founder's template enables the Profile section.">
        <TextArea rows={3} value={data.summary} onChange={(e) => patch({ summary: e.target.value })} placeholder="3 lines: role + years + the one result that fits this JD." />
      </EditorSection>

      {/* ── Experience ── */}
      <EditorSection title="Professional experience">
        <RepeatList<ExperienceItem>
          items={data.experience}
          onChange={(experience) => patch({ experience })}
          empty={{ company: "", city: "", country: "", position: "", start: "", end: "", current: false, bullets: [""] }}
          addLabel="Add role"
          render={(item, update) => (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company"><TextInput value={item.company} onChange={(e) => update({ company: e.target.value })} /></Field>
                <Field label="Position"><TextInput value={item.position} onChange={(e) => update({ position: e.target.value })} /></Field>
                <Field label="City"><TextInput value={item.city} onChange={(e) => update({ city: e.target.value })} /></Field>
                <Field label="Country"><TextInput value={item.country} onChange={(e) => update({ country: e.target.value })} /></Field>
                <Field label="Start (mm/yyyy)"><TextInput value={item.start} onChange={(e) => update({ start: e.target.value })} placeholder="05/2021" /></Field>
                <Field label="End (mm/yyyy)">
                  <TextInput value={item.end} disabled={item.current} onChange={(e) => update({ end: e.target.value })} placeholder="present" />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-ink-2">
                <input type="checkbox" checked={item.current} onChange={(e) => update({ current: e.target.checked })} className="h-4 w-4 accent-[var(--primary)]" />
                Current role (ends “present”)
              </label>
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">Achievement bullets</p>
                <StringList items={item.bullets} onChange={(bullets) => update({ bullets })} placeholder="Verb + what + measurable result (e.g. Reduced onboarding time 40% …)" addLabel="Add bullet" />
              </div>
            </div>
          )}
          summary={(it) => it.company || it.position || "New role"}
        />
      </EditorSection>

      {/* ── Education ── */}
      <EditorSection title="Education">
        <RepeatList<EducationItem>
          items={data.education}
          onChange={(education) => patch({ education })}
          empty={{ institution: "", city: "", country: "", program: "", start: "", end: "", note: "" }}
          addLabel="Add education"
          render={(item, update) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Institution"><TextInput value={item.institution} onChange={(e) => update({ institution: e.target.value })} /></Field>
              <Field label="Course of study"><TextInput value={item.program} onChange={(e) => update({ program: e.target.value })} /></Field>
              <Field label="City"><TextInput value={item.city} onChange={(e) => update({ city: e.target.value })} /></Field>
              <Field label="Country"><TextInput value={item.country} onChange={(e) => update({ country: e.target.value })} /></Field>
              <Field label="Start"><TextInput value={item.start} onChange={(e) => update({ start: e.target.value })} placeholder="10/2016" /></Field>
              <Field label="End"><TextInput value={item.end} onChange={(e) => update({ end: e.target.value })} placeholder="09/2020" /></Field>
              <div className="sm:col-span-2">
                <Field label="Note (grade, thesis, honours)"><TextInput value={item.note} onChange={(e) => update({ note: e.target.value })} /></Field>
              </div>
            </div>
          )}
          summary={(it) => it.institution || it.program || "New entry"}
        />
      </EditorSection>

      {/* ── Certifications ── */}
      <EditorSection title="Certifications">
        <RepeatList<CertificationItem>
          items={data.certifications}
          onChange={(certifications) => patch({ certifications })}
          empty={{ name: "", issuer: "", date: "" }}
          addLabel="Add certification"
          render={(item, update) => (
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Name"><TextInput value={item.name} onChange={(e) => update({ name: e.target.value })} /></Field>
              <Field label="Issuer"><TextInput value={item.issuer} onChange={(e) => update({ issuer: e.target.value })} /></Field>
              <Field label="Date"><TextInput value={item.date} onChange={(e) => update({ date: e.target.value })} /></Field>
            </div>
          )}
          summary={(it) => it.name || "New certification"}
        />
      </EditorSection>

      {/* ── Languages ── */}
      <EditorSection title="Languages" hint="Name each language with a level (Native / Fluent / C1 …).">
        <RepeatList<LanguageSkill>
          items={data.languages}
          onChange={(languages) => patch({ languages })}
          empty={{ name: "", level: "" }}
          addLabel="Add language"
          inline
          render={(item, update) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Language"><TextInput value={item.name} onChange={(e) => update({ name: e.target.value })} placeholder="German" /></Field>
              <Field label="Level"><TextInput value={item.level} onChange={(e) => update({ level: e.target.value })} placeholder="B2 / Fluent" /></Field>
            </div>
          )}
          summary={(it) => it.name || "New language"}
        />
      </EditorSection>

      {/* ── Computer skills ── */}
      <EditorSection title="Computer / technical skills">
        <RepeatList<ComputerSkill>
          items={data.computerSkills}
          onChange={(computerSkills) => patch({ computerSkills })}
          empty={{ name: "", level: "Good" }}
          addLabel="Add skill"
          inline
          render={(item, update) => (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Skill"><TextInput value={item.name} onChange={(e) => update({ name: e.target.value })} placeholder="AutoCAD" /></Field>
              <Field label="Level">
                <Select value={item.level} onChange={(e) => update({ level: e.target.value as SkillLevel })} options={LEVELS.map((l) => ({ value: l, label: l }))} />
              </Field>
            </div>
          )}
          summary={(it) => it.name || "New skill"}
        />
      </EditorSection>

      {/* ── Personal skills & hobbies ── */}
      <EditorSection title="Personal skills">
        <StringList items={data.personalSkills} onChange={(personalSkills) => patch({ personalSkills })} placeholder="Communication, leadership, teamwork…" addLabel="Add skill" />
      </EditorSection>
      <EditorSection title="Hobbies / interests">
        <StringList items={data.hobbies} onChange={(hobbies) => patch({ hobbies })} placeholder="Cycling, chess…" addLabel="Add hobby" />
      </EditorSection>
    </div>
  );
}

// ───────────────────────────── building blocks ─────────────────────────────

function EditorSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <h3 className="font-display text-h3 text-ink">{title}</h3>
      {hint && <p className="mb-2 mt-0.5 text-caption text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-2"}>{children}</div>
    </div>
  );
}

/** A list of single-line strings with add / remove. */
function StringList({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <TextInput value={v} placeholder={placeholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="grid h-10 w-10 flex-none place-items-center rounded-btn text-ink-3 transition-colors hover:bg-risk-soft hover:text-risk"
          >
            <X size={16} />
          </button>
        </div>
      ))}
      <Btn size="sm" variant="soft" icon={<Plus size={14} />} onClick={() => onChange([...items, ""])}>
        {addLabel}
      </Btn>
    </div>
  );
}

/** A list of structured items with add / remove / reorder. */
function RepeatList<T>({
  items,
  onChange,
  empty,
  render,
  summary,
  addLabel,
  inline,
}: {
  items: T[];
  onChange: (v: T[]) => void;
  empty: T;
  render: (item: T, update: (patch: Partial<T>) => void) => ReactNode;
  summary: (item: T) => string;
  addLabel: string;
  inline?: boolean;
}) {
  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onChange(next);
  };
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <Panel key={i}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 text-caption font-semibold uppercase tracking-wide text-muted">
              <GripVertical size={14} className="text-ink-3" /> {summary(item)}
            </span>
            <div className="flex items-center gap-1">
              {!inline && (
                <>
                  <button type="button" aria-label="Move up" onClick={() => move(i, i - 1)} className="rounded px-1.5 py-0.5 text-caption text-ink-3 hover:bg-surface hover:text-ink">↑</button>
                  <button type="button" aria-label="Move down" onClick={() => move(i, i + 1)} className="rounded px-1.5 py-0.5 text-caption text-ink-3 hover:bg-surface hover:text-ink">↓</button>
                </>
              )}
              <button
                type="button"
                aria-label="Remove"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="grid h-8 w-8 place-items-center rounded-btn text-ink-3 transition-colors hover:bg-risk-soft hover:text-risk"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
          {render(item, (p) => onChange(items.map((x, j) => (j === i ? { ...x, ...p } : x))))}
        </Panel>
      ))}
      <Btn size="sm" variant="soft" icon={<Plus size={14} />} onClick={() => onChange([...items, { ...empty }])}>
        {addLabel}
      </Btn>
    </div>
  );
}

/** Passport-photo upload → data URL (embedded in the PDF only). */
function PhotoField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const pick = (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return; // keep the blob small
    const reader = new FileReader();
    reader.onload = () => onChange(typeof reader.result === "string" ? reader.result : "");
    reader.readAsDataURL(file);
  };
  return (
    <div className="mt-3 flex items-center gap-3">
      {value ? (
        // `value` is always a data: URL from the FileReader above (embedded straight into the
        // PDF) — next/image auto-treats data:/blob: sources as unoptimized, so no
        // remotePatterns config is needed, but the prop is explicit for clarity.
        <Image
          src={value}
          alt="CV photo"
          width={56}
          height={64}
          unoptimized
          className="h-16 w-14 flex-none rounded object-cover"
        />
      ) : (
        <span className="grid h-16 w-14 flex-none place-items-center rounded border border-dashed border-line-strong text-ink-3">
          <ImagePlus size={18} />
        </span>
      )}
      <input ref={ref} type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <Btn size="sm" variant="soft" onClick={() => ref.current?.click()}>{value ? "Change photo" : "Add photo"}</Btn>
      {value && <Btn size="sm" variant="ghost" onClick={() => onChange("")}>Remove</Btn>}
      <span className="text-caption text-muted">PDF only · ATS DOCX stays photo-free</span>
    </div>
  );
}
