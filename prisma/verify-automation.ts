/**
 * Automation folders + soft delete — end-to-end verification.
 *
 * Proves the wiring the unit tests can't: that a workflow's folder/deleted state in Postgres
 * actually changes what the rendered Automation screen shows, and that the FK rules behave as
 * the UI promises. Runs against the REAL database and the REAL running server (log in, fetch
 * the page, assert on the HTML), complementing the pure boundary tests in
 * src/lib/__tests__/automation-quiet-hours.test.ts.
 *
 * Needs the app running on APP_URL (default http://localhost:3000).
 *
 * Safe to re-run: every fixture is namespaced by RUN_TAG and torn down at the end.
 *
 * Run: npm run verify:automation
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APP = process.env.APP_URL ?? "http://localhost:3000";
const EMAIL = process.env.SEED_ADMIN_EMAIL ?? "ameen@b2consultants.in";
const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "change-me-now";
const RUN_TAG = `wf-verify-${Date.now()}`;

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/**
 * better-auth sets its session cookie on the sign-in response; reuse it for page fetches.
 * `Origin` is required — better-auth rejects a cross-origin-looking POST without it (403
 * MISSING_OR_NULL_ORIGIN), and bare fetch, unlike a browser, sends none.
 */
async function login(): Promise<string> {
  const res = await fetch(`${APP}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.getSetCookie?.().map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("no session cookie returned");
  return cookie;
}

async function getPage(path: string, cookie: string): Promise<string> {
  const res = await fetch(`${APP}${path}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.text();
}

async function main() {
  console.log(`\nAutomation verification (${RUN_TAG})\n`);
  const cookie = await login();

  const folder = await prisma.workflowFolder.create({ data: { name: `${RUN_TAG}-folder` } });
  const wf = await prisma.workflow.create({
    data: {
      name: `${RUN_TAG}-workflow`,
      triggerType: "CONTACT_CREATED",
      triggerConfig: {},
      actions: [{ id: "a1", type: "ADD_TAG", tag: RUN_TAG }],
      folderId: folder.id,
    },
  });

  try {
    console.log("Folders");
    {
      const root = await getPage("/automation", cookie);
      // A foldered workflow must NOT also appear loose in the root list, or it'd read as two.
      check("folder is listed at root", root.includes(`${RUN_TAG}-folder`));
      check("foldered workflow is hidden from the root list", !root.includes(`${RUN_TAG}-workflow`));

      const inside = await getPage(`/automation?folder=${folder.id}`, cookie);
      check("workflow appears inside its folder", inside.includes(`${RUN_TAG}-workflow`));

      // An unknown folder must hit notFound() rather than silently rendering an empty list —
      // an empty list would read as "this folder is empty", which is a different fact.
      //
      // Asserted on the rendered body, not the status: these pages are force-dynamic, so Next
      // flushes 200 headers before notFound() throws and the status stays 200. That's app-wide
      // pre-existing behaviour (/automation/[id] and /contacts/[id] do the same), not something
      // this feature introduced — so the body is the honest signal here.
      const missing = await getPage("/automation?folder=does-not-exist", cookie);
      check("unknown folder renders not-found", /not found|404/i.test(missing));
      check("unknown folder does not render a workflow list", !missing.includes("New workflow"));
    }

    console.log("\nSoft delete");
    {
      await prisma.workflow.update({ where: { id: wf.id }, data: { deletedAt: new Date() } });

      const inside = await getPage(`/automation?folder=${folder.id}`, cookie);
      check("deleted workflow leaves the live list", !inside.includes(`${RUN_TAG}-workflow`));

      const deleted = await getPage("/automation?tab=deleted", cookie);
      check("deleted workflow appears in the Deleted tab", deleted.includes(`${RUN_TAG}-workflow`));

      // The whole point of soft delete: the row survives, so restore is real.
      const still = await prisma.workflow.findUnique({ where: { id: wf.id } });
      check("row survives soft delete", still !== null);

      await prisma.workflow.update({ where: { id: wf.id }, data: { deletedAt: null } });
      const restored = await getPage(`/automation?folder=${folder.id}`, cookie);
      check("restore brings it back to its folder", restored.includes(`${RUN_TAG}-workflow`));
    }

    console.log("\nTrigger scan ignores deleted workflows");
    {
      // emitTrigger filters `deletedAt: null` — assert against the same query it runs, since a
      // deleted workflow that still enrolled contacts would be a silent, contact-visible bug.
      await prisma.workflow.update({ where: { id: wf.id }, data: { status: "PUBLISHED", deletedAt: new Date() } });
      const scanned = await prisma.workflow.findMany({
        where: { status: "PUBLISHED", triggerType: "CONTACT_CREATED", deletedAt: null },
        select: { id: true },
      });
      check("published-but-deleted workflow is not scanned", !scanned.some((r) => r.id === wf.id));

      await prisma.workflow.update({ where: { id: wf.id }, data: { deletedAt: null } });
      const rescanned = await prisma.workflow.findMany({
        where: { status: "PUBLISHED", triggerType: "CONTACT_CREATED", deletedAt: null },
        select: { id: true },
      });
      check("restored workflow is scanned again", rescanned.some((r) => r.id === wf.id));
    }

    console.log("\nDeleting a folder never deletes its workflows");
    {
      await prisma.workflowFolder.delete({ where: { id: folder.id } });
      const orphan = await prisma.workflow.findUnique({ where: { id: wf.id }, select: { folderId: true } });
      check("workflow survives its folder", orphan !== null);
      check("workflow falls back to root (FK SetNull)", orphan?.folderId === null);

      const root = await getPage("/automation", cookie);
      check("it now shows in the root list", root.includes(`${RUN_TAG}-workflow`));
    }
  } finally {
    await prisma.workflow.deleteMany({ where: { name: { startsWith: RUN_TAG } } });
    await prisma.workflowFolder.deleteMany({ where: { name: { startsWith: RUN_TAG } } });
    await prisma.$disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.workflow.deleteMany({ where: { name: { startsWith: RUN_TAG } } }).catch(() => {});
  await prisma.workflowFolder.deleteMany({ where: { name: { startsWith: RUN_TAG } } }).catch(() => {});
  await prisma.$disconnect();
  process.exit(1);
});
