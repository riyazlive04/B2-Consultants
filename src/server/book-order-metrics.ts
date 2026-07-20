import "server-only";
import { cache } from "react";
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
  quotedRupees: number | null;
  paidRupees: number | null;
  shipToAddress: string | null;
  courierRef: string | null;
  deferReason: string | null;
  /** Total cash this student has paid — the variable the trigger actually reads. */
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
        quotedAmountInrMinor: true,
        paidAmountInrMinor: true,
        shipToAddress: true,
        courierRef: true,
        deferReason: true,
        createdAt: true,
        student: { select: { fullName: true } },
        vendor: { select: { name: true } },
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
    return {
      id: o.id,
      studentId: o.studentId,
      studentName: o.student.fullName,
      level: o.level,
      status: o.status,
      vendorId: o.vendorId,
      vendorName: o.vendor?.name ?? null,
      quotedRupees: toRupees(o.quotedAmountInrMinor),
      paidRupees: toRupees(o.paidAmountInrMinor),
      shipToAddress: o.shipToAddress,
      courierRef: o.courierRef,
      deferReason: o.deferReason,
      cashCollectedRupees: Math.round(cash / 100),
      // Surfaced so a deferred order that has quietly become payable is visible even if the
      // release job hasn't run — the panel should never be the last to know.
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
