/**
 * Seed the built-in section library and page templates.
 *
 *   npm run db:snippets
 *
 * Idempotent, and safe to re-run on production: it matches on (name, scope, builtIn) and updates
 * the blocks in place, so re-running ships corrected copy without duplicating an entry or
 * touching a single thing the team has saved themselves. Nothing is ever deleted here - a
 * built-in that is retired from the code stays in the database, because a page somewhere was
 * probably built from it and its author does not need it vanishing mid-edit.
 */

import { PrismaClient, type SnippetScope } from "@prisma/client";
import { BUILT_IN_SNIPPETS } from "../src/lib/snippet-blocks";

const prisma = new PrismaClient();

/**
 * `.env` currently points DATABASE_URL at the Supabase PRODUCTION pooler - the localhost line is
 * commented out - so "just run the seed" writes to the live database. This seeder only ever adds
 * built-in library rows, which is about as benign as a write gets, but the team should still be
 * the ones deciding that it happens there. Same guard, same flag as `prisma/demo-data.ts`.
 */
function assertTarget() {
  const url = process.env.DATABASE_URL ?? "";
  const local = /@(localhost|127\.0\.0\.1|db)[:/]/.test(url);
  if (!local && !process.argv.includes("--force")) {
    throw new Error(
      `DATABASE_URL is not local (${url.replace(/:[^:@]*@/, ":***@")}).\n` +
      `Pass --force to seed the built-in library there on purpose.`,
    );
  }
  console.log(local ? "Target: local database" : "Target: REMOTE database (--force given)");
}

async function main() {
  assertTarget();
  let created = 0;
  let updated = 0;

  for (const s of BUILT_IN_SNIPPETS) {
    const blocks = s.blocks as unknown as object;
    // No unique index on (name, scope) - the team can name their own snippet anything, including
    // the same thing - so this finds the BUILT-IN with that name rather than upserting blindly.
    const existing = await prisma.sectionSnippet.findFirst({
      where: { name: s.name, scope: s.scope as SnippetScope, builtIn: true },
      select: { id: true },
    });
    if (existing) {
      await prisma.sectionSnippet.update({
        where: { id: existing.id },
        data: { category: s.category, blocks: blocks as never },
      });
      updated++;
    } else {
      await prisma.sectionSnippet.create({
        data: { name: s.name, category: s.category, scope: s.scope as SnippetScope, blocks: blocks as never, builtIn: true },
      });
      created++;
    }
  }

  const sections = BUILT_IN_SNIPPETS.filter((s) => s.scope === "SECTION").length;
  console.log(`Section library: ${sections} sections, ${BUILT_IN_SNIPPETS.length - sections} page templates`);
  console.log(`  ${created} created, ${updated} refreshed`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
