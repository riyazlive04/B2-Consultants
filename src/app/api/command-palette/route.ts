import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ACTIVE } from "@/lib/soft-delete";
import { resolveSections, sectionAllowed, type AppRole, type SectionOverrides } from "@/lib/sections";
import { getSectionsConfig } from "@/server/founder-config";

/**
 * Lightweight summary feed for the global ⌘K command palette (BUILD_CHECKLIST.md §3):
 * id/label/sublabel/type/href only, no full records — fetching every contact/opportunity/
 * invoice up front would be exactly the "ship 1000+ rows to the client" mistake §17 of the
 * product audit flags elsewhere. Capped per type and ordered by recency, same shape as the
 * "500 most-recently-touched records" the task calls for.
 *
 * Section-gated the same way the pages themselves are (founder's live config + per-user
 * overrides, not just the role default) — a USER without Payments access shouldn't be able to
 * find an invoice by typing its number into the palette that a page-level guard would block.
 */

const PER_TYPE_CAP = 500;

export async function GET() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (!session) return NextResponse.json({ items: [] }, { status: 401 });

  const role = (session.user as { role?: string }).role as AppRole;
  const row = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { sectionAccess: true },
  });
  const overrides = (row?.sectionAccess as SectionOverrides | null) ?? null;
  const sections = resolveSections(await getSectionsConfig());
  const allowed = (key: string) => {
    const section = sections.find((s) => s.key === key);
    return !!section && sectionAllowed(section, role, overrides);
  };

  const [contacts, opportunities, invoices] = await Promise.all([
    allowed("contacts")
      ? prisma.lead.findMany({
          where: ACTIVE,
          orderBy: { updatedAt: "desc" },
          take: PER_TYPE_CAP,
          select: { id: true, name: true, phone: true, company: { select: { name: true } } },
        })
      : Promise.resolve([]),
    allowed("opportunities")
      ? prisma.opportunity.findMany({
          where: { deletedAt: null, lead: { deletedAt: null } },
          orderBy: { updatedAt: "desc" },
          take: PER_TYPE_CAP,
          select: { id: true, name: true, pipelineId: true, lead: { select: { name: true } } },
        })
      : Promise.resolve([]),
    allowed("payments")
      ? prisma.invoice.findMany({
          where: ACTIVE,
          orderBy: { updatedAt: "desc" },
          take: PER_TYPE_CAP,
          select: { id: true, number: true, customerName: true },
        })
      : Promise.resolve([]),
  ]);

  const items = [
    ...contacts.map((c) => ({
      id: `contact-${c.id}`,
      label: c.name,
      sublabel: c.company?.name ?? c.phone,
      type: "contact" as const,
      href: `/contacts/${c.id}`,
    })),
    ...opportunities.map((o) => ({
      id: `opportunity-${o.id}`,
      label: o.name,
      sublabel: o.lead.name,
      type: "opportunity" as const,
      // Board.tsx has no per-card deep link (the edit modal isn't URL-addressable) — this at
      // least lands on the right pipeline rather than just "/opportunities".
      href: `/opportunities?pipeline=${o.pipelineId}`,
    })),
    ...invoices.map((i) => ({
      id: `invoice-${i.id}`,
      label: i.number,
      sublabel: i.customerName,
      type: "invoice" as const,
      href: `/payments/${i.id}`,
    })),
  ];

  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
