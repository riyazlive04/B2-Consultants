/**
 * Discovery (Level 2) LOCAL driver: seeds our own rows straight into the local Docker DB and
 * time-travels them. Never imported for a prod run's data path - every export throws when !HAS_DB.
 *
 * Timestamps: every app column is `timestamp without time zone` holding UTC. node-pg would write a
 * JS Date in the TEST PROCESS's zone (IST here) and read them back the same way, silently shifting
 * everything by 5h30. So we always write ISO strings through `::timestamptz at time zone 'UTC'` and
 * parse 1114 columns as UTC.
 */
import { Pool, types } from "pg";
import { HAS_DB, FENCE, assertFenced, recordCreated } from "./target";
import { RUN } from "./app";

types.setTypeParser(1114, (s: string) => new Date(s.replace(" ", "T") + "Z"));

const URL = "postgresql://b2:b2@localhost:5435/b2_dashboard";
let _pool: Pool | null = null;
function pool() {
  if (!HAS_DB) throw new Error("discovery-db is local-only (no DB access in prod)");
  if (!_pool) _pool = new Pool({ connectionString: URL, max: 3 });
  return _pool;
}
export async function dq<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await pool().query(sql, params)).rows as T[];
}
export async function dq1<T = any>(sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await dq<T>(sql, params))[0];
}
export async function closeDiscoveryDb() {
  if (_pool) await _pool.end();
  _pool = null;
}

const HR = 3_600_000;
const MIN = 60_000;
/** SQL fragment for a UTC timestamp parameter. */
const TS = (n: number) => `($${n}::timestamptz at time zone 'UTC')`;
export const iso = (d: Date) => d.toISOString();

let seq = 0;
export const newId = (kind: string) => `dsc${RUN.toLowerCase()}${kind}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function userId(email: string): Promise<string> {
  const r = await dq1<{ id: string }>(`select id from "user" where email = $1`, [email]);
  if (!r) throw new Error(`no user ${email}`);
  return r.id;
}
export const ASMA = "asma@b2consultants.in";
export const NILOFER = "nilofer@b2consultants.in";
export const AMEEN = "ameen@b2consultants.in";

/** IST calendar-day key (YYYY-MM-DD) of an instant. */
export function istDayKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/** Minutes left in today's IST day. */
export function minutesLeftTodayIst(now = new Date()) {
  const [h, m] = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(now).split(":").map(Number);
  return 24 * 60 - (h * 60 + m);
}
/** Round to a whole minute so slot times read cleanly and never collide on seconds. */
export function atMinutesFromNow(mins: number) {
  const t = Date.now() + mins * MIN;
  return new Date(Math.floor(t / MIN) * MIN);
}

// ─────────────────────────────── engine config ───────────────────────────────

/**
 * The outreach engine ships DISABLED and local has no outreachConfig row. Merge `enabled: true`
 * idempotently, preserving anything another agent may already have written (autoSend, sla...).
 * autoSend is left as-is (default {}), so no step auto-sends: every SOP step waits for a human
 * "Mark sent", exactly like the SOP's manual default.
 */
export async function ensureOutreachEngineEnabledLocal() {
  await dq(
    `insert into app_setting (key, value, "updatedAt") values ('outreachConfig', '{"enabled": true}'::jsonb, now() at time zone 'utc')
     on conflict (key) do update set value = app_setting.value || '{"enabled": true}'::jsonb, "updatedAt" = now() at time zone 'utc'
     where coalesce((app_setting.value->>'enabled')::boolean, false) = false`,
  );
  return dq1(`select value from app_setting where key = 'outreachConfig'`);
}

// ─────────────────────────────── seeding ───────────────────────────────

export type SeedLead = { id: string; name: string; phone: string };

export async function seedLead(opts: {
  label: string;
  stage?: string;
  assignedToEmail?: string | null;
  phone?: string;
  createdAt?: Date;
}): Promise<SeedLead> {
  const phone = assertFenced(opts.phone ?? FENCE.secondary.phone);
  const id = newId("lead");
  const name = `${RUN} ${opts.label}`;
  const assigned = opts.assignedToEmail === null ? null : await userId(opts.assignedToEmail ?? ASMA);
  const created = opts.createdAt ?? new Date(Date.now() - HR);
  await dq(
    `insert into lead (id, name, phone, email, "leadSource", "dateIn", stage, source, "assignedToId", notes, "createdAt", "updatedAt")
     values ($1, $2, $3, null, 'OTHER', $4::date, $5, 'MANUAL', $6, $7, ${TS(8)}, now() at time zone 'utc')`,
    [id, name, phone, istDayKey(created), opts.stage ?? "STRATEGY_CALL_BOOKED", assigned, `E2E discovery test row (${RUN})`, iso(created)],
  );
  recordCreated("discovery", { kind: "Lead", id, label: name, cleanup: "close lead (stage LOST) via UI; local rows removable by id prefix" });
  return { id, name, phone };
}

export async function seedDiscoSlot(opts: { startsAt: Date; assignedToEmail?: string; status?: string; durationMins?: number }) {
  const id = newId("slot");
  await dq(
    `insert into appointment_slot (id, "startsAt", "durationMins", status, "assignedToId", "createdAt", "updatedAt")
     values ($1, ${TS(2)}, $3, $4, $5, now() at time zone 'utc', now() at time zone 'utc')`,
    [id, iso(opts.startsAt), opts.durationMins ?? 30, opts.status ?? "BOOKED", await userId(opts.assignedToEmail ?? ASMA)],
  );
  recordCreated("discovery", { kind: "AppointmentSlot", id, label: `disco slot ${iso(opts.startsAt)}`, cleanup: "block/delete slot" });
  return id;
}

export async function seedBooking(opts: {
  lead: SeedLead;
  slotId: string | null;
  status?: string;
  confirmed?: boolean;
  bantAvg?: number;
}) {
  const id = newId("bkg");
  // createdAt = 1st of this month: inside the Bookings table's "this month" window, but OLDER than
  // any booking another agent creates today, so the SOP Step 10 email cross-check (newest first)
  // never picks our booking for their journey (all fenced contacts share one email address).
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(6, 0, 0, 0);
  await dq(
    `insert into booking_request (id, "slotId", "leadId", name, email, phone, status, "confirmedAt", "bantAvg", "bantScore", "bantVerdict",
       "bantBudget","bantAuthority","bantNeed","bantTimeline", source, "createdAt", "updatedAt", "currentJobTitle")
     values ($1,$2,$3,$4,$5,$6,$7, ${TS(8)}, $9, $10, $11, true, true, true, true, 'BOOKING_FORM', ${TS(12)}, now() at time zone 'utc', 'E2E test')`,
    [
      id, opts.slotId, opts.lead.id, opts.lead.name, assertFenced(FENCE.primary.email), opts.lead.phone,
      opts.status ?? "BOOKED", opts.confirmed ? iso(new Date()) : null,
      opts.bantAvg ?? 2.9, 4, (opts.bantAvg ?? 2.9) > 2.4 ? "CONFIRM" : "DOUBT", iso(monthStart),
    ],
  );
  recordCreated("discovery", { kind: "BookingRequest", id, label: opts.lead.name, cleanup: "cancel booking via Bookings UI" });
  return id;
}

export async function seedJourney(opts: {
  lead: SeedLead;
  bookingId?: string | null;
  phase?: string;
  qualified?: "YES" | "MAYBE" | "NO" | null;
  whatsappConfirmed?: boolean;
  highlyQualified?: boolean | null;
  sssAt?: Date | null;
  salesCallConfirmed?: boolean;
  zoomLink?: string | null;
  optInAt?: Date;
  /** Pre-close Steps 11/12 so they never sit at the head of the queue card. */
  preCloseQualification?: boolean;
}) {
  const id = newId("jrn");
  const optIn = opts.optInAt ?? new Date(Date.now() - 2 * HR);
  await dq(
    `insert into outreach_journey (id, "leadId", "bookingId", phase, "optInAt", "contactedAt", qualified, "qualifiedAt",
       "whatsappConfirmed", "whatsappConfirmedAt", "highlyQualified", "highlyQualifiedAt", "sssAt", "salesCallConfirmed", "salesCallConfirmedAt",
       "zoomLink", "createdAt", "updatedAt")
     values ($1,$2,$3,$4::"OutreachPhase", ${TS(5)}, ${TS(5)}, $6::"QualifiedVerdict", case when $6::"QualifiedVerdict" is null then null else now() at time zone 'utc' end,
       $7::boolean, case when $7::boolean then now() at time zone 'utc' else null end, $8::boolean, case when $8::boolean is null then null else now() at time zone 'utc' end,
       ${TS(9)}, $10::boolean, case when $10::boolean then now() at time zone 'utc' else null end, $11, now() at time zone 'utc', now() at time zone 'utc')`,
    [
      id, opts.lead.id, opts.bookingId ?? null, opts.phase ?? "AWAITING_DISCO", iso(optIn), opts.qualified ?? null,
      opts.whatsappConfirmed ?? false, opts.highlyQualified ?? null, opts.sssAt ? iso(opts.sssAt) : null,
      opts.salesCallConfirmed ?? false, opts.zoomLink ?? null,
    ],
  );
  if (opts.preCloseQualification !== false && opts.bookingId) {
    for (const step of ["BANT_QUALIFICATION", "KEY_METRICS_TRANSFER"]) {
      await seedStep(id, step, { status: "SENT", dueAt: new Date(optIn.getTime() + 10 * MIN), actedAt: new Date(optIn.getTime() + 11 * MIN), channel: "SYSTEM", outcome: step === "BANT_QUALIFICATION" ? (opts.qualified ?? "YES") : null });
    }
  }
  recordCreated("discovery", { kind: "OutreachJourney", id, label: opts.lead.name, cleanup: "cascades with lead" });
  return id;
}

export async function seedStep(journeyId: string, step: string, o: { status: string; dueAt: Date; actedAt?: Date | null; channel: string; outcome?: string | null }) {
  await dq(
    `insert into outreach_step_log (id, "journeyId", step, status, channel, "dueAt", "actedAt", outcome, "createdAt", "updatedAt")
     values ($1,$2,$3,$4,$5, ${TS(6)}, ${TS(7)}, $8, now() at time zone 'utc', now() at time zone 'utc')`,
    [newId("step"), journeyId, step, o.status, o.channel, iso(o.dueAt), o.actedAt ? iso(o.actedAt) : null, o.outcome ?? null],
  );
}

export async function seedSssSlot(opts: { startsAt: Date; journeyId?: string | null; status?: string; ownerEmail?: string }) {
  const id = newId("sss");
  await dq(
    `insert into sss_slot (id, "startsAt", "durationMins", status, "ownerId", "journeyId", "createdAt", "updatedAt")
     values ($1, ${TS(2)}, 45, $3, $4, $5, now() at time zone 'utc', now() at time zone 'utc')`,
    [id, iso(opts.startsAt), opts.status ?? (opts.journeyId ? "BOOKED" : "OPEN"), await userId(opts.ownerEmail ?? AMEEN), opts.journeyId ?? null],
  );
  recordCreated("discovery", { kind: "SssSlot", id, label: `sss slot ${iso(opts.startsAt)}`, cleanup: "block/delete SSS slot via Bookings > SSS Calendar" });
  return id;
}

/** A booked discovery call on a specialist's calendar, with its lead, booking and SOP journey. */
export async function seedDiscoveryCall(opts: {
  label: string;
  startsAt: Date;
  assignedToEmail?: string;
  confirmed?: boolean;
  bookingStatus?: string;
  qualified?: "YES" | "MAYBE" | "NO";
  leadStage?: string;
  journey?: boolean;
  optInAt?: Date;
}) {
  const lead = await seedLead({ label: opts.label, stage: opts.leadStage ?? (opts.confirmed ? "DISCO_BOOKED" : "STRATEGY_CALL_BOOKED"), assignedToEmail: opts.assignedToEmail ?? ASMA });
  const slotId = await seedDiscoSlot({ startsAt: opts.startsAt, assignedToEmail: opts.assignedToEmail ?? ASMA });
  const bookingId = await seedBooking({ lead, slotId, confirmed: opts.confirmed, status: opts.bookingStatus });
  const journeyId = opts.journey === false ? null : await seedJourney({
    lead, bookingId, qualified: opts.qualified ?? "YES", whatsappConfirmed: !!opts.confirmed,
    phase: opts.confirmed ? "AWAITING_DISCO" : "DISCO_CONFIRMATION", optInAt: opts.optInAt,
  });
  return { lead, slotId, bookingId, journeyId };
}

/** A highly-qualified prospect booked into an SSS slot (the state the missing HQ control would create). */
export async function seedSssProspect(opts: { label: string; sssAt: Date; zoomLink?: string | null; salesCallConfirmed?: boolean; phase?: string; withSlot?: boolean }) {
  const lead = await seedLead({ label: opts.label, stage: "SSS_BOOKED" });
  const discoSlot = await seedDiscoSlot({ startsAt: new Date(Date.now() - 26 * HR) });
  const bookingId = await seedBooking({ lead, slotId: discoSlot, status: "COMPLETED", confirmed: true });
  const journeyId = await seedJourney({
    lead, bookingId, qualified: "YES", whatsappConfirmed: true, highlyQualified: true,
    sssAt: opts.withSlot === false ? null : opts.sssAt, salesCallConfirmed: !!opts.salesCallConfirmed,
    phase: opts.phase ?? (opts.salesCallConfirmed ? "COMPLETED" : "SSS_CONFIRMATION"),
    zoomLink: opts.zoomLink ?? null, optInAt: new Date(Date.now() - 30 * HR),
  });
  const sssSlotId = opts.withSlot === false ? null : await seedSssSlot({ startsAt: opts.sssAt, journeyId });
  await dq(`insert into discovery_outcome (id, "leadId", "callDate", outcome, "highlyQualified", notes, source, "enteredById", "createdAt", "updatedAt")
            values ($1,$2,$3::date,'QUALIFIED_FOR_SSS', true, $4, 'MANUAL', $5, now() at time zone 'utc', now() at time zone 'utc')`,
    [newId("out"), lead.id, istDayKey(new Date(Date.now() - 26 * HR)), `${RUN} closer notes`, await userId(ASMA)]);
  return { lead, bookingId, journeyId, sssSlotId };
}

// ─────────────────────────────── time travel ───────────────────────────────

/**
 * Pretend `hours` pass for ONE journey: every instant the ladder reads (appointment times, step due
 * and acted times, opt-in) moves `hours` into the past. Only our own seeded rows are touched.
 */
export async function timeTravelJourney(journeyId: string, hours: number) {
  const ms = `${hours} hours`;
  await dq(`update outreach_journey set "sssAt" = "sssAt" - $2::interval, "optInAt" = "optInAt" - $2::interval,
              "contactedAt" = "contactedAt" - $2::interval where id = $1`, [journeyId, ms]);
  await dq(`update sss_slot set "startsAt" = "startsAt" - $2::interval where "journeyId" = $1`, [journeyId, ms]);
  await dq(`update appointment_slot s set "startsAt" = s."startsAt" - $2::interval from outreach_journey j join booking_request b on b.id = j."bookingId"
            where j.id = $1 and s.id = b."slotId"`, [journeyId, ms]);
  await dq(`update outreach_step_log set "dueAt" = "dueAt" - $2::interval, "actedAt" = "actedAt" - $2::interval where "journeyId" = $1`, [journeyId, ms]);
}

// ─────────────────────────────── reads ───────────────────────────────

export const leadRow = (id: string) => dq1(`select id, name, stage, "assignedToId", "deletedAt" from lead where id = $1`, [id]);
export const stageHistory = (leadId: string) =>
  dq<{ fromStage: string | null; toStage: string; changedAt: Date }>(`select "fromStage", "toStage", "changedAt" from lead_stage_history where "leadId" = $1 order by "changedAt"`, [leadId]);
export const bookingRow = (id: string) => dq1(`select id, status, "slotId", "confirmedAt" from booking_request where id = $1`, [id]);
export const slotRow = (id: string) => dq1(`select id, status, "startsAt" from appointment_slot where id = $1`, [id]);
export const sssSlotRow = (id: string) => dq1(`select id, status, "journeyId", "startsAt" from sss_slot where id = $1`, [id]);
export const journeyRow = (id: string) => dq1(`select * from outreach_journey where id = $1`, [id]);
export const steps = (journeyId: string) =>
  dq<{ step: string; status: string; dueAt: Date; actedAt: Date | null; outcome: string | null; renderedBody: string | null }>(
    `select step, status, "dueAt", "actedAt", outcome, "renderedBody" from outreach_step_log where "journeyId" = $1 order by "createdAt"`, [journeyId]);
export async function stepMap(journeyId: string) {
  const out: Record<string, Awaited<ReturnType<typeof steps>>[number]> = {};
  for (const s of await steps(journeyId)) out[s.step] = s;
  return out;
}
export const outcomes = (leadId: string) => dq(`select outcome, "highlyQualified", "sssDate", notes, "callDate", "enteredById" from discovery_outcome where "leadId" = $1 order by "createdAt"`, [leadId]);
export const outboundWhatsApp = (leadId: string) => dq(`select kind, status, error, "toNumber", "createdAt" from whatsapp_message where "leadId" = $1 order by "createdAt"`, [leadId]);

/**
 * Simulate what a LIVE auto-send leaves behind: one OUTBOUND WhatsApp row to the lead's number.
 * The WATI webhook links a reply to the latest such row, so a reply can only confirm a journey
 * when one exists. Local outbound is blocked by the allowlist, so we write the row directly.
 */
export async function seedOutboundWhatsApp(lead: SeedLead, kind: string) {
  const id = newId("wa");
  await dq(
    `insert into whatsapp_message (id, direction, kind, status, "toNumber", body, "leadId", "createdAt", "updatedAt")
     values ($1, 'OUTBOUND', $2, 'SENT', $3, $4, $5, now() at time zone 'utc', now() at time zone 'utc')`,
    [id, kind, lead.phone.replace(/\D/g, ""), `${RUN} simulated live send`, lead.id],
  );
  return id;
}

export const H = HR;
export const M = MIN;

/**
 * The shared runCron() inherits the 20s request timeout, and a local outreach tick scans every
 * agent's journeys (WATI/Resend sends time out against the invalid creds) - so it routinely takes
 * longer. Same call, generous timeout, retried once on a timeout.
 */
export async function runOutreachCron(request: import("@playwright/test").APIRequestContext) {
  const { CRON_SECRET } = await import("./app");
  const { BASE_URL } = await import("../playwright.config");
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await request.get(`${BASE_URL}/api/cron/outreach`, { headers: { "x-cron-secret": CRON_SECRET }, timeout: 180_000 });
      const body = await res.text();
      if (res.status() !== 200) throw new Error(`outreach cron ${res.status()}: ${body.slice(0, 300)}`);
      return JSON.parse(body);
    } catch (e) {
      if (attempt >= 1) throw e;
    }
  }
}
