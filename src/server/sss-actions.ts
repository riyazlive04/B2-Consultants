"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSection, requireAdmin } from "@/lib/rbac";
import { sssConfigSchema } from "@/lib/config-schema";
import { parseDateInput } from "@/lib/dates";
import { formatDate, formatDateTimeInZone } from "@/lib/format";
import { writeSssConfig, getSssConfig, SSS_CONFIG_KEY } from "./founder-config";
import { logActivity, diffFields } from "./activity-log";
import {
  generateSssSlots,
  blockSssSlot,
  unblockSssSlot,
  blockSssDay,
  moveJourneyToSlot,
  bookJourneyIntoSlot,
  deleteSssSlot,
} from "./sss-slots";

/**
 * SSS calendar server actions. Slot management is gated on the `bookings` section (the same
 * operational area as discovery availability); changing the SSS owner/config is Admin-only. Every
 * action re-checks — a page guard doesn't protect a server action — and revalidates /bookings.
 */

export type Result = { ok: true; message?: string } | { ok: false; error: string };

function firstError(e: z.ZodError): string {
  return e.issues[0]?.message ?? "Invalid input";
}

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date");
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Bad time");

/** Whose calendar, when, and who is in it — the three things a slot summary needs to read. */
function slotContext(slotId: string) {
  return prisma.sssSlot.findUnique({
    where: { id: slotId },
    select: {
      status: true,
      startsAt: true,
      owner: { select: { name: true } },
      journey: { select: { lead: { select: { name: true } } } },
    },
  });
}

function slotWhen(startsAt: Date): string {
  return `${formatDateTimeInZone(startsAt, "Asia/Kolkata")} IST`;
}

function ownerName(id: string) {
  return prisma.user.findUnique({ where: { id }, select: { name: true } });
}

const generateSchema = z.object({
  ownerId: z.string().min(1, "Pick who runs the SSS first"),
  dates: z.array(DAY).min(1, "Pick at least one day").max(120),
  times: z.array(TIME).min(1, "Pick at least one time").max(48),
  durationMins: z.number().int().min(5).max(240),
});

export async function generateSssSlotsAction(input: unknown): Promise<Result> {
  const session = await requireSection("bookings");
  const parsed = generateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { created } = await generateSssSlots(parsed.data);

  if (created) {
    const owner = await ownerName(parsed.data.ownerId);
    await logActivity(session, {
      action: "sss.slots.create",
      section: "bookings",
      entityType: "User",
      entityId: parsed.data.ownerId,
      summary: `Added ${created} SSS slot${created === 1 ? "" : "s"} to ${owner?.name ?? "the SSS owner"}'s calendar`,
      meta: {
        created,
        durationMins: parsed.data.durationMins,
        dates: parsed.data.dates,
        times: parsed.data.times,
      },
    });
  }

  revalidatePath("/bookings");
  return { ok: true, message: created ? `Added ${created} slot${created === 1 ? "" : "s"}` : "No new slots (all already existed)" };
}

export async function setSssOwnerAction(input: unknown): Promise<Result> {
  const session = await requireAdmin();
  const parsed = sssConfigSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const current = await getSssConfig();
  await writeSssConfig(parsed.data);

  const diff = diffFields(current, parsed.data);
  if (diff.changed.length) {
    const owner = parsed.data.ownerId ? await ownerName(parsed.data.ownerId) : null;
    await logActivity(session, {
      action: "sss.config.update",
      section: "bookings",
      entityType: "AppSetting",
      entityId: SSS_CONFIG_KEY,
      summary: `Changed the SSS calendar settings — owner ${owner?.name ?? "unset"}, ${parsed.data.slotDurationMins} min slots, reschedule within ${parsed.data.rescheduleWithinDays} days`,
      meta: diff,
    });
  }

  revalidatePath("/bookings");
  revalidatePath("/console");
  return { ok: true };
}

export async function blockSssSlotAction(slotId: string): Promise<Result> {
  const session = await requireSection("bookings");
  // Read first: blocking detaches or relocates whoever was in the slot, so afterwards there is no
  // way back to the prospect's name — and an already-blocked slot is a no-op worth not logging.
  const ctx = await slotContext(slotId);
  const res = await blockSssSlot(slotId, session.user.id);

  if (res.ok && ctx && ctx.status !== "BLOCKED") {
    const who = ctx.journey?.lead.name ?? "the prospect";
    const detail = res.moved
      ? ` — ${who} moved to the next open slot`
      : res.orphaned
        ? ` — ${who} needs manual rebooking`
        : "";
    await logActivity(session, {
      action: "sss.slot.block",
      section: "bookings",
      entityType: "SssSlot",
      entityId: slotId,
      summary: `Blocked the ${slotWhen(ctx.startsAt)} SSS slot${ctx.owner ? ` on ${ctx.owner.name}'s calendar` : ""}${detail}`,
      meta: { moved: res.moved, orphaned: res.orphaned, movedTo: res.movedTo ?? null },
    });
  }

  revalidatePath("/bookings");
  if (!res.ok) return res;
  const msg = res.moved
    ? "Slot blocked — the prospect was moved to the next open slot"
    : res.orphaned
      ? "Slot blocked — no open slot in range, prospect flagged for manual rebooking"
      : "Slot blocked";
  return { ok: true, message: msg };
}

export async function unblockSssSlotAction(slotId: string): Promise<Result> {
  const session = await requireSection("bookings");
  const res = await unblockSssSlot(slotId);

  if (res.ok) {
    const ctx = await slotContext(slotId);
    await logActivity(session, {
      action: "sss.slot.unblock",
      section: "bookings",
      entityType: "SssSlot",
      entityId: slotId,
      summary: ctx
        ? `Unblocked the ${slotWhen(ctx.startsAt)} SSS slot${ctx.owner ? ` on ${ctx.owner.name}'s calendar` : ""}`
        : "Unblocked an SSS slot",
    });
  }

  revalidatePath("/bookings");
  return res;
}

export async function blockSssDayAction(ownerId: string, dayKey: string): Promise<Result> {
  const session = await requireSection("bookings");
  if (!ownerId) return { ok: false, error: "No owner for this day" };
  const res = await blockSssDay(ownerId, dayKey, session.user.id);

  if (res.ok && res.blocked) {
    const owner = await ownerName(ownerId);
    const moved = res.moved ? `, ${res.moved} moved` : "";
    const orphaned = res.orphaned ? `, ${res.orphaned} needing manual rebooking` : "";
    await logActivity(session, {
      action: "sss.day.block",
      section: "bookings",
      entityType: "User",
      entityId: ownerId,
      summary: `Blocked ${owner?.name ?? "the SSS owner"}'s SSS day on ${formatDate(parseDateInput(dayKey))} — ${res.blocked} slot${res.blocked === 1 ? "" : "s"}${moved}${orphaned}`,
      meta: { dayKey, blocked: res.blocked, moved: res.moved, orphaned: res.orphaned },
    });
  }

  revalidatePath("/bookings");
  if (!res.ok) return res;
  const parts = [`${res.blocked} blocked`];
  if (res.moved) parts.push(`${res.moved} moved`);
  if (res.orphaned) parts.push(`${res.orphaned} need manual rebooking`);
  return { ok: true, message: parts.join(" · ") };
}

export async function moveJourneyToSlotAction(journeyId: string, toSlotId: string): Promise<Result> {
  const session = await requireSection("bookings");
  const res = await moveJourneyToSlot(journeyId, toSlotId, session.user.id);

  if (res.ok) {
    // The prospect now sits in the target slot, so one read after the move covers both names.
    const ctx = await slotContext(toSlotId);
    await logActivity(session, {
      action: "sss.slot.reschedule",
      section: "bookings",
      entityType: "SssSlot",
      entityId: toSlotId,
      summary: `Moved ${ctx?.journey?.lead.name ?? "a prospect"} to the ${ctx ? slotWhen(ctx.startsAt) : "new"} SSS slot — new time sent`,
      meta: { journeyId, toSlotId },
    });
  }

  revalidatePath("/bookings");
  if (!res.ok) return res;
  return { ok: true, message: "Prospect moved — new time sent" };
}

export async function bookJourneyIntoSlotAction(journeyId: string, slotId: string): Promise<Result> {
  const session = await requireSection("bookings");
  const res = await bookJourneyIntoSlot(journeyId, slotId);

  if (res.ok) {
    const ctx = await slotContext(slotId);
    await logActivity(session, {
      action: "sss.slot.assign",
      section: "bookings",
      entityType: "SssSlot",
      entityId: slotId,
      summary: `Booked ${ctx?.journey?.lead.name ?? "a prospect"} into the ${ctx ? slotWhen(ctx.startsAt) : ""} SSS slot${ctx?.owner ? ` with ${ctx.owner.name}` : ""}`,
      meta: { journeyId, slotId },
    });
  }

  revalidatePath("/bookings");
  if (!res.ok) return res;
  return { ok: true, message: "Booked into the slot" };
}

export async function deleteSssSlotAction(slotId: string): Promise<Result> {
  const session = await requireSection("bookings");
  const ctx = await slotContext(slotId); // the row is gone once the delete lands
  const res = await deleteSssSlot(slotId);

  if (res.ok) {
    await logActivity(session, {
      action: "sss.slot.delete",
      section: "bookings",
      entityType: "SssSlot",
      entityId: slotId,
      summary: ctx
        ? `Deleted the ${slotWhen(ctx.startsAt)} SSS slot${ctx.owner ? ` on ${ctx.owner.name}'s calendar` : ""}`
        : "Deleted an SSS slot",
    });
  }

  revalidatePath("/bookings");
  return res;
}
