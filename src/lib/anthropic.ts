import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Claude (Anthropic) client for the AI resume/ATS review. Same keys-off seam as the
 * email + WATI channels:
 *   - SECRETS in env, read inline, fail-closed when unset:
 *       AI_REVIEW_ENABLED   "true" to arm the AI review (default off)
 *       ANTHROPIC_API_KEY   Anthropic API key (x-api-key)
 *   - NON-SECRET config in AppSetting("aiConfig"): paused toggle, model, maxTokens.
 * Never throws into a request path — callClaude() always resolves a result object,
 * so a missing key or a network blip degrades to the deterministic analyser instead
 * of 500-ing the page. Nothing is sent to Anthropic unless runtime.enabled is true.
 */

const SETTINGS_KEY = "aiConfig";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

/** Latest Claude models the founder can pick from in Settings. */
export const AI_MODELS = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5 — balanced (recommended)" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — deepest review" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest / cheapest" },
] as const;

const DEFAULT_MODEL = "claude-sonnet-5";

export type AiSettings = { paused: boolean; model: string; maxTokens: number };

const DEFAULTS: AiSettings = { paused: false, model: DEFAULT_MODEL, maxTokens: 4096 };

function coerce(raw: unknown): AiSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<AiSettings>;
  const model = typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULTS.model;
  const maxTokens =
    typeof v.maxTokens === "number" && Number.isFinite(v.maxTokens)
      ? Math.max(1024, Math.min(16000, Math.round(v.maxTokens)))
      : DEFAULTS.maxTokens;
  return { paused: typeof v.paused === "boolean" ? v.paused : DEFAULTS.paused, model, maxTokens };
}

export async function readAiSettings(): Promise<AiSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  return coerce(row?.value);
}

export async function writeAiSettings(settings: AiSettings): Promise<void> {
  const value = coerce(settings) as object;
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value },
    update: { value },
  });
}

export type AiRuntime = {
  enabled: boolean;
  configured: boolean;
  envEnabled: boolean;
  paused: boolean;
  apiKey: string | null;
  model: string;
  maxTokens: number;
};

export async function getAiRuntime(): Promise<AiRuntime> {
  const settings = await readAiSettings();
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() || null;
  const envEnabled = process.env.AI_REVIEW_ENABLED?.trim().toLowerCase() === "true";
  const configured = Boolean(apiKey);
  return {
    enabled: envEnabled && !settings.paused && configured,
    configured,
    envEnabled,
    paused: settings.paused,
    apiKey,
    model: settings.model,
    maxTokens: settings.maxTokens,
  };
}

export type ClaudeResult = { ok: true; text: string } | { ok: false; error: string };

/**
 * One-shot Claude Messages call. Resolves a result; never throws. The caller must have
 * checked runtime.enabled first. `timeoutMs` is generous (the review can be long — the
 * founder asked for a thorough pass, not a snappy one).
 */
export async function callClaude(opts: {
  apiKey: string;
  model: string;
  maxTokens: number;
  system: string;
  user: string;
  timeoutMs?: number;
}): Promise<ClaudeResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 120_000);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "x-api-key": opts.apiKey,
        "anthropic-version": API_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
      }),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      content?: { type: string; text?: string }[];
      error?: { message?: string };
    };
    if (!res.ok) {
      return { ok: false, error: data.error?.message || `Anthropic HTTP ${res.status}` };
    }
    const text = (data.content ?? [])
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("")
      .trim();
    if (!text) return { ok: false, error: "Claude returned an empty response." };
    return { ok: true, text };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { ok: false, error: "Claude request timed out." };
    return { ok: false, error: e instanceof Error ? e.message : "Claude request failed." };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Pull the first JSON object out of a model response. Claude is asked to reply with
 * only JSON, but this tolerates a stray ```json fence or a sentence before the brace.
 */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
