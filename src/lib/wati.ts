import "server-only";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_CADENCE,
  DEFAULT_WATI_SETTINGS,
  type WatiSettings,
  type WatiCadence,
  type WatiTemplateMap,
  type WatiTemplateConfig,
  type WatiTemplateSummary,
} from "@/lib/whatsapp";
import { toCountry } from "@/lib/phone";

/**
 * WATI (WhatsApp Business API) — server-only config + HTTP client.
 *
 * Config split (matches the app's conventions):
 *  - SECRETS in env, read inline, fail-closed when unset:
 *      WATI_ENABLED        "true" to arm outbound sending at all (default off)
 *      WATI_API_ENDPOINT   tenant base URL, e.g. https://live-mt-server.wati.io/{tenantId}
 *      WATI_ACCESS_TOKEN   Bearer token from the WATI dashboard
 *      WATI_WEBHOOK_SECRET shared secret for the inbound /api/wati/webhook
 *      CRON_SECRET         shared secret for /api/cron/whatsapp
 *  - NON-SECRET operational config in AppSetting("watiConfig"): the enabled/paused toggle,
 *    per-touchpoint template names, cadence numbers, default country code. Editable in the UI.
 *
 * Nothing here throws into a request path: sendTemplateMessage always resolves a result object.
 */

const SETTINGS_KEY = "watiConfig";
const CATALOG_KEY = "watiTemplateCatalog";

// ── Editable settings (AppSetting) ──

function coerceCadence(raw: unknown): WatiCadence {
  const c = (raw && typeof raw === "object" ? raw : {}) as Partial<WatiCadence>;
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);
  const leadHours = Array.isArray(c.bookingReminderLeadHours)
    ? c.bookingReminderLeadHours.filter((h): h is number => typeof h === "number" && h >= 0)
    : DEFAULT_CADENCE.bookingReminderLeadHours;
  return {
    discoFirstDelayHours: num(c.discoFirstDelayHours, DEFAULT_CADENCE.discoFirstDelayHours),
    discoRepeatHours: num(c.discoRepeatHours, DEFAULT_CADENCE.discoRepeatHours),
    discoMaxReminders: num(c.discoMaxReminders, DEFAULT_CADENCE.discoMaxReminders),
    bookingReminderLeadHours: leadHours.length ? leadHours : DEFAULT_CADENCE.bookingReminderLeadHours,
    noShowDelayHours: num(c.noShowDelayHours, DEFAULT_CADENCE.noShowDelayHours),
    paymentRepeatHours: num(c.paymentRepeatHours, DEFAULT_CADENCE.paymentRepeatHours),
    // An explicitly stored [] means "EMI pre-due is off" and is honoured — unlike
    // bookingReminderLeadHours above, which treats empty as "unset, use defaults".
    emiPreDueLeadDays: Array.isArray(c.emiPreDueLeadDays)
      ? c.emiPreDueLeadDays.filter((d): d is number => typeof d === "number" && Number.isInteger(d) && d >= 0)
      : DEFAULT_CADENCE.emiPreDueLeadDays,
    // Fails SAFE: only an explicit `false` turns rehearsal off. Absent, null, or a
    // malformed value all keep the dry run on, so a corrupted settings blob can never
    // silently start WhatsApping every paying student.
    emiPreDueDryRun: c.emiPreDueDryRun === false ? false : true,
    studentRepeatHours: num(c.studentRepeatHours, DEFAULT_CADENCE.studentRepeatHours),
    maxPerRun: num(c.maxPerRun, DEFAULT_CADENCE.maxPerRun),
  };
}

/** Templates arrive from JSON; make sure every entry has a real name and a string[] param list. */
function coerceTemplates(raw: unknown): WatiTemplateMap {
  if (!raw || typeof raw !== "object") return {};
  const out: WatiTemplateMap = {};
  for (const [kind, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!val || typeof val !== "object") continue;
    const t = val as Partial<WatiTemplateConfig>;
    if (typeof t.name !== "string" || !t.name.trim()) continue;
    out[kind as keyof WatiTemplateMap] = {
      name: t.name.trim(),
      ...(typeof t.broadcastName === "string" && t.broadcastName.trim() ? { broadcastName: t.broadcastName.trim() } : {}),
      params: Array.isArray(t.params) ? t.params.filter((p): p is string => typeof p === "string" && !!p.trim()).map((p) => p.trim()) : [],
    };
  }
  return out;
}

function coerceSettings(raw: unknown): WatiSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Partial<WatiSettings>;
  // No stored mapping yet → seed the agreed defaults. A stored (even empty) mapping is the
  // Admin's explicit choice and is never overwritten.
  const templates = v.templates === undefined ? DEFAULT_WATI_SETTINGS.templates : coerceTemplates(v.templates);
  return {
    paused: typeof v.paused === "boolean" ? v.paused : DEFAULT_WATI_SETTINGS.paused,
    defaultCountry: toCountry(typeof v.defaultCountry === "string" ? v.defaultCountry : null),
    templates,
    cadence: coerceCadence(v.cadence),
  };
}

/** Read the editable WATI settings from AppSetting (defaults when unset/malformed). */
export async function readWatiSettings(): Promise<WatiSettings> {
  const row = await prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } });
  return coerceSettings(row?.value);
}

/** Persist the editable WATI settings (never secrets). */
export async function writeWatiSettings(settings: WatiSettings): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: settings as object },
    update: { value: settings as object },
  });
}

// ── Effective runtime (env + settings) ──

export type WatiRuntime = {
  /** Effective: env flag ON + not paused + endpoint & token present. Sends are real only when true. */
  enabled: boolean;
  /** Credentials present (endpoint + token) regardless of the on/off flag. */
  configured: boolean;
  /** Env master switch (WATI_ENABLED). */
  envEnabled: boolean;
  /** Admin pause toggle from settings. */
  paused: boolean;
  endpoint: string | null;
  token: string | null;
  settings: WatiSettings;
  /**
   * name → status, from the last "Refresh templates from WATI". Used to refuse a send when we
   * positively KNOW the template is DELETED/PENDING/REJECTED. An absent entry means "we don't
   * know" — we let WATI be the authority rather than block on a stale cache.
   */
  templateStatus: Record<string, string>;
};

function envEndpoint(): string | null {
  const e = process.env.WATI_API_ENDPOINT?.trim();
  return e ? e.replace(/\/+$/, "") : null; // trim trailing slashes
}

export async function getWatiRuntime(): Promise<WatiRuntime> {
  const [settings, catalog] = await Promise.all([readWatiSettings(), readTemplateCatalog()]);
  const endpoint = envEndpoint();
  const token = process.env.WATI_ACCESS_TOKEN?.trim() || null;
  const envEnabled = process.env.WATI_ENABLED?.trim().toLowerCase() === "true";
  const configured = Boolean(endpoint && token);
  return {
    enabled: envEnabled && !settings.paused && configured,
    configured,
    envEnabled,
    paused: settings.paused,
    endpoint,
    token,
    settings,
    templateStatus: Object.fromEntries(catalog.map((t) => [t.name, t.status])),
  };
}

// ── Template catalog (pulled from WATI, cached in AppSetting for the settings dropdown) ──

/** Extract `{{var}}` names from a template body, in order, de-duplicated. */
function paramsFromBody(body: string): string[] {
  const re = /\{\{\s*([\w.]+)\s*\}\}/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * WATI's API and its dashboard export disagree on field names (`elementName` vs `ElementName`,
 * `customParams` vs `TemplateParamMapping`), and older tenants return neither. Read all three,
 * then fall back to parsing `{{var}}` out of the body — which is what WhatsApp positions anyway.
 */
function toTemplateSummary(raw: unknown): WatiTemplateSummary | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const str = (...keys: string[]): string => {
    for (const k of keys) {
      const v = t[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const name = str("elementName", "ElementName", "name");
  if (!name) return null;

  let params: string[] = [];
  const mapping = (t.templateParamMapping ?? t.TemplateParamMapping) as unknown;
  const custom = (t.customParams ?? t.CustomParams) as unknown;
  if (Array.isArray(mapping) && mapping.length) {
    params = mapping
      .map((p) => (p && typeof p === "object" ? String((p as Record<string, unknown>).ParamName ?? (p as Record<string, unknown>).paramName ?? "") : ""))
      .filter(Boolean);
  } else if (Array.isArray(custom) && custom.length) {
    params = custom
      .map((p) => (p && typeof p === "object" ? String((p as Record<string, unknown>).paramName ?? (p as Record<string, unknown>).ParamName ?? "") : ""))
      .filter(Boolean);
  } else {
    params = paramsFromBody(str("body", "Body"));
  }

  // `language` is a string in the dashboard export but an object in the API:
  // {key:"English (US)", value:"en_US", text:"English (US)"}.
  const rawLang = (t.language ?? t.Language) as unknown;
  const language =
    typeof rawLang === "string"
      ? rawLang
      : rawLang && typeof rawLang === "object"
        ? String((rawLang as Record<string, unknown>).value ?? "")
        : "";

  return {
    name,
    category: str("category", "Category") || "UNKNOWN",
    status: (str("status", "Status") || "UNKNOWN").toUpperCase(),
    language,
    params,
  };
}

// ── Message history (used to reconcile what Meta actually did with a send) ──

export type WatiMessage = {
  id: string;
  createdAt: Date;
  status: string; // SENT | DELIVERED | READ | FAILED | …
  failedDetail: string | null;
  templateName: string | null;
};

/**
 * Fetch WATI's own record of the messages exchanged with a number.
 *
 * This is the ONLY way to learn a message's real fate without a publicly reachable webhook:
 * `sendTemplateMessage` returns `{result:true}` the moment WATI *accepts* the request, but Meta may
 * reject it seconds later (deleted template, marketing quality restriction…). Those rejections are
 * recorded here as `statusString: "FAILED"` with a `failedDetail`.
 */
export async function fetchWatiMessages(whatsappNumber: string, pageSize = 50): Promise<{ ok: boolean; messages: WatiMessage[]; error?: string }> {
  const endpoint = envEndpoint();
  const token = process.env.WATI_ACCESS_TOKEN?.trim();
  if (!endpoint || !token) return { ok: false, messages: [], error: "WATI is not configured" };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const url = `${endpoint}/api/v1/getMessages/${encodeURIComponent(whatsappNumber)}?pageSize=${pageSize}&pageNumber=1`;
    const res = await fetch(url, { headers: { Authorization: authHeader(token) }, signal: controller.signal, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) return { ok: false, messages: [], error: `HTTP ${res.status}: ${text.slice(0, 200)}` };

    const body = JSON.parse(text) as Record<string, unknown>;
    const container = body.messages as Record<string, unknown> | undefined;
    const raw = (container?.items ?? body.items) as unknown;
    if (!Array.isArray(raw)) return { ok: true, messages: [] };

    const messages: WatiMessage[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const m = item as Record<string, unknown>;
      const id = typeof m.id === "string" ? m.id : null;
      const created = typeof m.created === "string" ? new Date(m.created) : null;
      const status = typeof m.statusString === "string" ? m.statusString.toUpperCase() : "";
      if (!id || !created || Number.isNaN(created.getTime()) || !status) continue;
      // WATI doesn't expose the template name directly; it's embedded in eventDescription:
      //   Broadcast message with using "workshop_attended_follow_up_1" template was received …
      const desc = typeof m.eventDescription === "string" ? m.eventDescription : "";
      const tpl = /using\s+"([^"]+)"\s+template/i.exec(desc)?.[1] ?? null;
      messages.push({
        id,
        createdAt: created,
        status,
        failedDetail: typeof m.failedDetail === "string" && m.failedDetail ? m.failedDetail : null,
        templateName: tpl,
      });
    }
    return { ok: true, messages };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "WATI request timed out" : e.message) : "WATI request failed";
    return { ok: false, messages: [], error: msg.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the tenant's templates from WATI. Never throws. */
export async function fetchWatiTemplates(): Promise<{ ok: boolean; templates: WatiTemplateSummary[]; error?: string }> {
  const endpoint = envEndpoint();
  const token = process.env.WATI_ACCESS_TOKEN?.trim();
  if (!endpoint || !token) {
    return { ok: false, templates: [], error: "WATI is not configured (endpoint/token missing)" };
  }
  const url = `${endpoint}/api/v1/getMessageTemplates?pageSize=500&pageNumber=1`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Authorization: authHeader(token) },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, templates: [], error: `HTTP ${res.status}: ${text.slice(0, 200)}` };

    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, templates: [], error: "WATI returned a non-JSON response" };
    }
    const b = (body ?? {}) as Record<string, unknown>;
    const arr = [b.messageTemplates, b.MessageTemplates, b.data, b.result, body].find((v) => Array.isArray(v));
    if (!Array.isArray(arr)) return { ok: false, templates: [], error: "Unexpected response shape from WATI" };

    const templates = arr.map(toTemplateSummary).filter((t): t is WatiTemplateSummary => t !== null);
    templates.sort((a, b2) => a.name.localeCompare(b2.name));
    return { ok: true, templates };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "WATI request timed out" : e.message) : "WATI request failed";
    return { ok: false, templates: [], error: msg.slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

export async function readTemplateCatalog(): Promise<WatiTemplateSummary[]> {
  const row = await prisma.appSetting.findUnique({ where: { key: CATALOG_KEY } });
  const v = row?.value;
  if (!Array.isArray(v)) return [];
  return v.map(toTemplateSummary).filter((t): t is WatiTemplateSummary => t !== null);
}

export async function writeTemplateCatalog(templates: WatiTemplateSummary[]): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: CATALOG_KEY },
    create: { key: CATALOG_KEY, value: templates as object },
    update: { value: templates as object },
  });
}

// ── HTTP client ──

export type WatiParameter = { name: string; value: string };

export type WatiSendResult = {
  ok: boolean;
  /** True when nothing was actually sent (never true alongside ok:true from the API). */
  skipped?: boolean;
  watiMessageId: string | null;
  error?: string;
  raw?: unknown;
};

const SEND_TIMEOUT_MS = 12_000;

function authHeader(token: string): string {
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

/** Best-effort extraction of WATI's message id across response shapes. */
function extractMessageId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const direct = b.id ?? b.messageId ?? b.whatsappMessageId ?? b.ticketId;
  if (typeof direct === "string" || typeof direct === "number") return String(direct);
  const messages = b.messages;
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === "object") {
    const m0 = messages[0] as Record<string, unknown>;
    if (typeof m0.id === "string" || typeof m0.id === "number") return String(m0.id);
  }
  return null;
}

/**
 * Send a FREE-FORM (session) message. Only valid inside the 24-hour customer-service window — i.e.
 * after the contact has messaged the business. Outside that window WhatsApp rejects it, which is
 * why business-initiated reminders must remain templates (see sendTemplateMessage).
 *
 * Unlike a marketing template, a session message is NOT subject to Meta's per-user marketing
 * frequency caps, so it is the reliable way to prove end-to-end delivery.
 */
export async function sendSessionMessage(args: {
  endpoint: string;
  token: string;
  whatsappNumber: string;
  messageText: string;
}): Promise<WatiSendResult> {
  const { endpoint, token, whatsappNumber, messageText } = args;
  const url =
    `${endpoint.replace(/\/+$/, "")}/api/v1/sendSessionMessage/${encodeURIComponent(whatsappNumber)}` +
    `?messageText=${encodeURIComponent(messageText)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: authHeader(token), "Content-Type": "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }

    const result = body && typeof body === "object" ? (body as Record<string, unknown>).result : undefined;
    if (!res.ok || result === false) {
      const info =
        (body && typeof body === "object" && ((body as Record<string, unknown>).info ?? (body as Record<string, unknown>).message)) ||
        (typeof body === "string" ? body : "") ||
        `HTTP ${res.status}`;
      return { ok: false, watiMessageId: null, error: String(info).slice(0, 500), raw: body };
    }
    return { ok: true, watiMessageId: extractMessageId(body), raw: body };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "WATI request timed out" : e.message) : "WATI request failed";
    return { ok: false, watiMessageId: null, error: msg.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST a pre-approved WhatsApp template message via WATI. Never throws — returns a result
 * object the caller logs. Business-initiated messages MUST be templates (24h-window rule),
 * which is why there is no free-text send here.
 */
export async function sendTemplateMessage(args: {
  endpoint: string;
  token: string;
  whatsappNumber: string; // normalized digits, no '+'
  templateName: string;
  broadcastName?: string;
  parameters: WatiParameter[];
}): Promise<WatiSendResult> {
  const { endpoint, token, whatsappNumber, templateName, broadcastName, parameters } = args;
  const url = `${endpoint.replace(/\/+$/, "")}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(whatsappNumber)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(token),
      },
      body: JSON.stringify({
        template_name: templateName,
        broadcast_name: broadcastName || templateName,
        parameters,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    let body: unknown = null;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text; // WATI occasionally returns a bare string on error
    }

    // WATI returns HTTP 200 with { result: true/false, info?: string }.
    const result = body && typeof body === "object" ? (body as Record<string, unknown>).result : undefined;
    const apiOk = res.ok && result !== false;
    if (!apiOk) {
      const info =
        (body && typeof body === "object" && ((body as Record<string, unknown>).info ?? (body as Record<string, unknown>).message)) ||
        (typeof body === "string" ? body : "") ||
        `HTTP ${res.status}`;
      return { ok: false, watiMessageId: null, error: String(info).slice(0, 500), raw: body };
    }
    return { ok: true, watiMessageId: extractMessageId(body), raw: body };
  } catch (e) {
    const msg = e instanceof Error ? (e.name === "AbortError" ? "WATI request timed out" : e.message) : "WATI request failed";
    return { ok: false, watiMessageId: null, error: msg.slice(0, 500) };
  } finally {
    clearTimeout(timer);
  }
}
