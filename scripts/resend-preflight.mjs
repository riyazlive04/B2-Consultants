// Resend preflight — answers "is my Resend account actually ready to send?" BEFORE you deploy.
//
// The email channel has three independent gates (see src/lib/email.ts's getEmailRuntime):
//
//   1. EMAIL_ENABLED="true"        env
//   2. RESEND_API_KEY set          env
//   3. a From address on a         AppSetting("emailConfig"), edited in Conversations → Settings
//      VERIFIED domain
//
// Miss any one and every email path silently no-ops — a SKIPPED Message row, no error. This script
// checks gates 1 and 2 plus the thing neither the app nor Resend's dashboard tells you at save
// time: whether your sending domain has actually finished DNS verification. An unverified sender
// is Resend's single most common rejection and it fails at SEND time, not at save time, so a
// deploy that looks clean can still deliver nothing.
//
// Gate 3's address lives in the database, so this script does not check it — the "Send test"
// button in Conversations → Settings covers that end-to-end path once the app is running.
//
// USAGE
//   npm run email:preflight                          # check key + list domains and their status
//   npm run email:preflight -- --send you@you.com    # ALSO send one real email (needs --from)
//   npm run email:preflight -- --send you@you.com --from "B2 <hello@mail.b2consultants.in>"
//
// Reads .env via node --env-file (see package.json). To check the PRODUCTION key instead:
//   node --env-file=.env.production scripts/resend-preflight.mjs
//
// EXIT CODES: 0 = ready to send, 1 = something would stop mail going out.

const API = "https://api.resend.com";

const args = process.argv.slice(2);
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : (args[i + 1] ?? "");
}

const sendTo = flag("send");
const fromArg = flag("from");

let failed = false;
const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m    ${m}`);
const warn = (m) => console.log(`  \x1b[33mWARN\x1b[0m  ${m}`);
const bad = (m) => {
  failed = true;
  console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`);
};

async function api(path, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY?.trim()}`,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, body };
  } catch (e) {
    return { status: 0, ok: false, body: { message: e instanceof Error ? e.message : String(e) } };
  } finally {
    clearTimeout(t);
  }
}

console.log("\nResend preflight\n");

// ── Gate 1: EMAIL_ENABLED ───────────────────────────────────────────────────────
console.log("Environment");
const enabled = process.env.EMAIL_ENABLED?.trim().toLowerCase() === "true";
if (enabled) ok('EMAIL_ENABLED is "true"');
else bad(`EMAIL_ENABLED is ${JSON.stringify(process.env.EMAIL_ENABLED ?? "")} — must be exactly "true" or nothing sends`);

// ── Gate 2: the API key ─────────────────────────────────────────────────────────
const key = process.env.RESEND_API_KEY?.trim();
if (!key) {
  bad("RESEND_API_KEY is not set — create one at https://resend.com/api-keys");
  console.log("\nCannot check the account without a key.\n");
  process.exit(1);
}
ok(`RESEND_API_KEY is set (${key.slice(0, 6)}…, ${key.length} chars)`);
if (!key.startsWith("re_")) warn('key does not start with "re_" — check you copied the API key, not the webhook secret');

const hookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
if (hookSecret) ok("RESEND_WEBHOOK_SECRET is set — delivery/bounce events will update Message rows");
else warn("RESEND_WEBHOOK_SECRET is not set — /api/resend/webhook returns 503, so nothing will ever move past SENT to DELIVERED/bounced");

// ── Gate 3a: the account and its domains ────────────────────────────────────────
console.log("\nAccount");
const domains = await api("/domains", { method: "GET" });

if (domains.status === 401 || domains.status === 403) {
  bad(`the key was rejected (HTTP ${domains.status}) — it may be revoked, or it may be a sending-only key without domain read access`);
  console.log("\n");
  process.exit(1);
}
if (!domains.ok) {
  bad(`could not reach Resend: HTTP ${domains.status} ${domains.body?.message ?? ""}`.trim());
  console.log("\n");
  process.exit(1);
}
ok("key authenticates against the Resend API");

const list = Array.isArray(domains.body) ? domains.body : (domains.body?.data ?? []);
console.log("\nDomains");
if (!list.length) {
  bad("no domains on this account — add one at https://resend.com/domains, then publish its DNS records");
} else {
  let anyVerified = false;
  for (const d of list) {
    const status = String(d.status ?? "unknown");
    const line = `${d.name}  [${status}]${d.region ? `  region=${d.region}` : ""}`;
    if (status === "verified") {
      anyVerified = true;
      ok(line);
    } else if (status === "pending" || status === "not_started") {
      warn(`${line} — DNS not confirmed yet; sending from this domain will FAIL`);
    } else {
      bad(`${line} — verification failed; re-check the SPF/DKIM records at your registrar`);
    }
  }
  if (!anyVerified) bad("no VERIFIED domain — every send will be rejected until one goes green");
}

// ── Optional: a real send ───────────────────────────────────────────────────────
if (sendTo) {
  console.log("\nTest send");
  if (!fromArg) {
    bad('--send needs --from "Name <you@verified-domain>" (Resend has no default sender)');
  } else {
    const res = await api("/emails", {
      method: "POST",
      body: JSON.stringify({
        from: fromArg,
        to: [sendTo],
        subject: "B2 Consultants — Resend preflight",
        html: '<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.6;color:#16203A">'
          + "<p>This is a preflight test from the B2 Consultants app.</p>"
          + "<p>If you are reading it, the API key and the sending domain are both good.</p></div>",
      }),
    });
    if (res.ok && res.body?.id) ok(`sent to ${sendTo} — Resend id ${res.body.id}`);
    else bad(`send rejected: HTTP ${res.status} ${res.body?.message ?? res.body?.name ?? "unknown error"}`);
  }
}

console.log(
  failed
    ? "\n\x1b[31mNOT READY\x1b[0m — fix the FAIL lines above; mail would silently not go out.\n"
    : "\n\x1b[32mREADY\x1b[0m — env and account are good. Set the From address in Conversations → Settings, then use its Send test button.\n",
);
process.exit(failed ? 1 : 0);
