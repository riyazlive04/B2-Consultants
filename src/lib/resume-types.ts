/**
 * The structured content of a CV — the single source of truth the builder edits,
 * the DOCX + PDF generators render, and the AI review reads. Isomorphic (client +
 * server): the editor is a client component, the generators run server-side.
 *
 * Shaped around the B2 "How to edit the resume" manual: a cover header (contact,
 * DOB, relocation), a "What I have to offer" highlights block, then Experience,
 * Education, and the additional-qualification spine (Certifications, Languages,
 * Computer skills, Personal skills, Hobbies). Everything is plain JSON so it round-
 * trips through Prisma's Json column without any BigInt/Date boundary problems.
 */

export type ExperienceItem = {
  company: string;
  city: string;
  country: string;
  position: string;
  start: string; // free text, e.g. "05/2021"
  end: string; // "present" for a current role
  current: boolean;
  bullets: string[];
};

export type EducationItem = {
  institution: string;
  city: string;
  country: string;
  program: string; // course of study / degree
  start: string;
  end: string;
  note: string;
};

export type CertificationItem = { name: string; issuer: string; date: string };

export type SkillLevel = "Very good" | "Good" | "Basic";
export type ComputerSkill = { name: string; level: SkillLevel };

export type LanguageSkill = { name: string; level: string }; // level: "Native" | "C1" | "Fluent" | …

export type ResumeHeader = {
  fullName: string;
  headline: string; // target position / professional title
  email: string;
  phone: string;
  location: string; // city, country
  dob: string; // date of birth (German CVs carry it)
  nationality: string;
  relocation: string; // e.g. "Open to relocation across Germany"
  linkedin: string;
  website: string;
  photoDataUrl: string; // optional data: URI for the passport photo
};

export type ResumeData = {
  header: ResumeHeader;
  highlights: string[]; // "What I have to offer" — 6-7 crisp bullets
  summary: string; // optional profile paragraph
  experience: ExperienceItem[];
  education: EducationItem[];
  certifications: CertificationItem[];
  languages: LanguageSkill[];
  computerSkills: ComputerSkill[];
  personalSkills: string[];
  hobbies: string[];
};

export const EMPTY_HEADER: ResumeHeader = {
  fullName: "",
  headline: "",
  email: "",
  phone: "",
  location: "",
  dob: "",
  nationality: "",
  relocation: "",
  linkedin: "",
  website: "",
  photoDataUrl: "",
};

/** A fresh, empty resume with one blank row in each repeatable section to guide the user. */
export function emptyResumeData(): ResumeData {
  return {
    header: { ...EMPTY_HEADER },
    highlights: [""],
    summary: "",
    experience: [
      { company: "", city: "", country: "", position: "", start: "", end: "", current: false, bullets: [""] },
    ],
    education: [{ institution: "", city: "", country: "", program: "", start: "", end: "", note: "" }],
    certifications: [],
    languages: [{ name: "", level: "" }],
    computerSkills: [{ name: "", level: "Good" }],
    personalSkills: [""],
    hobbies: [],
  };
}

const asStr = (v: unknown): string => (typeof v === "string" ? v : "");
const asArr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strList = (v: unknown): string[] => asArr(v).map(asStr).filter((s) => s.length > 0);

/**
 * Coerce arbitrary JSON (a DB row, an AI-parsed import, a hand edit) into a valid
 * ResumeData. Never throws — a malformed field falls back to its empty default so a
 * bad blob can be opened and fixed rather than taking a page down.
 */
export function coerceResumeData(raw: unknown): ResumeData {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const h = (r.header && typeof r.header === "object" ? r.header : {}) as Record<string, unknown>;

  return {
    header: {
      fullName: asStr(h.fullName),
      headline: asStr(h.headline),
      email: asStr(h.email),
      phone: asStr(h.phone),
      location: asStr(h.location),
      dob: asStr(h.dob),
      nationality: asStr(h.nationality),
      relocation: asStr(h.relocation),
      linkedin: asStr(h.linkedin),
      website: asStr(h.website),
      photoDataUrl: asStr(h.photoDataUrl),
    },
    highlights: strList(r.highlights),
    summary: asStr(r.summary),
    experience: asArr(r.experience).map((x) => {
      const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        company: asStr(e.company),
        city: asStr(e.city),
        country: asStr(e.country),
        position: asStr(e.position),
        start: asStr(e.start),
        end: asStr(e.end),
        current: e.current === true,
        bullets: strList(e.bullets),
      };
    }),
    education: asArr(r.education).map((x) => {
      const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return {
        institution: asStr(e.institution),
        city: asStr(e.city),
        country: asStr(e.country),
        program: asStr(e.program),
        start: asStr(e.start),
        end: asStr(e.end),
        note: asStr(e.note),
      };
    }),
    certifications: asArr(r.certifications).map((x) => {
      const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { name: asStr(e.name), issuer: asStr(e.issuer), date: asStr(e.date) };
    }),
    languages: asArr(r.languages).map((x) => {
      const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { name: asStr(e.name), level: asStr(e.level) };
    }),
    computerSkills: asArr(r.computerSkills).map((x) => {
      const e = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      const lvl = asStr(e.level);
      const level: SkillLevel = lvl === "Very good" || lvl === "Basic" ? lvl : "Good";
      return { name: asStr(e.name), level };
    }),
    personalSkills: strList(r.personalSkills),
    hobbies: strList(r.hobbies),
  };
}

/** Flatten a resume to plain text — what the AI review and the deterministic analyser read. */
export function resumeToPlainText(d: ResumeData): string {
  const lines: string[] = [];
  const { header: h } = d;
  lines.push(h.fullName, h.headline);
  lines.push([h.email, h.phone, h.location].filter(Boolean).join(" · "));
  lines.push(
    [h.dob && `Born ${h.dob}`, h.nationality, h.relocation, h.linkedin, h.website].filter(Boolean).join(" · "),
  );
  if (d.summary) lines.push("", "Profile", d.summary);
  if (d.highlights.length) {
    lines.push("", "What I have to offer");
    for (const b of d.highlights) lines.push(`- ${b}`);
  }
  if (d.experience.length) {
    lines.push("", "Professional experience");
    for (const e of d.experience) {
      lines.push(`${e.start} – ${e.current ? "present" : e.end} · ${e.company}, ${e.city}, ${e.country}`);
      lines.push(e.position);
      for (const b of e.bullets) lines.push(`- ${b}`);
    }
  }
  if (d.education.length) {
    lines.push("", "Education");
    for (const e of d.education) {
      lines.push(`${e.start} – ${e.end} · ${e.institution}, ${e.city}, ${e.country}`);
      lines.push([e.program, e.note].filter(Boolean).join(" — "));
    }
  }
  if (d.certifications.length) {
    lines.push("", "Certifications");
    for (const c of d.certifications) lines.push(`- ${[c.name, c.issuer, c.date].filter(Boolean).join(", ")}`);
  }
  if (d.languages.length) {
    lines.push("", "Languages");
    lines.push(d.languages.map((l) => `${l.name} (${l.level})`).join(", "));
  }
  if (d.computerSkills.length) {
    lines.push("", "Computer skills");
    lines.push(d.computerSkills.map((s) => `${s.name} — ${s.level}`).join(", "));
  }
  if (d.personalSkills.length) {
    lines.push("", "Personal skills");
    lines.push(d.personalSkills.join(", "));
  }
  if (d.hobbies.length) {
    lines.push("", "Hobbies");
    lines.push(d.hobbies.join(", "));
  }
  return lines.filter((l) => l !== undefined).join("\n");
}
