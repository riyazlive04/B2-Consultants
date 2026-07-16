/**
 * CV ↔ JD diagnostic (report §3.C P1) - DETERMINISTIC, no AI, runs in the browser.
 * A coaching aid in the summit's language ("what's broken in your CV"), never a
 * rewriter: it scores, names gaps and flags weak bullets; the human fixes them.
 *
 * The conformance layer measures the CV against B2's own resume template - the
 * "How to edit the resume" manual (EN + DE). That manual is the canonical shape
 * every B2 student is handed, so we grade against its cover page + section spine
 * and catch any red placeholder text left unfilled ("Position Name", "mm/jjjj",
 * "xxxx@gmail.com", …). Suggestions are GENERATED from the gaps, prioritised
 * risk-first - still coaching ("fix this, here's how"), never a rewrite.
 */

import type { SignalLevel } from "@/lib/signals";

const STOPWORDS = new Set(
  `a an and are as at be by for from has have in is it its of on or that the to was were will with you your we our they this these those i he she them his her not но und der die das mit für von im auf ist eine ein den zu bei am
  ability experience work team job role company skills strong good excellent knowledge including etc across using use used required requirements responsibilities candidate must plus years year month months`
    .split(/\s+/)
    .filter(Boolean),
);

const ACTION_VERBS = new Set(
  `achieved built delivered designed developed drove engineered established implemented improved increased launched led managed optimised optimized reduced redesigned scaled shipped spearheaded streamlined transformed automated migrated architected`
    .split(/\s+/),
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+#./-]/gu, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((t) => t.length > 1 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/** Term frequency of the JD, so repeated JD terms weigh more. */
function keywordWeights(jdTokens: string[]): Map<string, number> {
  const w = new Map<string, number>();
  for (const t of jdTokens) w.set(t, (w.get(t) ?? 0) + 1);
  return w;
}

// ───────────────────────── B2 template conformance ─────────────────────────

export type TemplateGroup = "Cover page" | "Core sections" | "Additional qualification" | "Format";

export type TemplateCheck = {
  key: string;
  group: TemplateGroup;
  label: string;
  present: boolean;
  hint: string; // what the B2 template wants here
};

export type PlaceholderHit = { label: string; sample: string };

export type Suggestion = {
  level: SignalLevel; // risk = fix now, watch = should fix, ok = polish
  title: string;
  detail: string;
};

/** High-precision markers of un-edited template text (the manual's red placeholders). */
const PLACEHOLDER_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "Name placeholder “First Name, Surname”", re: /\bfirst\s*name,?\s*surname\b/i },
  { label: "“Position Name / Position Code”", re: /\bposition\s*(name|code)\b/i },
  { label: "“Company Name / Firmenname”", re: /\b(company name|firmenname)\b/i },
  { label: "“University Name / Universitätsname”", re: /\b(university name|universitätsname)\b/i },
  { label: "“Course of Study / Studiengang”", re: /\b(course of study|studiengang)\b/i },
  { label: "Unnamed roles “Postion Name”", re: /\bpostion name\b/i },
  { label: "Bullet placeholders “Task 1 / Aufgabe 1”", re: /\b(task\s*[12]|aufgabe\s*[12])\b/i },
  { label: "“Expertise 1…7” / “Expert in…”", re: /\b(expertise\s*[1-7]\b|expert in[…]|expert in\.\.\.)/i },
  { label: "Date placeholder “mm/jjjj” / “mm/yyyy”", re: /\bmm\s*\/\s*(jjjj|yyyy)\b/i },
  { label: "DOB placeholder “dd.mm.jjjj”", re: /\bdd\.mm\.(jjjj|yyyy|jj)\b/i },
  { label: "Phone placeholder “+xx xxx”", re: /\+?\bx{2}\s*x{3}\b/i },
  { label: "Email placeholder “xxxx@…”", re: /x{5,}\s*@/i },
  { label: "Address placeholder (Street/Pin/PLZ)", re: /\b(street name|house nr|pin code|straße,\s*haus|plz stadt)\b/i },
  { label: "Unfilled travel readiness “Reisebereitschaft in %”", re: /reisebereitschaft in %/i },
  { label: "Unfilled marital status", re: /\b(marital status,\s*no location|familienstand,\s*ortsungebunden)\b/i },
];

function findPlaceholders(text: string): PlaceholderHit[] {
  const hits: PlaceholderHit[] = [];
  for (const p of PLACEHOLDER_PATTERNS) {
    const m = p.re.exec(text);
    if (m) hits.push({ label: p.label, sample: m[0].trim().slice(0, 40) });
  }
  return hits;
}

type TemplateRule = Omit<TemplateCheck, "present"> & { test: (t: string) => boolean };

/** Section spine of the B2 manual - EN + DE keywords, since students target Germany. */
const TEMPLATE_RULES: TemplateRule[] = [
  {
    key: "contact",
    group: "Cover page",
    label: "Phone & email in the header",
    hint: "Mobile + e-mail at the very top - recruiters need one-tap contact (manual: header line).",
    test: (t) => /@/.test(t) && /(\+\d|mobil|mobile|phone|\btel\b|whats)/i.test(t),
  },
  {
    key: "highlights",
    group: "Cover page",
    label: "“What I have to offer” highlights",
    hint: "6-7 crisp ✔ bullets of top skills on the cover - the recruiter's 10-second scan.",
    test: (t) =>
      /(what i have to offer|zu bieten|profile summary|professional summary|key strengths|core competenc|about me|objective|highlights)/i.test(t),
  },
  {
    key: "dob",
    group: "Cover page",
    label: "Date of birth",
    hint: "German CVs carry a DOB (“born on / geboren am”) - it's expected, its absence is noticed.",
    test: (t) => /(born on|date of birth|d\.o\.b|geboren am|\bdob\b)/i.test(t) || /\b\d{2}[.\/]\d{2}[.\/]\d{4}\b/.test(t),
  },
  {
    key: "travel",
    group: "Cover page",
    label: "Relocation / travel readiness",
    hint: "State “no location restrictions / open to relocation / Reisebereitschaft %” - German recruiters filter on it.",
    test: (t) => /(reisebereitschaft|relocat|no location restriction|ortsungebunden|willing to travel|open to reloc|mobility)/i.test(t),
  },
  {
    key: "experience",
    group: "Core sections",
    label: "Professional experience",
    hint: "Reverse-chronological roles: date range · Company, City, Country · Position · task bullets.",
    test: (t) => /(professional experience|work experience|berufserfahrung|berufliche stationen|employment history|work history)/i.test(t),
  },
  {
    key: "education",
    group: "Core sections",
    label: "Education",
    hint: "Reverse-chronological: date range · University, City, Country · course of study.",
    test: (t) => /(education|ausbildung|academic (background|qualification)|educational qualification)/i.test(t),
  },
  {
    key: "certifications",
    group: "Additional qualification",
    label: "Certifications",
    hint: "Dated certificate/course list (manual's Certifications / Weiterbildung block).",
    test: (t) => /(certification|certificate|weiterbildung|licenses|credential|online course)/i.test(t),
  },
  {
    key: "languages",
    group: "Additional qualification",
    label: "Languages with proficiency levels",
    hint: "Name each language + a level (Native/Fluent/Basic or A1-C2) - not just “English, German”.",
    test: (t) =>
      /(languages?|sprachen)/i.test(t) &&
      /(native|fluent|basic|conversational|mother tongue|muttersprache|fließend|grundkenntnisse|\b[abc][12]\b)/i.test(t),
  },
  {
    key: "computer",
    group: "Additional qualification",
    label: "Computer / technical skills",
    hint: "A scannable skills block graded Very good / Good / Basic (manual's Computer Skills / Computerkenntnisse).",
    test: (t) => /(computer skills|computerkenntnisse|technical skills|it skills|tech stack|programming|software|tools)/i.test(t),
  },
  {
    key: "personal",
    group: "Additional qualification",
    label: "Personal skills",
    hint: "Communication, leadership, teamwork, organisation… (manual's Personal Skills / Persönliche Fähigkeiten).",
    test: (t) =>
      /(personal skills|persönliche fähigkeiten|soft skills|interpersonal|communication skills|team ?work|leadership skills)/i.test(t),
  },
  {
    key: "hobbies",
    group: "Additional qualification",
    label: "Hobbies / interests",
    hint: "A short human touch closes the CV (manual's Hobbies / Hobbys).",
    test: (t) => /(hobbies|hobbys|interests|freizeit|pastimes)/i.test(t),
  },
  {
    key: "dates",
    group: "Format",
    label: "Dated roles (mm/yyyy – mm/yyyy)",
    hint: "Every role & degree needs a start–end date range so the timeline reads at a glance.",
    test: (t) => (t.match(/\b(19|20)\d{2}\b/g)?.length ?? 0) >= 2,
  },
  {
    key: "current",
    group: "Format",
    label: "Current role marked (…– present)",
    hint: "Most-recent role should end in “present / heute / current” so it's clearly ongoing.",
    test: (t) => /(present|current|heute|to date|till date|ongoing|\bnow\b)/i.test(t),
  },
];

function runTemplateChecks(lower: string): TemplateCheck[] {
  return TEMPLATE_RULES.map(({ test, ...rest }) => ({ ...rest, present: test(lower) }));
}

// ─────────────────────────────── analysis ───────────────────────────────

export type CvAnalysis = {
  matchScore: number; // 0-100 weighted JD keyword coverage
  conformance: number; // 0-100 B2-template conformance
  matched: string[];
  missing: string[]; // top JD terms absent from the CV
  weakBullets: string[]; // bullets with no action verb AND no number
  sectionChecks: { label: string; ok: boolean; hint: string }[];
  templateChecks: TemplateCheck[];
  placeholders: PlaceholderHit[]; // un-edited red template text
  suggestions: Suggestion[]; // generated, prioritised coaching actions
  stats: { cvWords: number; bullets: number; quantifiedBullets: number };
};

export function analyseCv(cvText: string, jdText: string): CvAnalysis {
  const cvTokens = new Set(tokenize(cvText));
  const jdWeights = keywordWeights(tokenize(jdText));

  let total = 0;
  let hit = 0;
  const matched: string[] = [];
  const missing: Array<[string, number]> = [];
  for (const [term, weight] of jdWeights) {
    total += weight;
    if (cvTokens.has(term)) {
      hit += weight;
      matched.push(term);
    } else {
      missing.push([term, weight]);
    }
  }
  const matchScore = total > 0 ? Math.round((hit / total) * 100) : 0;
  missing.sort((a, b) => b[1] - a[1]);
  const missingTerms = missing.slice(0, 15).map(([t]) => t);

  // Bullet quality: every line starting with a bullet-ish marker
  const bullets = cvText
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => /^[-•*▪‣●]/.test(l) && l.length > 8);
  const weakBullets: string[] = [];
  let quantified = 0;
  for (const b of bullets) {
    const words = b.replace(/^[-•*▪‣●]\s*/, "").toLowerCase();
    const firstWords = words.split(/\s+/).slice(0, 3);
    const hasVerb = firstWords.some((w) => ACTION_VERBS.has(w));
    const hasNumber = /\d/.test(b) || /%|€|₹|\$/.test(b);
    if (hasNumber) quantified++;
    if (!hasVerb && !hasNumber) weakBullets.push(b.slice(0, 110));
  }

  const lower = cvText.toLowerCase();
  const cvWords = cvText.split(/\s+/).filter(Boolean).length;
  const quantRatio = bullets.length > 0 ? quantified / bullets.length : 0;

  const sectionChecks = [
    {
      label: "Contact & LinkedIn",
      ok: /linkedin\.com|@/.test(lower),
      hint: "Recruiters check LinkedIn first - put the URL in the header.",
    },
    {
      label: "Professional summary",
      ok: /summary|profile|about me|objective/.test(lower),
      hint: "3 lines: role + years + the one result that fits this JD.",
    },
    {
      label: "Skills section",
      ok: /skills|kenntnisse|technologies|tech stack/.test(lower),
      hint: "A scannable skills block is what ATS parsers key on.",
    },
    {
      label: "Quantified achievements",
      ok: bullets.length > 0 && quantRatio >= 0.4,
      hint: "At least 4 in 10 bullets should carry a number (%, ₹/€, time saved).",
    },
    {
      label: "Length discipline",
      ok: cvWords >= 250 && cvWords <= 1100,
      hint: cvWords < 250 ? "Too thin - a German CV carries detail." : "Over ~2 pages gets skimmed; cut the oldest roles.",
    },
    {
      label: "German-market signals",
      ok: /german|deutsch|b1|b2|c1|visa|blue card|relocation/.test(lower),
      hint: "State language level + visa/relocation status - German recruiters filter on it.",
    },
  ];

  const templateChecks = runTemplateChecks(lower);
  const conformance = Math.round((templateChecks.filter((c) => c.present).length / templateChecks.length) * 100);
  const placeholders = findPlaceholders(cvText);

  const suggestions = buildSuggestions({
    matchScore,
    missingTerms,
    weakBullets,
    templateChecks,
    placeholders,
    quantRatio,
    bullets: bullets.length,
    cvWords,
  });

  return {
    matchScore,
    conformance,
    matched: matched.slice(0, 30),
    missing: missingTerms,
    weakBullets: weakBullets.slice(0, 8),
    sectionChecks,
    templateChecks,
    placeholders,
    suggestions,
    stats: { cvWords, bullets: bullets.length, quantifiedBullets: quantified },
  };
}

// ─────────────────────── generated suggestions ───────────────────────
// Deterministic coaching lines, risk-first. Each says what's wrong AND how to
// fix it - the student does the writing (report §6 guardrail: never do-it-for-them).

function buildSuggestions(x: {
  matchScore: number;
  missingTerms: string[];
  weakBullets: string[];
  templateChecks: TemplateCheck[];
  placeholders: PlaceholderHit[];
  quantRatio: number;
  bullets: number;
  cvWords: number;
}): Suggestion[] {
  const out: Suggestion[] = [];
  const missingBy = (g: TemplateGroup) => x.templateChecks.filter((c) => c.group === g && !c.present);
  const isMissing = (key: string) => x.templateChecks.some((c) => c.key === key && !c.present);

  // 1 · Un-edited template text — the manual's #1 rule.
  if (x.placeholders.length > 0) {
    out.push({
      level: "risk",
      title: `Replace ${x.placeholders.length} left-over template placeholder${x.placeholders.length > 1 ? "s" : ""}`,
      detail: `The manual says edit every red field before applying. Still unfilled: ${x.placeholders
        .map((p) => `“${p.sample}”`)
        .slice(0, 6)
        .join(", ")}. A CV with placeholder text is auto-rejected.`,
    });
  }

  // 2 · Missing core sections (Experience / Education).
  const missingCore = missingBy("Core sections");
  if (missingCore.length > 0) {
    out.push({
      level: "risk",
      title: `Add the core section${missingCore.length > 1 ? "s" : ""}: ${missingCore.map((c) => c.label).join(" · ")}`,
      detail: missingCore.map((c) => c.hint).join(" "),
    });
  }

  // 3 · JD keyword coverage.
  if (x.matchScore < 50) {
    out.push({
      level: "risk",
      title: `JD match is low (${x.matchScore}%) — mirror the job's language`,
      detail: x.missingTerms.length
        ? `Weave in these JD terms where they're TRUE of the student: ${x.missingTerms.slice(0, 8).join(", ")}. Never keyword-stuff.`
        : "Re-read the JD and echo its wording for the same skills the student already has.",
    });
  } else if (x.matchScore < 75 && x.missingTerms.length) {
    out.push({
      level: "watch",
      title: `Close the JD gap (${x.matchScore}%)`,
      detail: `Add where genuine: ${x.missingTerms.slice(0, 6).join(", ")}.`,
    });
  }

  // 4 · Weak bullets.
  if (x.weakBullets.length > 0) {
    out.push({
      level: "watch",
      title: `Rebuild ${x.weakBullets.length} weak bullet${x.weakBullets.length > 1 ? "s" : ""}`,
      detail:
        "They have no action verb and no number. Recast each as “Verb + what + measurable result” — e.g. “Reduced onboarding time 40% by automating…”.",
    });
  }

  // 5 · Quantification.
  if (x.bullets >= 3 && x.quantRatio < 0.4) {
    out.push({
      level: "watch",
      title: "Add numbers to the achievements",
      detail: `Only ${Math.round(x.quantRatio * 100)}% of bullets carry a metric. Aim for 4 in 10 — %, ₹/€, time saved, team size, volume.`,
    });
  }

  // 6 · Missing additional-qualification blocks.
  const missingAdd = missingBy("Additional qualification");
  if (missingAdd.length > 0) {
    out.push({
      level: "watch",
      title: `Complete the profile: ${missingAdd.map((c) => c.label).join(" · ")}`,
      detail: missingAdd.map((c) => c.hint).join(" "),
    });
  }

  // 7 · German-market cover-page items.
  const germanGaps: string[] = [];
  if (isMissing("dob")) germanGaps.push("date of birth");
  if (isMissing("travel")) germanGaps.push("relocation / travel readiness");
  if (isMissing("highlights")) germanGaps.push("a “What I offer” highlights block");
  if (germanGaps.length) {
    out.push({
      level: "watch",
      title: "Add the German-market cover-page details",
      detail: `Missing: ${germanGaps.join(", ")}. These are standard on a German application and expected by recruiters.`,
    });
  }

  // 8 · Length.
  if (x.cvWords > 0 && x.cvWords < 250) {
    out.push({
      level: "watch",
      title: "Too thin — flesh it out",
      detail: `${x.cvWords} words. A German CV carries detail: expand tasks into outcome-driven bullets.`,
    });
  } else if (x.cvWords > 1100) {
    out.push({
      level: "watch",
      title: "Too long — tighten to ~2 pages",
      detail: `${x.cvWords} words gets skimmed. Cut the oldest roles and trim bullets to the ones that fit this JD.`,
    });
  }

  // 9 · Nothing major — polish.
  if (out.every((s) => s.level !== "risk")) {
    out.push({
      level: "ok",
      title: "Solid base — final polish",
      detail:
        "Proof for reverse-chronological order (newest first), consistent date format, a professional photo, and tailor the top bullets to each JD before sending.",
    });
  }

  const rank: Record<SignalLevel, number> = { risk: 0, watch: 1, ok: 2 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
