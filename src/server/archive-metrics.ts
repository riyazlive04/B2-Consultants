import "server-only";

import { prisma } from "@/lib/prisma";
import { formatInrMinor, formatEurMinor, formatDate } from "@/lib/format";
import { LEAD_STAGE_LABELS } from "@/lib/labels";
import { ARCHIVED } from "@/lib/soft-delete";

/**
 * Read layer for the per-section "Archived" tabs. Every getter returns the SAME serializable
 * `ArchivedRow` shape so one <ArchivedPanel> renders them all, and reads with `ARCHIVED`
 * (deletedAt != null) — the mirror of the `ACTIVE` filter the live views use.
 */

export type ArchivedRow = {
  id: string;
  primary: string; // headline (name / number / vendor)
  secondary: string | null; // sub-label (phone / customer / amount)
  detail: string | null; // small trailing context (stage / status / date)
  archivedByName: string | null;
  archivedOn: string | null; // formatted date
};

const money = (inrMinor: bigint, eurMinor: bigint): string =>
  eurMinor > 0n && inrMinor === 0n ? formatEurMinor(eurMinor) : formatInrMinor(inrMinor);

const stamp = (r: { deletedAt: Date | null; deletedBy: { name: string } | null }) => ({
  archivedByName: r.deletedBy?.name ?? null,
  archivedOn: r.deletedAt ? formatDate(r.deletedAt) : null,
});

const BY = { deletedBy: { select: { name: true } } } as const;

// ── Leads (Contacts + Pipeline) ──────────────────────────────────────────────
export async function getArchivedLeads(): Promise<ArchivedRow[]> {
  const rows = await prisma.lead.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: BY,
  });
  return rows.map((l) => ({
    id: l.id,
    primary: l.name,
    secondary: l.phone ?? l.email ?? null,
    detail: LEAD_STAGE_LABELS[l.stage] ?? l.stage,
    ...stamp(l),
  }));
}

// ── Companies (Contacts) ─────────────────────────────────────────────────────
export async function getArchivedCompanies(): Promise<ArchivedRow[]> {
  const rows = await prisma.company.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: BY,
  });
  return rows.map((c) => ({
    id: c.id,
    primary: c.name,
    secondary: c.domain ?? c.city ?? null,
    detail: c.country ?? null,
    ...stamp(c),
  }));
}

// ── Tasks (Contacts) ─────────────────────────────────────────────────────────
export async function getArchivedTasks(): Promise<ArchivedRow[]> {
  const rows = await prisma.contactTask.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: { ...BY, lead: { select: { name: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    primary: t.title,
    secondary: t.lead?.name ?? null,
    detail: t.status,
    ...stamp(t),
  }));
}

// ── Opportunities (Pipeline / Opportunities board) ───────────────────────────
export async function getArchivedOpportunities(): Promise<ArchivedRow[]> {
  const rows = await prisma.opportunity.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: { ...BY, lead: { select: { name: true } } },
  });
  return rows.map((o) => ({
    id: o.id,
    primary: o.name,
    secondary: o.lead?.name ?? null,
    detail: `${o.status} · ${formatInrMinor(o.valueInrMinor)}`,
    ...stamp(o),
  }));
}

// ── Income (Finance) ─────────────────────────────────────────────────────────
export async function getArchivedIncomes(): Promise<ArchivedRow[]> {
  const rows = await prisma.income.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: BY,
  });
  return rows.map((i) => ({
    id: i.id,
    primary: i.studentName,
    secondary: money(i.amountInrMinor, i.amountEurMinor),
    detail: `${i.programLevel} · ${formatDate(i.date)}`,
    ...stamp(i),
  }));
}

// ── Expense (Finance) ────────────────────────────────────────────────────────
export async function getArchivedExpenses(): Promise<ArchivedRow[]> {
  const rows = await prisma.expense.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: BY,
  });
  return rows.map((e) => ({
    id: e.id,
    primary: e.vendor,
    secondary: money(e.amountInrMinor, e.amountEurMinor),
    detail: `${e.category} · ${formatDate(e.date)}`,
    ...stamp(e),
  }));
}

// ── Pending payments (Finance) ───────────────────────────────────────────────
export async function getArchivedPendingPayments(): Promise<ArchivedRow[]> {
  const rows = await prisma.pendingPayment.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: BY,
  });
  return rows.map((p) => ({
    id: p.id,
    primary: p.studentName,
    secondary: money(p.totalFeeInrMinor, p.totalFeeEurMinor),
    detail: p.programLevel,
    ...stamp(p),
  }));
}

// ── Invoices & estimates (Payments) ──────────────────────────────────────────
export async function getArchivedInvoices(): Promise<ArchivedRow[]> {
  const rows = await prisma.invoice.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: BY,
  });
  return rows.map((i) => ({
    id: i.id,
    primary: `${i.number} · ${i.customerName}`,
    secondary: formatInrMinor(i.totalInrMinor),
    detail: `${i.kind === "ESTIMATE" ? "Estimate" : "Invoice"} · ${i.status}`,
    ...stamp(i),
  }));
}

// ── Products (Payments) ──────────────────────────────────────────────────────
export async function getArchivedProducts(): Promise<ArchivedRow[]> {
  const rows = await prisma.product.findMany({
    where: ARCHIVED,
    orderBy: { deletedAt: "desc" },
    include: BY,
  });
  return rows.map((p) => ({
    id: p.id,
    primary: p.name,
    secondary: formatInrMinor(p.priceInrMinor),
    detail: p.interval,
    ...stamp(p),
  }));
}

/** Counts for the tab labels (e.g. "Archived (12)"). One grouped call per section. */
export async function getArchivedCounts() {
  const [lead, company, opportunity, task, income, expense, pendingPayment, invoice, product] =
    await Promise.all([
      prisma.lead.count({ where: ARCHIVED }),
      prisma.company.count({ where: ARCHIVED }),
      prisma.opportunity.count({ where: ARCHIVED }),
      prisma.contactTask.count({ where: ARCHIVED }),
      prisma.income.count({ where: ARCHIVED }),
      prisma.expense.count({ where: ARCHIVED }),
      prisma.pendingPayment.count({ where: ARCHIVED }),
      prisma.invoice.count({ where: ARCHIVED }),
      prisma.product.count({ where: ARCHIVED }),
    ]);
  return { lead, company, opportunity, task, income, expense, pendingPayment, invoice, product };
}
