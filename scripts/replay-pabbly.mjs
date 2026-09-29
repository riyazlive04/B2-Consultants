/**
 * Replay a Pabbly opt-in delivery against the local lead relay.
 *
 * Pabbly is a cloud service and cannot reach localhost, so the usual way to exercise
 * /api/leads/pabbly in dev is to post the same shape it would. This does that, with a payload
 * modelled on the optin.b2consultants.de landing page: contact fields, a lead_source hint, UTM
 * params, and the band-score answers the page collects.
 *
 * Run:  node --env-file=.env scripts/replay-pabbly.mjs
 *       node --env-file=.env scripts/replay-pabbly.mjs --id fixed-1   # twice → proves de-dupe
 *       node --env-file=.env scripts/replay-pabbly.mjs --url https://b2app.sirahagents.com --force
 *
 * Deliberately NOT wired into package.json scripts: this writes a real lead, and a name sitting
 * in the script list invites someone to run it against production by reflex. It takes an explicit
 * --url for the same reason, and refuses a non-localhost target unless --force is passed.
 */

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const base = flag("url", "http://localhost:3000").replace(/\/+$/, "");
const force = args.includes("--force");
const secret = process.env.PABBLY_WEBHOOK_SECRET;

// The guard is on the DATABASE, not the URL.
//
// A localhost:3000 app server is NOT evidence of a safe target - .env can (and now does) point a
// local dev server straight at production Supabase, in which case posting here writes a real lead
// into the real CRM. The URL check alone was security theatre the moment that became true.
const isLocalUrl = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(base);
const db = process.env.DATABASE_URL ?? "";
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(db);

if (!force && (!isLocalUrl || !isLocalDb)) {
  console.error(`Refusing to replay without --force.`);
  console.error(`  target : ${base} ${isLocalUrl ? "(local)" : "(NOT local)"}`);
  console.error(`  database: ${isLocalDb ? "local" : "NOT local - this would create a REAL lead"}`);
  if (isLocalUrl && !isLocalDb) {
    console.error("\nThe app is local but its DATABASE_URL is remote, so 'localhost' means nothing here.");
  }
  process.exit(1);
}
if (!secret) {
  console.error("PABBLY_WEBHOOK_SECRET is not set - run with `node --env-file=.env`.");
  console.error("Without it the route fails closed with 503, which is the correct behaviour.");
  process.exit(1);
}

// A plausible delivery. `unwrap` accepts the fields at the top level or nested under
// data/contact/fields/payload, so this exercises the nested path - the one Pabbly actually uses.
//
// The identity defaults to a per-second timestamp so repeated runs make DISTINCT leads. Pass
// `--id` to pin it: the same id twice is what a Pabbly redelivery looks like, and it is the only
// way to actually exercise the (source, externalRef) de-dupe rather than just assume it works.
const stamp = flag("id", new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14));

// The contact fields are DERIVED from the identity, not generated independently - so a pinned
// `--id` reproduces the same person, phone included. `--id` accepts letters, hence the digit
// fold: the phone dedup normalises punctuation but a non-numeric phone is simply not a phone.
const digits = [...stamp].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 100000000, 7)
  .toString().padStart(8, "0");
const tag = stamp.slice(-6);

const payload = {
  event: "form_submission",
  payload: {
    id: `replay_${stamp}`,
    full_name: `Replay Lead ${tag}`,
    email: `replay.${tag}@example.test`,
    phone: `+9199${digits}`,
    city: "Chennai",
    lead_source: "landing_page",
    campaign_name: "LFMVP - Free Training",
    utm_source: "facebook",
    utm_medium: "paid",
    utm_campaign: "lfmvp_de_2026",
    utm_content: "hero_cta",
    // The landing page's qualification answers ride along in the same body; the route hands the
    // whole object to upsertIntakeLead as `intakePayload` rather than picking fields itself.
    years_experience: "5",
    current_ctc: "12 LPA",
    german_level: "A1",
    field: "Mechanical",
  },
};

console.log(`POST ${base}/api/leads/pabbly`);
const res = await fetch(`${base}/api/leads/pabbly`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-webhook-secret": secret },
  body: JSON.stringify(payload),
});

const text = await res.text();
console.log(`HTTP ${res.status}`);
console.log(text);

// A 200 that deduped is still a pass - it proves the idempotency path, not a failure to capture.
if (!res.ok) process.exit(1);
