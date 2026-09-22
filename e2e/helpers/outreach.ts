import { APIRequestContext, Browser, BrowserContext, Page, expect, test } from "@playwright/test";
import { BASE_URL } from "../playwright.config";
import { CRON_SECRET, RUN } from "./app";
import { authFile } from "./roles";
import { FENCE, HAS_DB, IS_PROD, assertFenced, recordCreated } from "./target";
import { one, q } from "./db";
import { types } from "pg";

// Prisma stores `timestamp without time zone` columns as UTC wall-clock. node-pg would parse them in the
// test process's local zone (IST here), shifting every instant by 5h30. Read them as UTC.
types.setTypeParser(1114, (s: string) => new Date(s.replace(" ", "T") + "Z"));

/**
 * Outreach (Level 1 SOP) test helpers.
 *
 * Two drivers for every flow:
 *   local - DB time-travel on OUR OWN rows (journey/steps/slot of the fenced lead) + runCron("outreach").
 *   prod  - no DB and no manual cron; the VPS cron ticks every minute, so a flow either waits for real
 *           time (E2E_PROD_LONG=1) or is skipped with a note. Every assertion that matters in prod is
 *           made through the UI (queue card, pipeline row, bookings row).
 */

export const AREA = "outreach";
export const MIN = 60_000;
export const HR = 3_600_000;
export const PROD_LONG = process.env.E2E_PROD_LONG === "1";
/** Marker put in the lead's city so a row is recognisably ours on every surface. */
export const CITY_TAG = `E2E-OUT ${RUN}`;

export const SOP_KINDS = [
  "SOP_INTRO", "SOP_FOLLOWUP", "SOP_FOLLOWUP_2", "SOP_NOT_QUALIFIED", "SOP_DISCO_WELCOME",
  "SOP_DISCO_CONFIRM_1", "SOP_DISCO_CONFIRM_2", "SOP_DISCO_CANCEL", "SOP_SSS_CONFIRM_1",
  "SOP_SSS_CONFIRM_2", "SOP_SSS_CONFIRM_3", "SOP_DISCO_NOSHOW", "SOP_SSS_CANCEL",
] as const;
export const fakeTemplate = (kind: string) => `e2e_fake_${kind.toLowerCase()}`;

// ───────────────────────────── local config (idempotent merge) ─────────────────────────────

/**
 * LOCAL ONLY. Arms the SOP engine and binds obviously-fake WATI templates to the SOP kinds so the
 * send path is exercised end to end (the OUTBOUND_ALLOWLIST then refuses the wire call).
 * Merges: never overwrites a key another agent already set.
 */
export async function ensureLocalOutreachConfig() {
  if (!HAS_DB) return;
  const cfgRow = await one<{ value: any }>(`select value from app_setting where key='outreachConfig'`);
  const cfg = { ...(cfgRow?.value ?? {}) };
  cfg.enabled = true;
  const autoSend = { ...(cfg.autoSend ?? {}) };
  for (const s of ["INTRO_WHATSAPP", "INTRO_EMAIL", "FOLLOWUP_WHATSAPP", "FOLLOWUP_EMAIL", "FOLLOWUP_WHATSAPP_2",
    "DISCO_WELCOME", "DISCO_WELCOME_EMAIL", "DISCO_CONFIRM_1", "DISCO_CONFIRM_2", "DISCO_CANCEL_MSG", "DISCO_CANCEL_EMAIL"]) {
    if (autoSend[s] === undefined) autoSend[s] = true;
  }
  cfg.autoSend = autoSend;
  if (!cfg.instantIntro) cfg.instantIntro = { enabled: true, maxPerHour: 200 };
  await q(`insert into app_setting(key, value, "updatedAt") values ('outreachConfig', $1::jsonb, now())
           on conflict (key) do update set value = excluded.value, "updatedAt" = now()`, [JSON.stringify(cfg)]);

  const watiRow = await one<{ value: any }>(`select value from app_setting where key='watiConfig'`);
  const wati = { ...(watiRow?.value ?? {}) };
  const templates = { ...(wati.templates ?? {}) };
  for (const k of SOP_KINDS) if (!templates[k]) templates[k] = { name: fakeTemplate(k), params: ["name"] };
  wati.templates = templates;
  await q(`insert into app_setting(key, value, "updatedAt") values ('watiConfig', $1::jsonb, now())
           on conflict (key) do update set value = excluded.value, "updatedAt" = now()`, [JSON.stringify(wati)]);
  return { outreachConfig: cfg, watiTemplates: templates };
}

export async function readOutreachConfig(): Promise<any> {
  const r = await one<{ value: any }>(`select value from app_setting where key='outreachConfig'`);
  return r?.value ?? {};
}

// ───────────────────────────── DB reads (local) ─────────────────────────────

export type LeadRow = {
  id: string; name: string; phone: string | null; email: string | null; stage: string; source: string;
  leadSource: string; dateIn: string; createdAt: Date; deletedAt: Date | null; assignedToId: string | null;
  city: string | null; notes: string | null;
};

const digitsTail = (p: string) => p.replace(/\D/g, "").slice(-10);

export async function leadsByPhone(phone: string, includeArchived = true): Promise<LeadRow[]> {
  return q<LeadRow>(
    `select id, name, phone, email, stage, source, "leadSource", to_char("dateIn",'YYYY-MM-DD') "dateIn", "createdAt",
            "deletedAt", "assignedToId", city, notes
       from lead where regexp_replace(coalesce(phone,''),'[^0-9]','','g') like $1
       ${includeArchived ? "" : `and "deletedAt" is null`} order by "createdAt" desc`,
    [`%${digitsTail(phone)}`],
  );
}
export async function liveLead(phone: string) {
  return (await leadsByPhone(phone, false))[0];
}
export async function journeyFor(leadId: string) {
  return one<any>(`select * from outreach_journey where "leadId"=$1`, [leadId]);
}
export type StepRow = { id: string; step: string; status: string; channel: string; dueAt: Date; actedAt: Date | null; actedById: string | null; outcome: string | null; renderedBody: string | null };
export async function stepsFor(journeyId: string): Promise<StepRow[]> {
  return q<StepRow>(`select id, step::text, status::text, channel::text, "dueAt", "actedAt", "actedById", outcome, "renderedBody"
                       from outreach_step_log where "journeyId"=$1 order by "createdAt", step`, [journeyId]);
}
export async function stepMap(journeyId: string) {
  return Object.fromEntries((await stepsFor(journeyId)).map((s) => [s.step, s])) as Record<string, StepRow>;
}
export async function waMessages(leadId: string) {
  return q<any>(`select id, kind::text, status::text, "templateName", error, "createdAt", "bookingRequestId"
                   from whatsapp_message where "leadId"=$1 order by "createdAt"`, [leadId]);
}
export async function emailMessages(leadId: string) {
  return q<any>(`select id, status::text, subject, error, "toAddress", "createdAt" from message where "leadId"=$1 order by "createdAt"`, [leadId]);
}
export async function stageHistory(leadId: string) {
  return q<any>(`select "fromStage"::text, "toStage"::text, "changedAt", "changedById" from lead_stage_history where "leadId"=$1 order by "changedAt"`, [leadId]);
}
export async function bookingsFor(leadId: string) {
  return q<any>(`select b.id, b.status::text, b."bantAvg", b."bantVerdict"::text, b."confirmedAt", b."slotId", s."startsAt", s.status::text "slotStatus"
                   from booking_request b left join appointment_slot s on s.id=b."slotId" where b."leadId"=$1 order by b."createdAt"`, [leadId]);
}

/**
 * Poll until `fn` returns truthy (the intake runs scoring + instant intro AFTER the response).
 */
export async function eventually<T>(fn: () => Promise<T>, what: string, timeoutMs = 20_000): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last as NonNullable<T>;
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for: ${what} (last=${JSON.stringify(last)})`);
}

// ───────────────────────────── time travel (local) ─────────────────────────────

/**
 * "N hours pass" for ONE journey: every instant the engine reads for it moves N hours into the past -
 * opt-in, contacted, qualified/confirmed stamps, every step's dueAt/actedAt, and the booked slot's
 * start. Only rows belonging to our own fenced lead are touched.
 */
export async function timeTravel(journeyId: string, hours: number) {
  if (!HAS_DB) throw new Error("timeTravel is local-only");
  const iv = `${hours} hours`;
  await q(`update outreach_journey set "optInAt"="optInAt"-$2::interval,
             "contactedAt"="contactedAt"-$2::interval, "qualifiedAt"="qualifiedAt"-$2::interval,
             "whatsappSentAt"="whatsappSentAt"-$2::interval, "whatsappConfirmedAt"="whatsappConfirmedAt"-$2::interval
           where id=$1`, [journeyId, iv]);
  await q(`update outreach_step_log set "dueAt"="dueAt"-$2::interval, "actedAt"="actedAt"-$2::interval where "journeyId"=$1`, [journeyId, iv]);
  await q(`update appointment_slot set "startsAt"="startsAt"-$2::interval
            where id in (select b."slotId" from outreach_journey j join booking_request b on b.id=j."bookingId" where j.id=$1 and b."slotId" is not null)`,
    [journeyId, iv]);
}

/** Hours from now until the journey's booked discovery call (negative once it has passed). */
export async function hoursUntilDisco(journeyId: string): Promise<number> {
  const r = await one<{ startsAt: Date }>(
    `select s."startsAt" from outreach_journey j join booking_request b on b.id=j."bookingId" join appointment_slot s on s.id=b."slotId" where j.id=$1`,
    [journeyId],
  );
  if (!r) throw new Error("journey has no booked slot");
  return (new Date(r.startsAt).getTime() - Date.now()) / HR;
}
/** Travel until the call is exactly `leadHours` (minus a minute) away. */
export async function travelToBeforeDisco(journeyId: string, leadHours: number) {
  const h = await hoursUntilDisco(journeyId);
  const by = h - leadHours + 1 / 60;
  if (by > 0) await timeTravel(journeyId, by);
}

/** A slot on day +`days` (IST) at a run-unique minute past 21:00, created through the Bookings UI. */
export async function makeSlot(page: Page, days: number) {
  const base = new Date(Date.now() + days * 24 * HR);
  const { ymd } = istDateParts(base);
  const minute = 1 + (Math.floor(Date.now() / 1000) % 28);
  const hhmm = `21:${String(minute).padStart(2, "0")}`;
  await createSlotUi(page, ymd, hhmm);
  const startsAt = new Date(`${ymd}T${hhmm}:00+05:30`);
  if (HAS_DB) {
    const row = await eventually(() => one<{ id: string }>(`select id from appointment_slot where "startsAt"=$1 and status='OPEN'`, [startsAt.toISOString().replace("T", " ").replace("Z", "")]), "slot row");
    record("AppointmentSlot", `slot ${startsAt.toISOString()}`, row.id, "99-cleanup deletes it if still OPEN and unbooked");
  }
  return { startsAt, dayLabel: istDateParts(startsAt).dmy, timeLabel: ist12h(startsAt) };
}

export async function tick(request: APIRequestContext) {
  if (IS_PROD) throw new Error("tick is local-only: production cron runs on the VPS scheduler");
  // Not the shared runCron: the engine walks every live journey (other agents' too) and can take longer
  // than the default action timeout.
  const t0 = Date.now();
  const res = await request.get(`${BASE_URL}/api/cron/outreach`, { headers: { "x-cron-secret": CRON_SECRET }, timeout: 180_000 });
  const body = await res.text();
  expect(res.status(), body).toBe(200);
  lastTickMs = Date.now() - t0;
  return JSON.parse(body);
}
export let lastTickMs = 0;

// ───────────────────────────── opt-in drivers ─────────────────────────────

export function pabblyKey(): string | null {
  if (!IS_PROD) return "e2e-pabbly";
  return process.env.E2E_PABBLY_KEY ?? null;
}

/** Opt in through the Pabbly relay exactly as the live landing page does. */
export async function optInViaPabbly(
  request: APIRequestContext,
  who: { name: string; phone: string; email?: string | null },
  extra: Record<string, string> = {},
) {
  assertFenced(who.phone);
  if (who.email) assertFenced(who.email);
  const key = pabblyKey();
  if (!key) throw new Error("No Pabbly key for this target (set E2E_PABBLY_KEY)");
  const externalRef = `${RUN}-${Math.random().toString(36).slice(2, 8)}`;
  const data: Record<string, string> = {
    name: who.name, phone: who.phone, city: CITY_TAG, id: externalRef, lead_source: "instagram", ...extra,
  };
  if (who.email) data.email = who.email;
  const res = await request.post(`${BASE_URL}/api/leads/pabbly?key=${encodeURIComponent(key)}`, { data });
  const body = await res.json().catch(() => ({}));
  return { status: res.status(), body, externalRef, sent: data };
}

// ───────────────────────────── UI helpers ─────────────────────────────

export async function ctxAs(browser: Browser, role: Parameters<typeof authFile>[0], extraHeaders?: Record<string, string>) {
  return browser.newContext({ storageState: authFile(role), extraHTTPHeaders: extraHeaders });
}

/** Pick an option on the app's custom SelectMenu (hidden native select + popover). */
export async function pickSelect(scope: Page | ReturnType<Page["locator"]>, name: string, optionLabel: string | RegExp) {
  const wrap = scope.locator(`span:has(> select[name="${name}"])`).first();
  await wrap.locator("button[aria-haspopup=listbox]").click();
  const page = "page" in scope ? (scope as any).page() : scope;
  const opts = typeof optionLabel === "string"
    ? page.getByRole("option", { name: optionLabel, exact: true })
    : page.getByRole("option", { name: optionLabel });
  await opts.first().click();
}

/** The outreach queue card for a phone number (cards carry the phone in their subtitle). */
export function queueCard(page: Page, phone: string) {
  return page.locator("div.rounded-card").filter({ has: page.locator("p.font-display") }).filter({ hasText: phone });
}

/** page.goto that tolerates one slow render of a heavy page while other agents load the shared server. */
export async function gotoRetry(page: Page, url: string) {
  for (let i = 0; ; i++) {
    try {
      return await page.goto(url, { timeout: 90_000 });
    } catch (e) {
      if (i >= 2) throw e;
    }
  }
}

/** Text of the "next step" chip on a queue card, e.g. "Step 3: WhatsApp intro"; null when no card/step. */
export async function nextChip(page: Page, phone: string): Promise<string | null> {
  const card = queueCard(page, phone);
  if (!(await card.count())) return null;
  const chip = card.first().locator("span.rounded-full.bg-accent-soft").filter({ hasText: /:/ }).last();
  if (!(await chip.count())) return null;
  return (await chip.innerText()).trim();
}

/**
 * Work the specialist's queue for one prospect the way a person would: reload /outreach, read the
 * card's next step, press the button the plan maps it to, repeat. Stops when the next step is not in
 * the plan (or there is none). Returns the chips handled, in order.
 */
export async function workQueue(page: Page, phone: string, plan: Array<[RegExp, string]>, max = 8) {
  const handled: string[] = [];
  for (let i = 0; i < max; i++) {
    await gotoRetry(page, "/outreach");
    const chip = await nextChip(page, phone);
    if (!chip) break;
    const hit = plan.find(([re]) => re.test(chip));
    if (!hit) break;
    const card = queueCard(page, phone).first();
    const posted = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/outreach"), { timeout: 30_000 });
    await card.getByRole("button", { name: hit[1], exact: true }).click();
    await posted;
    await page.waitForTimeout(300);
    // the action re-plans the journey; wait for the chip to change before reading it again
    await expect.poll(async () => {
      await page.waitForTimeout(700);
      await gotoRetry(page, "/outreach");
      return nextChip(page, phone);
    }, { timeout: 20_000, intervals: [500] }).not.toBe(chip).catch(() => undefined);
    handled.push(chip);
  }
  return handled;
}

export async function openOutreachTab(page: Page, tab: RegExp) {
  await page.goto("/outreach");
  await page.getByRole("tab", { name: tab }).click();
}

/**
 * Archive then permanently delete every live/archived lead on a fenced phone, cancelling any booking it
 * still holds first - so the next scenario starts from a genuinely fresh opt-in. Done through the UI
 * (Bookings status → Cancelled; Pipeline → Delete → Archived → Delete permanently), which works on both
 * targets. Returns the ids removed.
 */
export async function purgePerson(page: Page, phone: string) {
  assertFenced(phone);
  const removed: string[] = [];
  if (HAS_DB) {
    const leads = await leadsByPhone(phone, true);
    for (const l of leads) {
      for (const b of await bookingsFor(l.id)) {
        if (b.status === "BOOKED") await setBookingStatusUi(page, l.name, phone, "Cancelled");
      }
    }
    if (!leads.length) return removed;
  }
  const liveCount = async () => (HAS_DB ? (await leadsByPhone(phone, false)).length : -1);
  const allCount = async () => (HAS_DB ? (await leadsByPhone(phone, true)).length : -1);
  for (let i = 0; i < 6; i++) {
    if (HAS_DB && (await liveCount()) === 0) break;
    await page.goto("/pipeline");
    await page.getByRole("tab", { name: /^Leads$/ }).click();
    await page.getByPlaceholder("Filter leads…").fill(phone);
    const rows = page.locator("table tbody tr:visible").filter({ hasText: phone });
    try {
      await expect(rows.first()).toBeVisible({ timeout: 8_000 });
    } catch {
      break; // nothing live on this number (prod path)
    }
    const name = (await rows.first().locator("td").first().innerText()).trim();
    await rows.first().getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText(`Archived ${name}`).first()).toBeVisible();
    if (HAS_DB) await eventually(async () => (await liveCount()) < 99, "archive"); // settle
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 8; i++) {
    if (HAS_DB && (await allCount()) === 0) break;
    await page.goto("/pipeline");
    await page.getByRole("tab", { name: /^Archived/ }).click();
    const item = page.locator("li").filter({ hasText: phone });
    try {
      await expect(item.first()).toBeVisible({ timeout: 8_000 });
    } catch {
      break;
    }
    const before = await allCount();
    await item.first().getByRole("button", { name: /permanently$/ }).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page.getByText(/Permanently deleted/).first()).toBeVisible();
    if (HAS_DB) await eventually(async () => (await allCount()) < before, "purge");
  }
  if (HAS_DB) {
    const left = await leadsByPhone(phone, true);
    expect(left.map((l) => l.id), "fenced lead still present after purge").toEqual([]);
  }
  return removed;
}

export async function setBookingStatusUi(page: Page, name: string, phone: string, label: string) {
  const statusKey = label.toUpperCase().replace(/ /g, "_");
  const bookedIds = HAS_DB ? (await q<{ id: string }>(
    `select b.id from booking_request b join lead l on l.id=b."leadId" where b.status='BOOKED' and regexp_replace(coalesce(l.phone,''),'[^0-9]','','g') like $1`,
    [`%${phone.replace(/\D/g, "").slice(-10)}`])).map((r) => r.id) : [];
  for (let attempt = 0; attempt < 3; attempt++) {
    await gotoRetry(page, "/bookings");
    const row = page.locator("table tbody tr:visible").filter({ hasText: phone }).filter({ has: page.getByRole("button", { name: "Booking status" }) })
      .filter({ has: page.locator("button[aria-label='Booking status']", { hasText: "Booked" }) }).first();
    if (!(await row.count())) break;
    await row.getByRole("button", { name: "Booking status" }).click();
    await page.getByRole("option", { name: label, exact: true }).click();
    if (!HAS_DB) {
      await expect(page.getByText(new RegExp(`Marked ${label}`, "i")).first()).toBeVisible();
      return;
    }
    const ok = await eventually(async () => {
      const r = await q<{ n: number }>(`select count(*)::int n from booking_request where id = any($1) and status::text = $2`, [bookedIds, statusKey]);
      return r[0].n > 0 ? true : null;
    }, `booking -> ${statusKey}`, 10_000).catch(() => null);
    if (ok) return;
  }
}

/** Admin → Bookings → Add availability: one slot on `date` at `hhmm` IST. */
export async function createSlotUi(page: Page, date: string, hhmm: string) {
  await page.goto("/bookings");
  await page.getByRole("button", { name: "Manage availability" }).first().click();
  const form = page.locator("form").filter({ hasText: "Add availability" });
  await form.locator("input[name=startDate]").fill(date);
  await form.locator("input[name=endDate]").fill(date);
  const [h, m] = hhmm.split(":").map(Number);
  const end = `${String(h).padStart(2, "0")}:${String(m + 30).padStart(2, "0")}`;
  await form.locator("input[name=startTime]").fill(hhmm);
  await form.locator("input[name=endTime]").fill(end);
  for (const cb of await form.locator("input[name=weekdays]").all()) await cb.check();
  await form.getByRole("button", { name: "Add slots" }).click();
  await page.waitForTimeout(1500);
}

export type BantAnswers = {
  readyToInvest: string; currentIncome: string; decisionMaking: string; alreadyApplied: string; whenStartGermany: string;
};
export const BANT_HIGH: BantAnswers = { readyToInvest: "Ready to invest", currentIncome: "More than ₹1,00,000", decisionMaking: "I make the final decision myself", alreadyApplied: "I got some interviews, but no offer", whenStartGermany: "in next 6 months." }; // 5.0
/** 0 + 2 + 3.5 + 4 + 0.5 = 10 / 5 = exactly 2.0 - the SOP's undefined boundary. */
export const BANT_TWO: BantAnswers = { readyToInvest: "Not ready at the moment", currentIncome: "₹30,000 - ₹50,000", decisionMaking: "I make decisions, but consult others", alreadyApplied: "I've applied, but no responses", whenStartGermany: "No fixed timeline, just exploring for now." };
/** 0 + 1 + 1 + 2 + 0.5 = 4.5 / 5 = 0.9 → auto-disqualify. */
export const BANT_LOW: BantAnswers = { readyToInvest: "Not ready at the moment", currentIncome: "Less than ₹30,000", decisionMaking: "Someone else makes the final decision", alreadyApplied: "No, I haven't started applying.", whenStartGermany: "No fixed timeline, just exploring for now." };

/**
 * Book through the PUBLIC /book page as the prospect. `slotLabel` is the IST time text on the slot
 * button, `dayLabel` the DD/MM/YYYY heading it sits under.
 */
export async function bookViaPublicPage(page: Page, who: { name: string; phone: string; email: string }, dayLabel: string, slotLabel: string, bant: BantAnswers) {
  // The shared local server intermittently times out Prisma interactive transactions (P2028, 5s) under
  // other agents' load, which renders "Application error" on submit. Retry the whole form (slot stays OPEN).
  for (let attempt = 0; attempt < 3; attempt++) {
    await bookViaPublicPageOnce(page, who, dayLabel, slotLabel, bant);
    const outcome = await Promise.race([
      page.getByText("You're booked in").first().waitFor({ timeout: 45_000 }).then(() => "ok"),
      page.getByText("Application error").first().waitFor({ timeout: 45_000 }).then(() => "error"),
    ]).catch(() => "timeout");
    if (outcome !== "error") return;
    test.info().annotations.push({ type: "flake", description: `/book submit hit "Application error" (attempt ${attempt + 1})` });
  }
}

async function bookViaPublicPageOnce(
  page: Page,
  who: { name: string; phone: string; email: string },
  dayLabel: string,
  slotLabel: string,
  bant: BantAnswers,
) {
  assertFenced(who.phone); assertFenced(who.email);
  await page.goto("/book");
  const day = page.locator("div").filter({ has: page.locator(`p:text-is("${dayLabel}")`) }).last();
  await day.getByRole("button", { name: new RegExp(`^${slotLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") }).first().click();
  await page.locator("input[name=name]").fill(who.name);
  await page.locator("input[name=email]").fill(who.email);
  const national = who.phone.startsWith("+91") ? who.phone.slice(3) : who.phone.replace(/^\+49/, "");
  if (who.phone.startsWith("+49")) {
    await page.getByRole("button", { name: "Country code" }).click();
    await page.getByRole("option", { name: /Germany/ }).first().click();
  }
  await page.locator("input[type=tel]").first().fill(national);
  await page.locator("input[name=linkedInProfile]").fill("https://www.linkedin.com/in/e2e-test");
  await pickSelect(page, "highestEducation", "Masters");
  await page.locator("input[name=currentJobTitle]").fill("QA Engineer");
  await pickSelect(page, "yearsExperience", "5+ years");
  await page.locator("input[name=prospectIndustry]").fill("IT Related");
  await page.locator("textarea[name=whyGermany]").fill(`${RUN} automated end-to-end test booking - please ignore.`);
  await pickSelect(page, "alreadyApplied", bant.alreadyApplied);
  await pickSelect(page, "whenStartGermany", bant.whenStartGermany);
  await pickSelect(page, "germanVisa", "No, I don't");
  await pickSelect(page, "germanLevel", "A1 level");
  await pickSelect(page, "willingnessLearnGerman", "Yes, I am ready to learn German.");
  await pickSelect(page, "currentIncome", bant.currentIncome);
  await pickSelect(page, "readyToInvest", bant.readyToInvest);
  await pickSelect(page, "decisionMaking", bant.decisionMaking);
  await pickSelect(page, "howKnowUs", "Instagram");
  const consent = page.locator("input[name=consent]");
  if (await consent.count()) await consent.check({ force: true });
  await page.getByRole("button", { name: "Confirm my call" }).click();
}

export function istDateParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  const parts = Object.fromEntries(f.formatToParts(d).map((p) => [p.type, p.value]));
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, dmy: `${parts.day}/${parts.month}/${parts.year}`, hhmm: `${parts.hour}:${parts.minute}` };
}
export function ist12h(d: Date) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(d);
}

export function record(kind: string, label: string, id?: string, cleanup = "99-cleanup.spec.ts purges fenced leads") {
  recordCreated(AREA, { kind, id, label: `${RUN} ${label}`, cleanup });
}

export { FENCE, HAS_DB, IS_PROD, RUN };
