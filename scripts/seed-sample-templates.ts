/**
 * Load the sample agreement documents into the template library of a LOCAL database.
 *
 *   npm run demo:agreement-templates:seed
 *
 * ── WHY A SCRIPT AND NOT FIVE UPLOADS ──────────────────────────────────────────────────────
 * The template screen is hard to judge with one template on it: the chooser, the "used by N
 * agreements" line and the version controls all only make sense against a shelf. This puts five
 * on it in one go.
 *
 * ── IT GOES THROUGH THE REAL PARSER ────────────────────────────────────────────────────────
 * `parseUpload` - the same function the upload route calls - does the work, so the blocks, the
 * fields discovered from `[[sign:…]]` placeholders, the stored bytes and the sha256 are exactly
 * what an upload of these files would have produced. A hand-written row would only resemble one,
 * and would quietly stop resembling it the next time the parser changed.
 *
 * ── LOCAL ONLY, AND ENFORCED ───────────────────────────────────────────────────────────────
 * ⚠ `.env` on this machine points at the LIVE Supabase database, and it wins over a shell-set
 * `DATABASE_URL`. So this script does NOT read the ambient connection at all: it builds its own
 * client from `SEED_DATABASE_URL`, defaulting to local Postgres, and refuses to run against a
 * host that is not loopback. Demo contracts in the founder's live template library would be a
 * mess to unpick.
 */

import { PrismaClient, Prisma } from "@prisma/client";
import { parseUpload } from "@/server/agreement-upload";
import { describeFields } from "@/lib/agreement-doc";
import { SAMPLES } from "./make-sample-templates";

const LOCAL_DEFAULT = "postgresql://b2:b2@localhost:5435/b2_dashboard";
const url = process.env.SEED_DATABASE_URL ?? LOCAL_DEFAULT;

const host = (() => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
})();
if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
  console.error(
    `Refusing to seed: ${host || "that URL"} is not a local database.\n` +
      "This writes demo templates. Point SEED_DATABASE_URL at local Postgres.",
  );
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });
const replace = process.env.SEED_REPLACE === "1";

async function main() {
  console.log(`Seeding ${SAMPLES.length} sample templates into ${host}\n`);

  /**
   * Templates are owned by whoever uploaded them, and the screen shows that name. The founder is
   * ADMIN (there is no FOUNDER role - see the `Role` enum); any user will do for demo data, but
   * without one there is nobody to attribute them to, so stop rather than invent a user.
   */
  const author =
    (await prisma.user.findFirst({
      where: { role: "ADMIN", status: "ACTIVE" },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
    })) ??
    (await prisma.user.findFirst({ where: { status: "ACTIVE" }, select: { id: true, name: true } }));
  if (!author) {
    console.error("No user in this database to own the templates. Run the usual seed first.");
    process.exit(1);
  }
  console.log(`Attributing them to ${author.name}\n`);

  for (const sample of SAMPLES) {
    const existing = await prisma.agreementTemplate.findFirst({
      where: { name: sample.name },
      select: { id: true, versions: { select: { id: true } } },
    });
    if (existing) {
      /**
       * Left alone by default, because the founder may have edited it. `SEED_REPLACE=1` throws it
       * away and re-parses instead - which is what you want after changing the parser, since the
       * stored blocks and fields are a snapshot of what the parser said at upload time and will
       * not improve on their own.
       */
      if (!replace) {
        console.log(`  = ${sample.name} - already here, left alone (SEED_REPLACE=1 to rebuild)`);
        continue;
      }
      await prisma.agreementTemplate.update({
        where: { id: existing.id },
        data: { currentVersionId: null },
      });
      await prisma.agreementTemplateVersion.deleteMany({ where: { templateId: existing.id } });
      await prisma.agreementTemplate.delete({ where: { id: existing.id } });
      console.log(`  - ${sample.name} - replaced`);
    }

    const parsed = await parseUpload({ bytes: await sample.build(), filename: sample.file });
    if (!parsed.ok) {
      console.error(`  ! ${sample.name} - ${parsed.error}`);
      continue;
    }

    const template = await prisma.agreementTemplate.create({
      data: {
        name: sample.name,
        description: sample.description,
        kind: parsed.kind,
        createdById: author.id,
        versions: {
          create: {
            version: 1,
            kind: parsed.kind,
            blocks:
              parsed.kind === "DOCX"
                ? (parsed.blocks as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            fields: parsed.fields as unknown as Prisma.InputJsonValue,
            sourceBytes: parsed.bytes,
            sourceName: parsed.sourceName,
            sourceMime: parsed.sourceMime,
            sourceSize: parsed.sourceSize,
            sourceSha256: parsed.sourceSha256,
            pageCount: parsed.kind === "PDF" ? parsed.pageCount : null,
            pageSizes:
              parsed.kind === "PDF"
                ? (parsed.pageSizes as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            createdById: author.id,
            label: "Sample",
          },
        },
      },
      select: { id: true, versions: { select: { id: true } } },
    });
    // `currentVersionId` is what new agreements are drawn from, and it cannot be set in the same
    // create (the version does not exist yet to point at).
    await prisma.agreementTemplate.update({
      where: { id: template.id },
      data: { currentVersionId: template.versions[0]!.id },
    });

    const blocks = parsed.kind === "DOCX" ? (parsed.blocks as unknown[]).length : 0;
    console.log(`  + ${sample.name}`);
    console.log(`      ${blocks} blocks · ${describeFields(parsed.fields) || "no fields"}`);
    for (const w of parsed.warnings ?? []) console.log(`      ⚠ ${w}`);
  }

  const total = await prisma.agreementTemplate.count({ where: { archivedAt: null } });
  console.log(`\n${total} templates now in the library. See /agreements/templates.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
