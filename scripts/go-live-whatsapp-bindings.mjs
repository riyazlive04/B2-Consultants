// Repair the WhatsApp template bindings that go-live depends on.
//
// ─────────────────────────────── WHY THIS IS A SCRIPT ───────────────────────────────
// Both changes are reachable from the WhatsApp settings screen, and for a person that screen is
// the right door. This exists because that form REBUILDS the whole template map from its own
// inputs on every save (saveWatiSettings loops WHATSAPP_KINDS and keeps only the non-empty
// `tpl_<kind>_name` boxes). Correct for a human looking at the rendered form; wrong for an
// unattended edit, where anything the form did not render would be silently dropped.
//
// This script MERGES: it touches only the kinds named below and copies every other field
// through untouched, so it cannot un-bind a template or reset a cadence number.
//
// ─────────────────────────── THE PARAMS ARE NOT GUESSED ─────────────────────────────
// `params` is the variable list the template was APPROVED with. Get it wrong and the send is
// rejected or renders broken - so this script does not hardcode it. It reads the cached WATI
// catalogue (`watiTemplateCatalog`), which is what WATI reports Meta actually approved, and
// binds exactly that.
//
// This matters more than it sounds. `b2_booking_confirm_request` is approved as a POSITIONAL
// template - its variables are ["1","2","3"], not ["name","slot_time","booking_url"]. Binding
// the readable-looking names would have produced a template whose every send fails. The app
// handles positional templates through `positionalVarMap`, which maps {{1}}→name, {{2}}→slot_time,
// {{3}}→booking_url for this kind, but ONLY if the binding stores the positional names.
//
// ─────────────────────────────── WHAT IT FIXES ──────────────────────────────────────
//
// 1. BOOKING_CONFIRM_REQUEST - bound to the right template, with an EMPTY params list.
//    `buildParameters` maps over `template.params`, so an empty list sends ZERO variables for a
//    three-variable template: every send of the confirm-or-cancel request fails. The engine is
//    still off (`autoCancelEnabled`), so today this is a trap rather than an active fire - but
//    arming the loop with the binding in this state means prospects get asked nothing and then
//    get cancelled for not replying.
//
// 2. STUDENT_WELCOME - unbound. Bound here ONLY once `b2_student_welcome` appears APPROVED in the
//    catalogue; until it has been submitted to Meta and approved there is nothing valid to point
//    at, and the script says so rather than writing a name that cannot send.
//
// The welcome's cadence switch (`studentWelcomeEnabled`) is deliberately NOT part of this script.
// Flipping it makes the app message real students on seating; that belongs on the settings screen,
// consciously, after the binding below reports green.
//
// ─────────────────────────────── USAGE ──────────────────────────────────────────────
//   node --env-file=.env scripts/go-live-whatsapp-bindings.mjs            # dry run (default)
//   node --env-file=.env scripts/go-live-whatsapp-bindings.mjs --apply    # write
//   …--apply --allow-unapproved   # bind even if the catalogue says not APPROVED (rarely right)
//   …--refresh-catalogue          # reminder only; the sync lives on the WhatsApp settings screen
//
// Idempotent: a second run reports "already correct" and writes nothing.

import { PrismaClient } from "@prisma/client";

const SETTINGS_KEY = "watiConfig";
const CATALOG_KEY = "watiTemplateCatalog";

const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply");
const ALLOW_UNAPPROVED = argv.includes("--allow-unapproved");

/**
 * The kinds this script repairs, and the template each should point at.
 *
 * `canonical` mirrors BASE_AVAILABLE_VARS in src/lib/whatsapp.ts. It is duplicated here only to
 * sanity-check a POSITIONAL binding: positionalVarMap refuses to translate when the counts differ,
 * so a positional template whose arity does not match the kind's variable list would bind
 * "successfully" and then skip every send. Better to say that now than to discover it live.
 */
const TARGETS = {
  BOOKING_CONFIRM_REQUEST: {
    template: "b2_booking_confirm_request",
    canonical: ["name", "slot_time", "booking_url"],
  },
  STUDENT_WELCOME: {
    template: "b2_student_welcome",
    canonical: ["name", "program", "tutor_name", "first_class", "portal_url"],
    // The sender guarantees the first four are non-empty; portal_url is the one that can be blank,
    // which is why the approval pack keeps `b2_student_welcome` (4 vars) and
    // `b2_student_welcome_portal` (5 vars) as separate names. Bind ONE.
    expectArity: 4,
  },
};

const prisma = new PrismaClient();

const eq = (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
const isPositional = (p) => p.length > 0 && p.every((x) => /^\d+$/.test(x));

async function main() {
  const host = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(
    /:\/\/([^:]+):[^@]+@/,
    "://$1:****@",
  );
  console.log(`Target : ${host || "(no DATABASE_URL set)"}`);
  console.log(`Mode   : ${APPLY ? "APPLY (will write)" : "DRY RUN (no writes)"}\n`);

  const [settingsRow, catalogRow] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: SETTINGS_KEY } }),
    prisma.appSetting.findUnique({ where: { key: CATALOG_KEY } }),
  ]);

  if (!settingsRow) {
    console.error(
      `No AppSetting row "${SETTINGS_KEY}". The WhatsApp settings have never been saved; open the\n` +
        "WhatsApp settings screen and save once, then re-run. Refusing to create the row here: a\n" +
        "config invented by a script would carry defaults nobody chose.",
    );
    process.exitCode = 1;
    return;
  }

  const catalogue = Array.isArray(catalogRow?.value) ? catalogRow.value : [];
  if (!catalogue.length) {
    console.error(
      `No cached WATI catalogue ("${CATALOG_KEY}"). This script binds the variable list Meta\n` +
        "actually approved rather than guessing it, so it cannot run without one. Refresh the\n" +
        "template list on the WhatsApp settings screen, then re-run.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Catalogue: ${catalogue.length} templates, last synced ${
      catalogRow.updatedAt ? new Date(catalogRow.updatedAt).toISOString() : "unknown"
    }`,
  );
  console.log("           (a stale catalogue is the one way this script can still bind the wrong\n" +
              "            thing - refresh it on the settings screen if the date looks old)\n");

  // ── Is STUDENT_WELCOME a value of the enum yet? ──
  // The binding is JSON and stores fine either way, but the sender writes a WhatsAppMessage row
  // with kind=STUDENT_WELCOME, which throws until the migration is applied.
  const enumRows = await prisma.$queryRawUnsafe(
    `select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'WhatsAppKind' and e.enumlabel = 'STUDENT_WELCOME'`,
  );
  if (!enumRows.length) {
    console.log(
      "⚠ STUDENT_WELCOME is not yet a value of the WhatsAppKind enum - migration\n" +
        "  20261013120000_student_welcome_message has not been applied. Binding it is harmless,\n" +
        "  but the welcome cannot send until that migration lands.\n",
    );
  }

  const before = JSON.parse(JSON.stringify(settingsRow.value ?? {}));
  const after = JSON.parse(JSON.stringify(before));
  after.templates ??= {};

  const changes = [];

  for (const [kind, want] of Object.entries(TARGETS)) {
    const label = kind.padEnd(24);
    const entry = catalogue.find((t) => t && t.name === want.template);

    if (!entry) {
      console.log(
        `  ⏭ ${label} "${want.template}" is NOT in the WATI catalogue.\n` +
          `     It has not been submitted to Meta yet, so there is nothing valid to bind.\n` +
          `     Submit it (docs pack: npm run docs:whatsapp:utility), wait for approval,\n` +
          `     refresh the template list, then re-run this script.`,
      );
      continue;
    }

    const status = String(entry.status ?? "UNKNOWN").toUpperCase();
    if (status !== "APPROVED" && !ALLOW_UNAPPROVED) {
      console.log(
        `  ⏭ ${label} "${want.template}" is ${status}, not APPROVED - skipping.\n` +
          `     Pass --allow-unapproved to bind anyway (it will fail at send time until Meta approves).`,
      );
      continue;
    }

    const approvedParams = Array.isArray(entry.params) ? entry.params.map(String) : [];

    // Arity checks, so a binding that would silently skip every send is caught here.
    if (isPositional(approvedParams) && approvedParams.length !== want.canonical.length) {
      console.log(
        `  ✖ ${label} "${want.template}" is positional with ${approvedParams.length} placeholder(s),\n` +
          `     but this kind supplies ${want.canonical.length} variable(s) ` +
          `(${want.canonical.join(", ")}).\n` +
          `     positionalVarMap refuses to guess when the counts differ, so every send would be\n` +
          `     skipped. Not binding - the template needs re-approving with the right arity.`,
      );
      process.exitCode = 1;
      continue;
    }
    if (want.expectArity && approvedParams.length !== want.expectArity) {
      console.log(
        `  ⚠ ${label} "${want.template}" declares ${approvedParams.length} variable(s), expected ` +
          `${want.expectArity}:\n     [${approvedParams.join(", ")}]\n` +
          `     Check you are not binding the _portal variant by mistake.`,
      );
    }

    const current = before.templates?.[kind];
    if (current?.name === want.template && eq(current.params, approvedParams)) {
      console.log(`  = ${label} already correct → ${want.template} [${approvedParams.join(", ")}]`);
      continue;
    }

    const note = isPositional(approvedParams)
      ? `  (positional: ${approvedParams
          .map((p, i) => `{{${p}}}→${want.canonical[i]}`)
          .join(", ")})`
      : "";

    console.log(
      `  ✎ ${label} ${current?.name ?? "(unbound)"} [${(current?.params ?? []).join(", ")}]\n` +
        `     → ${want.template} [${approvedParams.join(", ")}]${note}`,
    );
    changes.push(
      `${kind}: ${current?.name ? `"${current.name}"` : "(unbound)"} [${(current?.params ?? []).join(
        ", ",
      )}] → "${want.template}" [${approvedParams.join(", ")}]`,
    );

    // Preserve a hand-set broadcastName: it is a WATI-side label, not ours to drop.
    after.templates[kind] = {
      name: want.template,
      ...(current?.broadcastName ? { broadcastName: current.broadcastName } : {}),
      params: approvedParams,
    };
  }

  console.log("");

  if (!changes.length) {
    console.log("Nothing to write.");
    return;
  }

  if (!APPLY) {
    console.log("DRY RUN - nothing written. Re-run with --apply to make these changes:");
    for (const c of changes) console.log(`  · ${c}`);
    return;
  }

  await prisma.appSetting.update({ where: { key: SETTINGS_KEY }, data: { value: after } });

  console.log("Written:");
  for (const c of changes) console.log(`  · ${c}`);
  console.log(
    "\nNOTE: this writes config directly, so it leaves no activity_log entry - unlike a save from\n" +
      "the WhatsApp settings screen. Worth mentioning to whoever reads that log.",
  );
}

main()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
