// Why has a signed agreement not become a Student?
//
// READ-ONLY. Writes nothing, changes nothing - it answers the one question the UI cannot:
// for each SIGNED agreement, does a Student exist for the lead it was issued against, and if
// not, what is standing in the way?
//
// The conversion is NOT automatic. `signAgreement` deliberately creates no Student (it seals the
// PDF and sends the countersigned copy, nothing more); the only path is Contacts -> open the
// contact -> "Convert to student", which calls `convertLeadToStudent` and is ADMIN-only on both
// sides (the button renders on session.role === "ADMIN", the action calls requireAdmin()).
//
// So a signed agreement with no student is the EXPECTED state until somebody presses that button.
// This script tells you whether the button is the missing step, or whether something would stop
// it working: the agreement hanging off no lead at all, the lead being gone, or a student that
// already exists and is simply not linked back.
//
// Usage:
//   node --env-file=.env scripts/diagnose-signed-to-student.mjs

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const pad = (s, n) => String(s ?? "").padEnd(n).slice(0, n);

async function main() {
  const host = (process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "").replace(
    /:\/\/([^:]+):[^@]+@/,
    "://$1:****@",
  );
  console.log(`Target : ${host || "(no DATABASE_URL set)"}`);
  console.log("Mode   : READ-ONLY\n");

  const agreements = await prisma.agreement.findMany({
    where: { signedAt: { not: null } },
    orderBy: { signedAt: "desc" },
    select: {
      id: true,
      documentNo: true,
      signedAt: true,
      status: true,
      leadId: true,
      studentId: true,
      data: true,
    },
  });

  console.log(`Signed agreements: ${agreements.length}`);
  const totals = await prisma.agreement.count();
  console.log(`All agreements   : ${totals}`);
  console.log(`Students         : ${await prisma.student.count()}`);
  console.log(`Leads            : ${await prisma.lead.count()}\n`);

  if (!agreements.length) {
    console.log("Nothing signed yet - there is nothing to convert.");
    return;
  }

  console.log(
    `${pad("DOC", 16)} ${pad("WHO", 22)} ${pad("LEAD", 10)} ${pad("STUDENT", 10)} VERDICT`,
  );

  for (const a of agreements) {
    const who = a.data?.student?.fullName ?? "(unknown)";
    let lead = null;
    if (a.leadId) {
      lead = await prisma.lead.findUnique({
        where: { id: a.leadId },
        select: { id: true, name: true },
      });
    }

    // The same lookup convertLeadToStudent does, so a row that says "already converted" here
    // is one the button would report as already converted too.
    const byLead = a.leadId
      ? await prisma.student.findFirst({ where: { leadId: a.leadId }, select: { id: true, code: true } })
      : null;
    const linked = a.studentId
      ? await prisma.student.findUnique({ where: { id: a.studentId }, select: { id: true, code: true } })
      : null;

    let verdict;
    if (linked) verdict = `✓ student ${linked.code ?? linked.id} (agreement is linked directly)`;
    else if (byLead) verdict = `✓ student ${byLead.code ?? byLead.id} exists for this lead`;
    else if (!a.leadId && !a.studentId) verdict = "✖ agreement has NEITHER leadId NOR studentId - nothing to convert from";
    else if (a.leadId && !lead) verdict = `✖ leadId ${a.leadId} no longer exists - convert would say "Lead not found"`;
    else verdict = '→ NOT CONVERTED YET: open Contacts -> this contact -> "Convert to student"';

    console.log(
      `${pad(a.documentNo, 16)} ${pad(who, 22)} ${pad(a.leadId ? "yes" : "-", 10)} ${pad(
        a.studentId ? "yes" : "-",
        10,
      )} ${verdict}`,
    );
  }

  console.log(
    "\nNote: conversion is manual by design and ADMIN-only. A '→ NOT CONVERTED YET' row is not\n" +
      "a fault in itself - it means the step has not been taken. A '✖' row is a real blocker.",
  );
}

main()
  .catch((e) => {
    console.error("FAILED:", e.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
