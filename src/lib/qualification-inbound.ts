/**
 * Mapping an EXTERNAL form's qualification answers onto our question catalogue.
 *
 * Isomorphic and pure - no DB, no `server-only`. The DB side is `server/lead-qualification.ts`.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────────
 * The landing page asks the band-score questions, Pabbly relays the submission, and until now
 * `/api/leads/pabbly` read five contact fields off it and threw the rest away. So the score the
 * founders were already collecting never reached the CRM, and the person running the discovery
 * call opened an unscored lead.
 *
 * ── The problem this has to solve ────────────────────────────────────────────────
 * We do not control the sender's vocabulary, on either axis:
 *
 *   FIELD NAMES   the page may post `when_start`, `When Are You Looking To Start?`, `timeline`
 *   ANSWER TEXTS  it posts the human LABEL ("Immediately", "Yes - ready to invest"), never our
 *                 internal slug (`immediately`, `ready_now`)
 *
 * and both change whenever marketing rewrites the page. Hardcoding either would mean scores
 * silently falling to zero the next time someone edits a headline - the exact failure that is
 * hardest to notice, because an unscored lead looks identical to a badly-qualified one.
 *
 * So matching is FOLDED (case, spacing and punctuation are discarded on both sides) and
 * EXTENSIBLE (aliases live in the catalogue, editable at Console → Qualification). Folding alone
 * gets "When_Are_You_Looking_To_Start" onto `whenStartGermany` for free; aliases cover genuine
 * rewording.
 *
 * ── The rule that matters most ───────────────────────────────────────────────────
 * A value we cannot resolve is reported as UNRESOLVED, never scored as zero. Zero is a real
 * score meaning "they answered badly"; an unrecognised answer means "we don't know", and
 * conflating them would quietly downgrade every prospect the moment a label changed. Callers
 * surface the unresolved list so a human can add the alias.
 */

import type { QuestionSpec, AnswerMap } from "./qualification";

/**
 * Fold a key or an answer to its comparison form: lowercase, alphanumerics only.
 *
 * Deliberately aggressive. "When are you looking to start?", "when_start", "When-Start" and
 * "WHENSTART" all fold together, which is what makes the common case need no configuration at
 * all. The cost is that two questions whose names differ ONLY by punctuation would collide -
 * acceptable, because the catalogue's keys are slugs and cannot differ that way.
 */
export function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Payload keys that are contact or plumbing fields, not answers.
 *
 * Used ONLY to keep the "unrecognised fields" report readable - a report listing `utm_source`
 * and `submission_id` every time is a report nobody reads twice. It never affects matching: a
 * question keyed `city` still matches a `city` field.
 */
const NON_ANSWER_KEYS = new Set(
  [
    "name", "full_name", "fullname", "first_name", "firstname", "last_name", "lastname", "fname",
    "phone", "phone_number", "mobile", "whatsapp", "contact_number", "email", "email_address",
    "id", "lead_id", "submission_id", "contact_id", "created_at", "createdat", "timestamp",
    "lead_source", "leadsource", "source", "channel", "platform", "campaign", "campaign_name",
    "form_name", "form_id", "page_url", "referrer", "ip", "ip_address", "user_agent", "consent",
  ].map(fold),
);

/** One question we managed to read an answer for. */
export type MappedAnswer = {
  /** Our catalogue key. */
  key: string;
  /** The catalogue version the answer was read against - pinned onto the stored LeadAnswer. */
  version: number;
  /** The payload field it came from, verbatim - shown in Console so a mapping can be checked. */
  inboundKey: string;
  /** The answer text as posted, verbatim. This is the evidence. */
  rawValue: string;
  /** Our option value, once resolved. Null when the text matched no option. */
  value: string | null;
  /** The 0–5 the resolved option carries. Null when unresolved - NOT zero. */
  score: number | null;
};

export type InboundMapping = {
  /** Ready for `scoreFromAnswers` / `computeBant`. Contains only RESOLVED answers. */
  answers: AnswerMap;
  /** Every question we found a field for, resolved or not. */
  mapped: MappedAnswer[];
  /**
   * We found the question, but its answer text matched no option. The loud case: the founder
   * reworded an option and every lead since has been scoring short on that dimension.
   */
  unresolved: MappedAnswer[];
  /** Payload fields that look like answers but match no question at all. */
  unrecognisedKeys: string[];
  /** True when at least one SCORED dimension got a resolved answer - i.e. worth storing. */
  scorable: boolean;
};

/** Every accepted spelling of one option, folded. `value` and `label` are always accepted. */
function optionAliases(o: QuestionSpec["options"][number]): string[] {
  const extra = Array.isArray(o.aliases) ? o.aliases : [];
  return [o.value, o.label, ...extra].filter(Boolean).map(fold);
}

/** Every accepted spelling of one question's field name, folded. */
function questionKeys(q: QuestionSpec): string[] {
  return [q.key, ...(q.inboundKeys ?? [])].filter(Boolean).map(fold);
}

/**
 * Read a sender's flat payload against the catalogue.
 *
 * `payload` is whatever the webhook received (already unwrapped from any `data`/`fields`
 * envelope). Non-string values are coerced: a form posting a number or a boolean for "years of
 * experience" or "willing to learn German" is ordinary, and rejecting those would lose real
 * answers. Arrays join on ", " so a MULTI_SELECT still leaves readable evidence, though only its
 * first resolvable member scores - MULTI_SELECT scoring is not in the catalogue's remit yet.
 */
export function mapInboundAnswers(
  payload: Record<string, unknown>,
  questions: QuestionSpec[],
): InboundMapping {
  // Fold the payload once - questions × fields would otherwise be a scan per question.
  const byFolded = new Map<string, { key: string; value: string }>();
  for (const [k, v] of Object.entries(payload)) {
    const text = coerce(v);
    if (text === null) continue;
    const f = fold(k);
    // First writer wins: a sender posting both `city` and `City` is one field, not two, and the
    // earlier one is the one a human would have configured against.
    if (!byFolded.has(f)) byFolded.set(f, { key: k, value: text });
  }

  const answers: AnswerMap = {};
  const mapped: MappedAnswer[] = [];
  const unresolved: MappedAnswer[] = [];
  const claimed = new Set<string>();
  let scorable = false;

  for (const q of questions) {
    let hit: { key: string; value: string } | undefined;
    for (const candidate of questionKeys(q)) {
      const found = byFolded.get(candidate);
      if (found) {
        hit = found;
        claimed.add(candidate);
        break; // first alias in catalogue order wins - the order the founder listed them
      }
    }
    if (!hit) continue;

    const foldedValue = fold(hit.value);
    const option = q.options.find((o) => optionAliases(o).includes(foldedValue));

    const entry: MappedAnswer = {
      key: q.key,
      version: q.version,
      inboundKey: hit.key,
      rawValue: hit.value,
      value: option?.value ?? null,
      // The stored score is the option's raw 0–5. `weight` is applied by the scorer, not here,
      // so re-weighting a question does not require re-reading every payload.
      score: option ? option.score : null,
    };

    mapped.push(entry);
    if (option) {
      answers[q.key] = option.value;
      if (q.dimension !== "NONE") scorable = true;
    } else {
      unresolved.push(entry);
    }
  }

  const unrecognisedKeys = [...byFolded.entries()]
    .filter(([f]) => !claimed.has(f) && !NON_ANSWER_KEYS.has(f) && !f.startsWith(fold("utm_")))
    .map(([, v]) => v.key);

  return { answers, mapped, unresolved, unrecognisedKeys, scorable };
}

/** Coerce a payload value to comparable text, or null when there is nothing to read. */
function coerce(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) {
    const parts = v.map(coerce).filter((p): p is string => p !== null);
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}
