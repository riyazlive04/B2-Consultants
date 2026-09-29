import "server-only";
import { cache } from "react";
import type { WhatsAppStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { decideBookOrder } from "@/lib/book-order";
import { ACTIVE } from "@/lib/soft-delete";
import { getBookOrderConfig } from "./founder-config";

/**
 * Reads for the Book Orders panel (spec §9.2, Part 2 §4).
 */

export type BookOrderRow = {
  id: string;
  studentId: string;
  studentName: string;
  level: string;
  status: string;
  vendorId: string | null;
  vendorName: string | null;
  /** Null until the publisher is first messaged - the reference is allocated lazily. */
  orderRef: string | null;
  /** Whether we can message this vendor at all; drives the button's disabled state. */
  vendorPhone: string | null;
  quotedRupees: number | null;
  paidRupees: number | null;
  shipToAddress: string | null;
  /** Snapshotted at order time. Shown because a missing one blocks the publisher message. */
  shipToPhone: string | null;
  courierRef: string | null;
  deferReason: string | null;
  /** When the publisher was last told about this order, and whether it actually went out. */
  publisherMessagedAt: string | null;
  publisherMessageSent: boolean;
  /** Total cash this student has paid - the variable the trigger actually reads. */
  cashCollectedRupees: number;
  /** True when a DEFERRED order has since met the threshold and is just waiting on a human. */
  readyToRelease: boolean;
  shortfallRupees: number;
  createdAt: string;
};

export type VendorRow = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  orderCount: number;
};

export type StudentOption = { id: string; fullName: string };

const toRupees = (v: bigint | null) => (v === null ? null : Math.round(Number(v) / 100));

/**
 * Statuses that mean the message genuinely reached WATI. SKIPPED and FAILED write a row too, and
 * QUEUED has not been accepted yet - treating any of those as "the publisher has been told" is
 * how an unplaced order gets marked as placed.
 */
const LEFT_THE_BUILDING = new Set<WhatsAppStatus>(["SENT", "DELIVERED", "READ", "REPLIED"]);

export const getBookOrderData = cache(async () => {
  const [orders, vendors, config] = await Promise.all([
    prisma.bookOrder.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: {
        id: true,
        studentId: true,
        level: true,
        status: true,
        vendorId: true,
        orderRef: true,
        quotedAmountInrMinor: true,
        paidAmountInrMinor: true,
        shipToAddress: true,
        shipToPhone: true,
        courierRef: true,
        deferReason: true,
        createdAt: true,
        student: { select: { fullName: true } },
        vendor: { select: { name: true, phone: true } },
        // Just the latest publisher message. Bounded to 1 per order so listing every order
        // cannot turn into an unbounded read of the message log.
        messages: {
          where: { kind: "BOOK_ORDER" },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true, status: true },
        },
      },
    }),
    prisma.vendor.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, email: true, _count: { select: { orders: true } } },
    }),
    getBookOrderConfig(),
  ]);

  // One grouped query rather than a per-order aggregate: this panel lists every order, and
  // N round-trips for the same sum is the easiest accidental N+1 to write here.
  const studentIds = Array.from(new Set(orders.map((o) => o.studentId)));
  const sums = studentIds.length
    ? await prisma.income.groupBy({
        by: ["studentId"],
        where: { ...ACTIVE, studentId: { in: studentIds } },
        _sum: { amountInrMinor: true },
      })
    : [];
  const paidByStudent = new Map(sums.map((s) => [s.studentId, Number(s._sum.amountInrMinor ?? 0)]));

  const rows: BookOrderRow[] = orders.map((o) => {
    const cash = paidByStudent.get(o.studentId) ?? 0;
    const decision = decideBookOrder(cash, config);
    const lastMessage = o.messages[0] ?? null;
    return {
      id: o.id,
      studentId: o.studentId,
      studentName: o.student.fullName,
      level: o.level,
      status: o.status,
      vendorId: o.vendorId,
      vendorName: o.vendor?.name ?? null,
      orderRef: o.orderRef,
      vendorPhone: o.vendor?.phone ?? null,
      quotedRupees: toRupees(o.quotedAmountInrMinor),
      paidRupees: toRupees(o.paidAmountInrMinor),
      shipToAddress: o.shipToAddress,
      shipToPhone: o.shipToPhone,
      courierRef: o.courierRef,
      deferReason: o.deferReason,
      publisherMessagedAt: lastMessage?.createdAt.toISOString() ?? null,
      // A SKIPPED/FAILED attempt still writes a row, so "we messaged them" must read the status
      // rather than the mere existence of a message - otherwise a blocked send looks like a
      // placed order.
      publisherMessageSent: lastMessage !== null && LEFT_THE_BUILDING.has(lastMessage.status),
      cashCollectedRupees: Math.round(cash / 100),
      // Surfaced so a deferred order that has quietly become payable is visible even if the
      // release job hasn't run - the panel should never be the last to know.
      readyToRelease: o.status === "DEFERRED" && decision.order,
      shortfallRupees: Math.round(decision.shortfallInrMinor / 100),
      createdAt: o.createdAt.toISOString(),
    };
  });

  const vendorRows: VendorRow[] = vendors.map((v) => ({
    id: v.id,
    name: v.name,
    phone: v.phone,
    email: v.email,
    orderCount: v._count.orders,
  }));

  return { rows, vendors: vendorRows, thresholdRupees: Math.round(config.orderThresholdInrMinor / 100) };
});

/** Students offerable for a new order. */
export const getStudentOptions = cache(async (): Promise<StudentOption[]> =>
  prisma.student.findMany({ orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
);
