/**
 * CV ↔ JD diagnostic (report §3.C P1) - DETERMINISTIC, no AI, runs in the browser.
 * A coaching aid in the summit's language ("what's broken in your CV"), never a
 * rewriter: it scores, names gaps and flags weak bullets; the human fixes them.
 */

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

export type CvAnalysis = {
  matchScore: number; // 0-100 weighted keyword coverage
  matched: string[];
  missing: string[]; // top JD terms absent from the CV
  weakBullets: string[]; // bullets with no action verb AND no number
  sectionChecks: { label: string; ok: boolean; hint: string }[];
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
      ok: bullets.length > 0 && quantified / Math.max(bullets.length, 1) >= 0.4,
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

  return {
    matchScore,
    matched: matched.slice(0, 30),
    missing: missing.slice(0, 15).map(([t]) => t),
    weakBullets: weakBullets.slice(0, 8),
    sectionChecks,
    stats: { cvWords, bullets: bullets.length, quantifiedBullets: quantified },
  };
}
