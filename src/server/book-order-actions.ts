"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/rbac";
import { decideBookOrder, initialBookOrderStatus } from "@/lib/book-order";
import {
  bookOrderBodySummary,
  buildBookOrderVars,
  nextBookOrderRef,
  parseBookOrderRefSeq,
} from "@/lib/book-order-message";
import { getBookOrderConfig } from "./founder-config";
import { logActivity, diffFields } from "./activity-log";
import { isKnownLevel, levelLabels } from "./levels";
import { sendWhatsApp } from "./whatsapp";
import type { ActionResult } from "./finance-actions";

/**
 * Book orders with the publisher (spec §9.2, Part 2 §4):
 *   token advance → confirm the level → vendor quotation → pay → courier.
 *
 * Per LEVEL, not per contract - the founders re-quote before each level rather than ordering
 * a 3-level set up front (§19.3: "A1 first, fresh quote for A2").
 */

// A book order is for a single level (never a bundle) - validated against the live catalogue.
const BOOK_ORDER_LEVEL_KINDS = ["GERMAN_LEVEL", "COACHING_TIER", "OTHER"] as const;
const STATUSES = ["DEFERRED", "QUOTE_REQUESTED", "QUOTED", "ORDERED", "PAID", "COURIERED", "CANCELLED"] as const;

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

/** Rupees in the form → paise in the DB. The founder types 15000, we store 1500000. */
const rupeesToPaise = (v: string | undefined): bigint | null => {
  if (!v || !v.trim()) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.round(n * 100));
};

// ── Vendors ────────────────────────────────────────────────────

const vendorSchema = z.object({
  name: z.string().trim().min(1, "Vendor name is required").max(160),
  phone: z.string().trim().max(32).optional(),
  email: z.string().trim().max(254).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export async function upsertVendor(vendorId: string | null, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = vendorSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  const data = {
    name: d.name,
    phone: d.phone || null,
    email: d.email || null,
    address: d.address || null,
    notes: d.notes || null,
  };
  const vendor = vendorId
    ? await prisma.vendor.update({ where: { id: vendorId }, data })
    : await prisma.vendor.create({ data });
  await logActivity(session, {
    action: vendorId ? "vendor.update" : "vendor.create",
    section: "students",
    entityType: "Vendor",
    entityId: vendor.id,
    summary: `${vendorId ? "Updated" : "Added"} the book vendor "${vendor.name}"`,
    meta: {},
  });
  revalidatePath("/students");
  return { ok: true };
}

// ── Orders ─────────────────────────────────────────────────────

const orderSchema = z.object({
  studentId: z.string().trim().min(1, "Pick a student"),
  level: z.string().trim().min(1, "Pick a level"), // validated vs the live catalogue in the action
  vendorId: z.string().trim().optional(),
  notes: z.string().trim().max(2000).optional(),
});

/**
 * Open a book order for a level, letting the payment history decide whether it ships now.
 *
 * The trigger reads CASH ACTUALLY COLLECTED, not the sale price and not "is on EMI" - an EMI
 * student who has genuinely paid past the threshold has earned their books, and keying off
 * the plan rather than the payments would strand exactly the customer who has been paying
 * reliably. Cash is summed from Income, the same source commission and P&L use, so the three
 * can never disagree about what a student paid.
 */
export async function createBookOrder(form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = orderSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;
  if (!(await isKnownLevel(d.level, [...BOOK_ORDER_LEVEL_KINDS]))) return { ok: false, error: "Pick a valid level for the order" };

  const student = await prisma.student.findUnique({
    where: { id: d.studentId },
    select: { fullName: true, address: true, phone: true },
  });
  if (!student) return { ok: false, error: "Student not found" };

  const paid = await prisma.income.aggregate({
    where: { studentId: d.studentId },
    _sum: { amountInrMinor: true },
  });
  const config = await getBookOrderConfig();
  const decision = decideBookOrder(Number(paid._sum.amountInrMinor ?? 0), config);
  const status = initialBookOrderStatus(decision);

  try {
    const order = await prisma.bookOrder.create({
      data: {
        studentId: d.studentId,
        level: d.level,
        vendorId: d.vendorId || null,
        status,
        // Snapshot the ship-to: the books go where they lived when we ordered, and a later
        // address edit must not silently rewrite where a past parcel went.
        shipToAddress: student.address,
        shipToPhone: student.phone,
        deferReason: decision.order ? null : decision.explain,
        notes: d.notes || null,
      },
    });
    await logActivity(session, {
      action: "book-order.create",
      section: "students",
      entityType: "BookOrder",
      entityId: order.id,
      summary: `Opened a ${d.level} book order for ${student.fullName} - ${status === "DEFERRED" ? "deferred" : "ready to quote"}`,
      meta: { level: d.level, status, reason: decision.reason, shortfallInrMinor: decision.shortfallInrMinor },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: `${student.fullName} already has a ${d.level} book order` };
    }
    throw e;
  }
  revalidatePath("/students");
  return { ok: true };
}

const advanceSchema = z.object({
  status: z.enum(STATUSES),
  quotedAmount: z.string().trim().max(16).optional(),
  paidAmount: z.string().trim().max(16).optional(),
  courierRef: z.string().trim().max(160).optional(),
  vendorId: z.string().trim().optional(),
});

/**
 * Move an order along the publisher flow and stamp the matching timestamp.
 *
 * The stamps are set from the status rather than kept as separate form fields so the timeline
 * can't be back-dated by hand into a story that never happened.
 */
export async function advanceBookOrder(orderId: string, form: FormData): Promise<ActionResult> {
  const session = await requireAdmin();
  const parsed = advanceSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const d = parsed.data;

  const before = await prisma.bookOrder.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      quotedAmountInrMinor: true,
      paidAmountInrMinor: true,
      courierRef: true,
      student: { select: { fullName: true } },
      level: true,
    },
  });
  if (!before) return { ok: false, error: "Order not found" };

  const now = new Date();
  const quoted = rupeesToPaise(d.quotedAmount);
  const paid = rupeesToPaise(d.paidAmount);

  // A courier reference without a parcel is a data-entry slip worth catching early.
  if (d.status === "COURIERED" && !d.courierRef?.trim() && !before.courierRef) {
    return { ok: false, error: "Add the courier reference before marking it couriered" };
  }
  if (d.status === "QUOTED" && quoted === null && before.quotedAmountInrMinor === null) {
    return { ok: false, error: "Enter the quoted amount to mark it quoted" };
  }

  const order = await prisma.bookOrder.update({
    where: { id: orderId },
    data: {
      status: d.status,
      vendorId: d.vendorId || undefined,
      quotedAmountInrMinor: quoted ?? undefined,
      paidAmountInrMinor: paid ?? undefined,
      courierRef: d.courierRef || undefined,
      quotedAt: d.status === "QUOTED" ? now : undefined,
      orderedAt: d.status === "ORDERED" ? now : undefined,
      paidAt: d.status === "PAID" ? now : undefined,
      courieredAt: d.status === "COURIERED" ? now : undefined,
      // Leaving DEFERRED clears the hold note - it would otherwise linger and misread.
      deferReason: d.status === "DEFERRED" ? undefined : null,
    },
  });

  const diff = diffFields(
    { status: before.status, quotedAmountInrMinor: before.quotedAmountInrMinor, paidAmountInrMinor: before.paidAmountInrMinor },
    { status: order.status, quotedAmountInrMinor: order.quotedAmountInrMinor, paidAmountInrMinor: order.paidAmountInrMinor },
  );
  if (diff.changed.length > 0) {
    await logActivity(session, {
      action: "book-order.update",
      section: "students",
      entityType: "BookOrder",
      entityId: orderId,
      summary: `Moved ${before.student.fullName}'s ${before.level} book order to ${d.status.toLowerCase().replace("_", " ")}`,
      meta: { changed: diff.changed, before: diff.before, after: diff.after },
    });
  }
  revalidatePath("/students");
  return { ok: true };
}

// ── Messaging the publisher ────────────────────────────────────

/**
 * Give this order its human-quotable reference, allocating one only if it doesn't have it yet.
 *
 * Lazy on purpose: a number is spent when we actually tell a publisher about the order, so an
 * order that is opened and cancelled never burns one and the sequence stays readable.
 *
 * The retry exists because two admins pressing the button at the same second would both read the
 * same maximum. The UNIQUE index is what actually prevents the collision; this just turns the
 * resulting 23505 into a second attempt rather than an error the user sees.
 */
async function ensureOrderRef(orderId: string, current: string | null): Promise<string> {
  if (current) return current;
  const year = Number(
    new Intl.DateTimeFormat("en-GB", { year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()),
  );

  for (let attempt = 0; attempt < 5; attempt++) {
    // Only this year's refs matter to the allocator, but the column holds every year - filtering
    // in SQL keeps the read small as the table grows.
    const rows = await prisma.bookOrder.findMany({
      where: { orderRef: { startsWith: `BO-${year}-` } },
      select: { orderRef: true },
    });
    const ref = nextBookOrderRef(
      rows.map((r) => r.orderRef).filter((r): r is string => r !== null && parseBookOrderRefSeq(r, year) !== null),
      year,
    );
    try {
      await prisma.bookOrder.update({ where: { id: orderId }, data: { orderRef: ref } });
      return ref;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") continue;
      throw e;
    }
  }
  throw new Error("Could not allocate a book-order reference");
}

/**
 * Send the approved `b2_book_order` template to the publisher.
 *
 * MANUAL, not automatic, and deliberately so: this message commits B2 to buying books. Firing it
 * off a status change would mean a mis-click on a dropdown places a real order with a supplier.
 * A human presses this.
 *
 * The recipient is the VENDOR's number. Every other WhatsApp touchpoint in the app sends to the
 * person the record is about, so this is the one place that inversion has to be got right - see
 * lib/book-order-message.ts.
 */
export async function messagePublisher(orderId: string, opts?: { dryRun?: boolean }): Promise<ActionResult> {
  const session = await requireAdmin();

  const order = await prisma.bookOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      orderRef: true,
      level: true,
      status: true,
      shipToAddress: true,
      shipToPhone: true,
      studentId: true,
      student: { select: { fullName: true } },
      vendor: { select: { name: true, phone: true } },
    },
  });
  if (!order) return { ok: false, error: "Order not found" };
  if (!order.vendor) return { ok: false, error: "Set the vendor on this order before messaging them" };
  if (!order.vendor.phone?.trim()) {
    return { ok: false, error: `${order.vendor.name} has no phone number - add one on the vendor record` };
  }

  const labels = await levelLabels();
  // Allocated BEFORE the variable check so `order_ref` is never the thing reported missing -
  // it is ours to produce, not something the user could go and fill in.
  const orderRef = await ensureOrderRef(order.id, order.orderRef);

  const built = buildBookOrderVars({
    publisherName: order.vendor.name,
    orderRef,
    levelLabel: labels[order.level] ?? order.level,
    studentName: order.student.fullName,
    shipTo: order.shipToAddress,
    shipPhone: order.shipToPhone,
  });
  if (!built.ok) return { ok: false, error: built.message };

  const outcome = await sendWhatsApp({
    kind: "BOOK_ORDER",
    to: order.vendor.phone,
    vars: built.vars,
    sentById: session.user.id,
    bodySummary: bookOrderBodySummary(built.vars),
    // Both links: the order is what it's about, the student is who it's for. Without `studentId`
    // the message would be invisible on the student's record, where anyone asking "where are
    // Priya's books" will look first.
    bookOrderId: order.id,
    studentId: order.studentId,
    dryRun: opts?.dryRun ?? false,
  });

  await logActivity(session, {
    action: "book-order.message-publisher",
    section: "students",
    entityType: "BookOrder",
    entityId: order.id,
    summary: outcome.sent
      ? `Sent ${order.vendor.name} the ${orderRef} book order for ${order.student.fullName}`
      : `Book order message to ${order.vendor.name} was not sent - ${outcome.error ?? "skipped"}`,
    meta: { orderRef, status: outcome.status, level: order.level, dryRun: opts?.dryRun ?? false },
  });

  revalidatePath("/students");
  // A skip is a real outcome the user must see: the row is written either way, but silently
  // returning ok would read as "the publisher has been told" when nothing left the building.
  if (!outcome.sent) return { ok: false, error: outcome.error ?? "The message was not sent" };
  return { ok: true };
}

/**
 * Re-evaluate every deferred order against the current cash collected.
 *
 * This is what makes DEFERRED self-clearing: an EMI student crossing the threshold on their
 * third instalment should not depend on someone remembering to check. Intended for the same
 * cron tick that runs the other engines.
 */
export async function releaseDeferredBookOrders(): Promise<{ released: number; checked: number }> {
  const config = await getBookOrderConfig();
  const deferred = await prisma.bookOrder.findMany({
    where: { status: "DEFERRED" },
    select: { id: true, studentId: true },
  });
  let released = 0;
  for (const order of deferred) {
    const paid = await prisma.income.aggregate({
      where: { studentId: order.studentId },
      _sum: { amountInrMinor: true },
    });
    const decision = decideBookOrder(Number(paid._sum.amountInrMinor ?? 0), config);
    if (!decision.order) continue;
    await prisma.bookOrder.update({
      where: { id: order.id },
      data: { status: "QUOTE_REQUESTED", deferReason: null },
    });
    released++;
  }
  return { released, checked: deferred.length };
}
