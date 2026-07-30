import "server-only";

import { callClaude, extractJson, getAiRuntime } from "@/lib/anthropic";
import { rateLimitOk } from "@/lib/rate-limit";
import {
  buildExtractionUser,
  coerceExtraction,
  EXTRACTION_SYSTEM,
  heuristicExtract,
  type CallNoteExtraction,
} from "@/lib/call-note-extract";

/**
 * The call-note extractor's one impure step: ask Claude, and fall back to the deterministic
 * pass whenever that isn't possible or doesn't land.
 *
 * It rides the SAME keys-off seam as the CV review (lib/anthropic.ts): the key is read from
 * env, the model and pause switch live in AppSetting("aiConfig"), and nothing is sent unless
 * `runtime.enabled`. So on a fresh install — or with the founder's pause on — this feature
 * still works, just on rules instead of a model, and the UI says which.
 *
 * IT NEVER THROWS AND NEVER WRITES. The worst case is an empty suggestion next to a sentence
 * explaining why, in a form the human was going to fill in anyway.
 *
 * Two deliberate departures from the CV review's settings:
 *   - a 20s timeout, not 120s. Someone is staring at a spinner between two calls; a request
 *     that hasn't answered by then has already failed for this purpose.
 *   - max 1024 output tokens. The reply is a small JSON object, and the founder's `maxTokens`
 *     is tuned for a long review — spending that ceiling here would only pay for a model
 *     that decided to write an essay.
 */

const TIMEOUT_MS = 20_000;
const MAX_OUTPUT_TOKENS = 1024;
/** Longer than this is a pasted transcript, not a call note — and a cost risk per click. */
const MAX_NOTE_CHARS = 4000;
/** Per-user click budget. The button is one tap; a stuck finger shouldn't be a bill. */
const RATE_LIMIT = { calls: 30, windowMs: 60_000 };

export type ExtractionOutcome = {
  extraction: CallNoteExtraction;
  /** One line for the UI when the model wasn't used, or null when it was. Never an error toast. */
  fallbackReason: string | null;
};

function rules(note: string, callDate: string, reason: string): ExtractionOutcome {
  return { extraction: heuristicExtract(note, callDate), fallbackReason: reason };
}

/** Why the model is unavailable, in the founder's terms — matches lib/anthropic.ts's runtime flags. */
function offReason(rt: { configured: boolean; envEnabled: boolean; paused: boolean }): string {
  if (!rt.configured) return "AI isn't configured, so this used the built-in rules.";
  if (rt.paused) return "AI is paused in Settings, so this used the built-in rules.";
  if (!rt.envEnabled) return "AI review is switched off, so this used the built-in rules.";
  return "AI is unavailable, so this used the built-in rules.";
}

/**
 * Read `note` and suggest the structured fields.
 *
 * `callDate` (YYYY-MM-DD) anchors every relative date in the note — "call Sunday" written
 * against a call logged last Tuesday must resolve from THAT Tuesday, not from today, or the
 * suggestion is a week out on any back-dated entry.
 */
export async function extractCallNote(
  note: string,
  callDate: string,
  actorId: string,
): Promise<ExtractionOutcome> {
  const text = (note ?? "").trim().slice(0, MAX_NOTE_CHARS);
  if (!text) {
    return { extraction: heuristicExtract("", callDate), fallbackReason: "Type the call note first." };
  }

  const runtime = await getAiRuntime();
  if (!runtime.enabled || !runtime.apiKey) return rules(text, callDate, offReason(runtime));

  if (!rateLimitOk(`ai-note:${actorId}`, RATE_LIMIT.calls, RATE_LIMIT.windowMs)) {
    return rules(text, callDate, "That's a lot of extractions in a minute — used the built-in rules for this one.");
  }

  const res = await callClaude({
    apiKey: runtime.apiKey,
    model: runtime.model,
    maxTokens: Math.min(runtime.maxTokens, MAX_OUTPUT_TOKENS),
    system: EXTRACTION_SYSTEM,
    user: buildExtractionUser(text, callDate),
    timeoutMs: TIMEOUT_MS,
  });
  if (!res.ok) return rules(text, callDate, `${res.error} Used the built-in rules instead.`);

  const raw = extractJson<unknown>(res.text);
  if (raw === null) return rules(text, callDate, "Couldn't read the AI's reply — used the built-in rules instead.");

  const extraction = coerceExtraction(raw, callDate);

  // A model reply that survives validation with nothing in it is no better than silence, and
  // the rules pass may well have caught the date or the objection. Prefer the one that found
  // something — and don't dress a rules result up as an AI one.
  const foundNothing =
    !extraction.outcome &&
    !extraction.followUpDate &&
    Object.keys(extraction.evidence).length === 0;
  if (foundNothing) {
    const fallback = heuristicExtract(text, callDate);
    if (fallback.outcome || fallback.followUpDate || Object.keys(fallback.evidence).length > 0) {
      return { extraction: fallback, fallbackReason: "The AI found nothing in that note — these came from the built-in rules." };
    }
  }

  return { extraction, fallbackReason: null };
}
