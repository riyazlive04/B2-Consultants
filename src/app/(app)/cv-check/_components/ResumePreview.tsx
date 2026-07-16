"use client";

import type { ReactNode } from "react";
import type { ResumeData } from "@/lib/resume-types";
import {
  orderedEnabledSections,
  sectionLabel,
  type ResumeTemplateConfig,
  type ResumeSectionId,
} from "@/lib/resume-template";

/**
 * Live HTML preview of the CV — a faithful-enough mirror of the PDF so the coach sees
 * the founder's template (section order, headings, accent, photo/DOB toggles) update as
 * they type. The PDF/DOCX exporters are the source of truth for print; this is the glance.
 */

const FONT_STACK: Record<ResumeTemplateConfig["style"]["font"], string> = {
  Helvetica: "Arial, Helvetica, sans-serif",
  "Times-Roman": "'Times New Roman', Times, serif",
  Courier: "'Courier New', Courier, monospace",
};

function range(start: string, end: string, current: boolean) {
  return [start, current ? "present" : end].filter(Boolean).join(" – ");
}
function place(city: string, country: string) {
  const loc = [city, country].filter(Boolean).join(", ");
  return loc ? `, ${loc}` : "";
}

export function ResumePreview({
  data,
  cfg,
  language,
}: {
  data: ResumeData;
  cfg: ResumeTemplateConfig;
  language: string;
}) {
  const accent = cfg.style.accentColor;
  const h = data.header;
  const line1 = [h.email, h.phone, h.location].filter(Boolean).join("   ·   ");
  const line2 = [
    cfg.style.showDob && h.dob ? `Born ${h.dob}` : "",
    h.nationality,
    h.relocation,
    h.linkedin,
    h.website,
  ]
    .filter(Boolean)
    .join("   ·   ");

  const heading = (text: string) => (
    <p
      className="mb-1 mt-4 border-b pb-0.5 text-[10.5px] font-bold uppercase tracking-wider"
      style={{ color: accent, borderColor: accent }}
    >
      {text}
    </p>
  );

  return (
    <div
      className="mx-auto max-w-[720px] rounded-card border border-line bg-white p-8 text-[12px] leading-relaxed text-[#1A2233] shadow-card"
      style={{ fontFamily: FONT_STACK[cfg.style.font] }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[24px] font-bold leading-tight" style={{ color: accent }}>{h.fullName || "Your Name"}</p>
          {cfg.style.showHeadline && h.headline ? <p className="text-[13px] text-[#3A465C]">{h.headline}</p> : null}
          {line1 ? <p className="mt-2 text-[10.5px] text-[#4A566E]">{line1}</p> : null}
          {line2 ? <p className="text-[10.5px] text-[#4A566E]">{line2}</p> : null}
        </div>
        {cfg.style.showPhoto && h.photoDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={h.photoDataUrl} alt="" className="h-24 w-[76px] flex-none rounded object-cover" />
        ) : null}
      </div>
      <div className="mt-2 border-b-2" style={{ borderColor: accent }} />

      {orderedEnabledSections(cfg).map((sec) => {
        const body = renderBody(sec.id, data, accent);
        if (!body) return null;
        return (
          <div key={sec.id}>
            {heading(sectionLabel(sec, language))}
            {body}
          </div>
        );
      })}
    </div>
  );
}

function renderBody(id: ResumeSectionId, d: ResumeData, accent: string): ReactNode {
  const bullets = (items: string[]) =>
    items.filter(Boolean).length ? (
      <ul className="space-y-0.5">
        {items.filter(Boolean).map((b, i) => (
          <li key={i} className="flex gap-1.5">
            <span style={{ color: accent }}>•</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
    ) : null;

  switch (id) {
    case "highlights":
      return bullets(d.highlights);
    case "summary":
      return d.summary.trim() ? <p>{d.summary}</p> : null;
    case "experience":
      return d.experience.length ? (
        <div className="space-y-2">
          {d.experience.map((e, i) => (
            <div key={i}>
              <div className="flex justify-between gap-3">
                <span className="font-semibold">{e.company}{place(e.city, e.country)}</span>
                <span className="whitespace-nowrap text-[10.5px] text-[#636F85]">{range(e.start, e.end, e.current)}</span>
              </div>
              {e.position ? <p className="text-[11px] text-[#3A465C]">{e.position}</p> : null}
              {bullets(e.bullets)}
            </div>
          ))}
        </div>
      ) : null;
    case "education":
      return d.education.length ? (
        <div className="space-y-2">
          {d.education.map((e, i) => (
            <div key={i}>
              <div className="flex justify-between gap-3">
                <span className="font-semibold">{e.institution}{place(e.city, e.country)}</span>
                <span className="whitespace-nowrap text-[10.5px] text-[#636F85]">{range(e.start, e.end, false)}</span>
              </div>
              {e.program || e.note ? <p className="text-[11px] text-[#3A465C]">{[e.program, e.note].filter(Boolean).join(" — ")}</p> : null}
            </div>
          ))}
        </div>
      ) : null;
    case "certifications":
      return bullets(d.certifications.map((c) => [c.name, c.issuer, c.date].filter(Boolean).join(", ")));
    case "languages":
      return d.languages.some((l) => l.name) ? (
        <p>{d.languages.filter((l) => l.name).map((l) => `${l.name}${l.level ? ` (${l.level})` : ""}`).join("   ·   ")}</p>
      ) : null;
    case "computer":
      return d.computerSkills.some((c) => c.name) ? (
        <p>{d.computerSkills.filter((c) => c.name).map((c) => `${c.name} — ${c.level}`).join("   ·   ")}</p>
      ) : null;
    case "personal":
      return d.personalSkills.some(Boolean) ? <p>{d.personalSkills.filter(Boolean).join("   ·   ")}</p> : null;
    case "hobbies":
      return d.hobbies.some(Boolean) ? <p>{d.hobbies.filter(Boolean).join("   ·   ")}</p> : null;
    default:
      return null;
  }
}
