/**
 * The founder's resume template — "how the resume should be". Persisted as JSON in
 * AppSetting("resumeTemplateConfig") the same way the section layout and gamification
 * rulesets are (see src/server/founder-config.ts). No row = the shipped B2 default, so
 * a fresh install renders the canonical template with nothing to seed.
 *
 * It controls three things the founder owns:
 *   1. SECTIONS — which blocks appear, their order and their heading (EN + DE).
 *   2. STYLE   — accent colour, font, page size, and whether the photo/DOB show.
 *   3. ATS     — the rubric the AI review scores against + free-text house rules the
 *                founder wants Claude to enforce (e.g. "insist on relocation readiness").
 *
 * Isomorphic: the builder preview and the DOCX/PDF generators both read it, and the
 * founder editor is a client component.
 */

export type ResumeSectionId =
  | "highlights"
  | "summary"
  | "experience"
  | "education"
  | "certifications"
  | "languages"
  | "computer"
  | "personal"
  | "hobbies";

export type ResumeSectionSetting = {
  id: ResumeSectionId;
  enabled: boolean;
  order: number;
  labelEn: string;
  labelDe: string;
};

export type ResumePageSize = "A4" | "LETTER";
export type ResumeFont = "Helvetica" | "Times-Roman" | "Courier";

export type ResumeStyle = {
  accentColor: string; // hex, e.g. "#0A64E2"
  font: ResumeFont;
  pageSize: ResumePageSize;
  showPhoto: boolean;
  showDob: boolean;
  showHeadline: boolean;
};

export type AtsSeverity = "high" | "medium" | "low";

/**
 * One founder-editable ATS criterion. The AI reviewer is told to enforce every enabled
 * rule (weighted by `weight`, flagged at `severity`) and the offline analyser folds the
 * enabled rules it recognises into its score. New rules can be added freely — an
 * unrecognised rule still steers the AI even though the offline path can't check it.
 */
export type AtsRule = {
  id: string;
  label: string;
  instruction: string; // what a passing CV must do
  weight: number; // relative importance 1-5
  severity: AtsSeverity;
  enabled: boolean;
};

/** Verdict thresholds: atsScore ≥ strong = strong match; ≥ partial = partial; else weak. */
export type AtsBands = { strong: number; partial: number };

export type AtsRubric = {
  weightKeywords: number; // JD keyword coverage
  weightConformance: number; // B2 template conformance
  weightFormatting: number; // ATS-friendliness (dates, quantified bullets, length)
  customInstructions: string; // extra house rules for the AI reviewer
  rules: AtsRule[]; // the editable ATS checklist
  targetKeywords: string[]; // skills/terms the ATS should always check for
  bands: AtsBands; // verdict thresholds
};

export type ResumeTemplateConfig = {
  sections: ResumeSectionSetting[];
  style: ResumeStyle;
  ats: AtsRubric;
};

const DEFAULT_SECTIONS: ResumeSectionSetting[] = [
  { id: "highlights", enabled: true, order: 10, labelEn: "What I have to offer", labelDe: "Was ich zu bieten habe" },
  { id: "summary", enabled: false, order: 20, labelEn: "Profile", labelDe: "Profil" },
  { id: "experience", enabled: true, order: 30, labelEn: "Professional experience", labelDe: "Berufserfahrung" },
  { id: "education", enabled: true, order: 40, labelEn: "Education", labelDe: "Ausbildung" },
  { id: "certifications", enabled: true, order: 50, labelEn: "Certifications", labelDe: "Weiterbildung" },
  { id: "languages", enabled: true, order: 60, labelEn: "Languages", labelDe: "Sprachen" },
  { id: "computer", enabled: true, order: 70, labelEn: "Computer skills", labelDe: "Computerkenntnisse" },
  { id: "personal", enabled: true, order: 80, labelEn: "Personal skills", labelDe: "Persönliche Fähigkeiten" },
  { id: "hobbies", enabled: true, order: 90, labelEn: "Hobbies", labelDe: "Hobbys" },
];

/**
 * The shipped ATS checklist. `id`s are stable so the offline analyser can recognise the
 * built-in rules; founder-added rules get a fresh id and still drive the AI reviewer.
 */
export const DEFAULT_ATS_RULES: AtsRule[] = [
  { id: "no-placeholder", label: "No leftover template text", instruction: "Every placeholder from the template is replaced — no “Position Name”, “mm/jjjj”, “xxxx@…”.", weight: 5, severity: "high", enabled: true },
  { id: "contact-parseable", label: "Parseable contact header", instruction: "Email and phone sit in a plain text header an ATS can read (not inside an image or table).", weight: 4, severity: "high", enabled: true },
  { id: "jd-keywords", label: "Mirrors the JD language", instruction: "Uses the job description’s own words for the skills/tools the candidate genuinely has.", weight: 5, severity: "high", enabled: true },
  { id: "quantified", label: "Quantified achievements", instruction: "At least ~4 in 10 bullets carry a metric (%, €, time saved, volume, team size).", weight: 4, severity: "high", enabled: true },
  { id: "reverse-chron", label: "Dated, reverse-chronological roles", instruction: "Every role and degree has a start–end date, newest first, current role marked “present”.", weight: 3, severity: "medium", enabled: true },
  { id: "standard-headings", label: "Standard section headings", instruction: "Uses conventional headings (Experience, Education, Skills…) an ATS maps to fields.", weight: 3, severity: "medium", enabled: true },
  { id: "ats-safe-layout", label: "ATS-safe layout", instruction: "Single column, no tables / text boxes / multi-column layout that scramble ATS parsing.", weight: 3, severity: "medium", enabled: true },
  { id: "german-signals", label: "German-market signals", instruction: "States date of birth, relocation/Reisebereitschaft and a German language level.", weight: 2, severity: "medium", enabled: true },
  { id: "length", label: "One–two pages", instruction: "Concise: roughly 250–1100 words, oldest/irrelevant roles trimmed.", weight: 1, severity: "low", enabled: true },
];

export const DEFAULT_RESUME_TEMPLATE: ResumeTemplateConfig = {
  sections: DEFAULT_SECTIONS,
  style: {
    accentColor: "#0A64E2",
    font: "Helvetica",
    pageSize: "A4",
    showPhoto: true,
    showDob: true,
    showHeadline: true,
  },
  ats: {
    weightKeywords: 50,
    weightConformance: 25,
    weightFormatting: 25,
    customInstructions: "",
    rules: DEFAULT_ATS_RULES,
    targetKeywords: [],
    bands: { strong: 75, partial: 50 },
  },
};

/** All section ids in canonical order — used to validate/repair a saved config. */
export const ALL_SECTION_IDS: ResumeSectionId[] = DEFAULT_SECTIONS.map((s) => s.id);

const asStr = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const asBool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const asNum = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Coerce a stored blob (or partial hand-edit) into a full, valid config. Any section
 * the founder never touched is filled from the default and unknown sections dropped,
 * so adding a new section id in code lights it up for everyone without a data migration.
 */
export function coerceResumeTemplate(raw: unknown): ResumeTemplateConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const savedSections = new Map<string, Record<string, unknown>>(
    (Array.isArray(r.sections) ? r.sections : [])
      .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === "object")
      .map((s) => [String((s as Record<string, unknown>).id), s]),
  );

  const sections = DEFAULT_SECTIONS.map((def) => {
    const s = savedSections.get(def.id);
    if (!s) return { ...def };
    return {
      id: def.id,
      enabled: asBool(s.enabled, def.enabled),
      order: asNum(s.order, def.order),
      labelEn: asStr(s.labelEn, def.labelEn).trim() || def.labelEn,
      labelDe: asStr(s.labelDe, def.labelDe).trim() || def.labelDe,
    };
  }).sort((a, b) => a.order - b.order);

  const st = (r.style && typeof r.style === "object" ? r.style : {}) as Record<string, unknown>;
  const accent = asStr(st.accentColor, DEFAULT_RESUME_TEMPLATE.style.accentColor);
  const font = st.font;
  const size = st.pageSize;

  const at = (r.ats && typeof r.ats === "object" ? r.ats : {}) as Record<string, unknown>;

  return {
    sections,
    style: {
      accentColor: HEX.test(accent) ? accent : DEFAULT_RESUME_TEMPLATE.style.accentColor,
      font: font === "Times-Roman" || font === "Courier" ? font : "Helvetica",
      pageSize: size === "LETTER" ? "LETTER" : "A4",
      showPhoto: asBool(st.showPhoto, true),
      showDob: asBool(st.showDob, true),
      showHeadline: asBool(st.showHeadline, true),
    },
    ats: {
      weightKeywords: clampWeight(asNum(at.weightKeywords, 50)),
      weightConformance: clampWeight(asNum(at.weightConformance, 25)),
      weightFormatting: clampWeight(asNum(at.weightFormatting, 25)),
      customInstructions: asStr(at.customInstructions, "").slice(0, 4000),
      rules: coerceRules(at.rules),
      targetKeywords: Array.isArray(at.targetKeywords)
        ? at.targetKeywords.map((k) => asStr(k, "").trim()).filter(Boolean).slice(0, 80)
        : [],
      bands: coerceBands(at.bands),
    },
  };
}

function clampWeight(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

const SEVERITIES: AtsSeverity[] = ["high", "medium", "low"];

/**
 * Coerce the ATS rule list. A missing `rules` key (an old config from before rules
 * existed) falls back to the shipped checklist; an explicit array is honoured as-is,
 * including an empty one, so a founder who deletes every rule keeps it deleted.
 */
function coerceRules(raw: unknown): AtsRule[] {
  if (!Array.isArray(raw)) return DEFAULT_ATS_RULES.map((r) => ({ ...r }));
  return raw
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .map((r, i) => {
      const label = asStr(r.label, "").trim();
      const sev = asStr(r.severity, "medium");
      return {
        id: asStr(r.id, "").trim() || `rule-${i}`,
        label,
        instruction: asStr(r.instruction, "").trim(),
        weight: Math.max(1, Math.min(5, Math.round(asNum(r.weight, 3)))),
        severity: (SEVERITIES.includes(sev as AtsSeverity) ? sev : "medium") as AtsSeverity,
        enabled: asBool(r.enabled, true),
      };
    })
    .filter((r) => r.label.length > 0)
    .slice(0, 40);
}

function coerceBands(raw: unknown): AtsBands {
  const b = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  let strong = clampWeight(asNum(b.strong, 75));
  let partial = clampWeight(asNum(b.partial, 50));
  // strong must sit above partial, else the verdict logic is meaningless
  if (partial >= strong) {
    partial = Math.max(0, strong - 10);
    if (partial >= strong) strong = Math.min(100, partial + 10);
  }
  return { strong, partial };
}

/** Enabled ATS rules, heaviest first — what the reviewer enforces. */
export function enabledAtsRules(cfg: ResumeTemplateConfig): AtsRule[] {
  return cfg.ats.rules.filter((r) => r.enabled).sort((a, b) => b.weight - a.weight);
}

/** Turn a 0-100 ATS score into a verdict using the founder's bands. */
export function atsVerdict(score: number, bands: AtsBands): "strong" | "partial" | "weak" {
  if (score >= bands.strong) return "strong";
  if (score >= bands.partial) return "partial";
  return "weak";
}

/** Sections that are on, in the founder's order — what the generators iterate. */
export function orderedEnabledSections(cfg: ResumeTemplateConfig): ResumeSectionSetting[] {
  return cfg.sections.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
}

/** The heading for a section in the resume's language. */
export function sectionLabel(s: ResumeSectionSetting, language: string): string {
  return language === "DE" ? s.labelDe : s.labelEn;
}
