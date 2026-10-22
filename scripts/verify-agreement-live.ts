/**
 * Smoke-test the agreement READ PATHS against a real database.
 *
 *   npm run verify:agreement-live
 *
 * Runs WITH `--conditions=react-server` (unlike verify-agreement-docs.ts, which cannot): the
 * read paths go through `founder-config`, which memoises with React's `cache()`, and that only
 * exists under that condition. Nothing here renders a PDF, so the condition costs nothing.
 *
 * ── WHY THIS EXISTS ALONGSIDE verify-agreement-docs.ts ──────────────────────────────────────
 * That one proves the renderers work with no database at all. This one proves the opposite half:
 * that every `select` the agreement screens issue actually matches the schema in front of them.
 * That is the failure a migration causes - the renderer is fine, and the page 500s on a column
 * Prisma believes exists.
 *
 * It only READS. Nothing is created, updated or deleted, so it is safe to point at any
 * environment - but it reads whatever `DATABASE_URL` resolves to, and the Prisma CLI's
 * `.env`-wins behaviour means that is worth checking before you run it anywhere that matters.
 * It prints the host it reached so there is no doubt which database answered.
 */

import { prisma } from "@/lib/prisma";
import { listAgreements, getAgreementDetail, getAgreementCounts } from "@/server/agreement-metrics";
import { listAgreementTemplates, listUsableTemplates } from "@/server/agreement-templates";
import { listAgreementSigners, documentNeedsCoSigner } from "@/server/agreement-signers";
import { listAgreementAttachments } from "@/server/agreement-attachments";
import { documentReadiness, parseBodyRow } from "@/server/agreement-body";
import { timestampConfig } from "@/server/agreement-timestamp";
import { getAgreementWorkflow } from "@/server/founder-config";
import { describeFields } from "@/lib/agreement-doc";

function where(): string {
  const url = process.env.DATABASE_URL ?? "";
  const m = /@([^/]+)\/([^?]+)/.exec(url);
  return m ? `${m[1]}/${m[2]}` : "unknown";
}

async function main() {
  console.log(`database: ${where()}\n`);

  // ── Config ──
  const workflow = await getAgreementWorkflow();
  console.log(
    `workflow:   deliver by ${workflow.deliverBy}, ${workflow.ttlDays}-day window, ` +
      `chase on day ${workflow.reminderDays.join("/") || "(off)"}`,
  );
  const tsa = timestampConfig();
  console.log(`timestamps: ${tsa ? `${tsa.name} (${tsa.url})` : "off - AGREEMENT_TSA_URL is unset"}`);

  // ── The list screen ──
  const counts = await getAgreementCounts();
  const rows = await listAgreements();
  console.log(
    `\nagreements: ${rows.length} listed - ${counts.draft} draft, ${counts.awaiting} awaiting, ` +
      `${counts.signed} signed, ${counts.other} other`,
  );
  for (const r of rows.slice(0, 5)) {
    console.log(
      `  ${r.documentNo}  ${String(r.documentKind).padEnd(6)} ${String(r.status).padEnd(8)} ` +
        `${r.parsed.success ? r.parsed.data.student.fullName : "(fields do not validate)"}`,
    );
  }

  // ── The template library ──
  const templates = await listAgreementTemplates({ includeArchived: true });
  const usable = await listUsableTemplates();
  console.log(`\ntemplates:  ${templates.length} total, ${usable.length} offered when raising one`);
  for (const t of templates) {
    console.log(
      `  ${t.name} - ${t.kind}, v${t.currentVersion?.version ?? "-"}, ${t.versionCount} version(s), ` +
        `used by ${t.usedBy}, fields: ${t.fieldSummary}`,
    );
  }

  // ── The detail screen, for every agreement: this is the query-heavy one ──
  console.log(`\ndetail screens:`);
  for (const r of rows) {
    const detail = await getAgreementDetail(r.id);
    if (!detail) {
      console.log(`  ${r.documentNo}: not found`);
      continue;
    }
    const [signers, attachments] = await Promise.all([
      listAgreementSigners(detail.id),
      listAgreementAttachments(detail.id),
    ]);

    const body = detail.body ? parseBodyRow(detail.body) : null;
    let doc = "guided clause set";
    if (body?.ok) {
      const ready = documentReadiness(body.body);
      doc =
        `${body.body.kind} "${body.body.sourceName}" - ${describeFields(body.body.fields)}` +
        `, ${ready.ok ? "ready to send" : `${ready.problems.length} thing(s) outstanding`}` +
        `${documentNeedsCoSigner(body.body.fields) ? ", needs a co-signer" : ""}`;
    } else if (body && !body.ok) {
      doc = `UNREADABLE BODY: ${body.error}`;
    }

    console.log(
      `  ${detail.documentNo}: ${doc}` +
        ` | ${detail.events.length} events, ${signers.length} co-signer(s), ${attachments.length} file(s)` +
        ` | timestamp: ${detail.tsAuthority ?? (detail.tsError ? `failed (${detail.tsError})` : "none")}`,
    );
  }

  // ── The new tables, directly: a count proves the migration landed ──
  const [signerCount, attachmentCount, bodyCount] = await Promise.all([
    prisma.agreementSigner.count(),
    prisma.agreementAttachment.count(),
    prisma.agreementBody.count(),
  ]);
  console.log(
    `\ntables:     agreement_body ${bodyCount}, agreement_signer ${signerCount}, ` +
      `agreement_attachment ${attachmentCount}`,
  );

  console.log("\nEvery agreement read path answered without error.");
}

main()
  .catch((e) => {
    console.error("LIVE CHECK FAILED:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
