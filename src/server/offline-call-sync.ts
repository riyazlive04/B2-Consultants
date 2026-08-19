"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSection } from "@/lib/rbac";
import { clampCalledAt } from "@/lib/offline-calls";
import { resolveStageAfterCall } from "@/lib/call-outcome";
import { logActivity } from "./activity-log";
import { syncDefaultOpportunity } from "./opportunity-sync";

/**
 * Flush a device's offline call queue.
 *
 * The counterpart to `call-log-actions.logCall`, which handles the online path. This one
 * exists separately rather than as a flag on that action because the trust model is genuinely
 * different: here `calledAt` arrives from a client and has to be clamped, marked and audited,
 * and folding two different trust levels into one code path is how the marking gets forgotten.
 *
 * IDEMPOTENT BY CONSTRUCTION. `clientKey` carries a UNIQUE index, and a collision is caught
 * and reported as success - not as an error. That matters because the common failure is a
 * half-open mobile connection where the write LANDS and the response never arrives: the device
 * retries the same key, and the only correct answer is "yes, that one is saved" rather than a
 * second row inflating the call counts people are reviewed on.
 *
 * Per-entry isolation: one bad row (a lead deleted while the phone was offline) must not
 * discard the rest of the queue, so each is committed on its own and reported individually.
 */

const CALL_OUTCOMES = [
  "SPOKE", "NO_ANSWER", "BUSY", "CALLBACK", "WRONG_NUMBER", "NOT_INTERESTED",
] as const;

const entrySchema = z.object({
  clientKey: z.string().min(8).max(64),
  leadId: z.string().min(1),
  outcome: z.enum(CALL_OUTCOMES),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  // Permissive here, validated by `resolveStageAfterCall` - an unrecognised stage must leave
  // the card alone, never reject the whole entry. A rejected entry is a call the telecaller
  // has already moved on from and can no longer recover, which is the trade this module
  // explicitly refuses to make. Optional so entries queued before this field existed still sync.
  nextStage: z.string().trim().max(40).optional().or(z.literal("")),
  recordedAt: z.string().datetime(),
});

// A phone that has been offline for days still only holds a shift's worth of calls; a payload
// larger than this is a bug or an abuse, not a telecaller's morning.
const MAX_BATCH = 200;

const payloadSchema = z.object({ entries: z.array(entrySchema).max(MAX_BATCH) });

export type SyncedEntry = { clientKey: string; status: "saved" | "duplicate" | "rejected"; error?: string };
export type SyncResult = { ok: true; results: SyncedEntry[] } | { ok: false; error: string };

export async function syncOfflineCalls(payloadJson: string): Promise<SyncResult> {
  const session = await requireSection("pipeline");

  let parsed;
  try {
    parsed = payloadSchema.safeParse(JSON.parse(payloadJson));
  } catch {
    return { ok: false, error: "Could not read the queued calls" };
  }
  if (!parsed.success) return { ok: false, error: "Queued calls were not in the expected shape" };

  const results: SyncedEntry[] = [];

  for (const e of parsed.data.entries) {
    // The server's own clock, read per entry - this is both the `syncedAt` stamp and the
    // reference the device's claim is clamped against.
    const receivedAt = new Date();
    const { calledAt, claimed, adjusted } = clampCalledAt(new Date(e.recordedAt), receivedAt);

    const lead = await prisma.lead.findUnique({
      where: { id: e.leadId },
      select: { id: true, name: true, stage: true },
    });
    if (!lead) {
      // Terminal, not transient: retrying will never make a deleted lead exist.
      results.push({ clientKey: e.clientKey, status: "rejected", error: "That lead no longer exists" });
      continue;
    }

    const nextStage = resolveStageAfterCall(lead.stage, e.outcome, e.nextStage);

    try {
      await prisma.$transaction(async (tx) => {
        await tx.callLog.create({
          data: {
            leadId: e.leadId,
            userId: session.user.id,
            outcome: e.outcome,
            notes: e.notes || null,
            calledAt,
            clientKey: e.clientKey,
            // Non-null is the marker: this row did not arrive live, and `calledAt` came
            // from a device rather than from us.
            syncedAt: receivedAt,
          },
        });

        // Same first-contact rule as the online path - only the FIRST connection counts, so a
        // late-synced call can't reset speed-to-lead and flatter the metric.
        if (e.outcome === "SPOKE") {
          await tx.lead.updateMany({
            where: { id: e.leadId, contactedAt: null },
            data: { contactedAt: calledAt },
          });
        }

        if (nextStage && nextStage !== lead.stage) {
          await tx.lead.update({ where: { id: e.leadId }, data: { stage: nextStage } });
          await tx.leadStageHistory.create({
            data: { leadId: e.leadId, fromStage: lead.stage, toStage: nextStage, changedById: session.user.id },
          });
          await syncDefaultOpportunity(tx, e.leadId, nextStage);
        }
      });
    } catch (err) {
      // P2002 = unique violation on clientKey. The device already got this one in; the
      // response just never made it back. Reporting success is what lets it clear its queue.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        results.push({ clientKey: e.clientKey, status: "duplicate" });
        continue;
      }
      results.push({ clientKey: e.clientKey, status: "rejected", error: "Could not save this call" });
      continue;
    }

    await logActivity(session, {
      action: "call.log.offline",
      section: "pipeline",
      entityType: "CallLog",
      entityId: e.clientKey,
      summary:
        `Synced an offline call with ${lead.name}` +
        `${adjusted ? ` - device time was ${adjusted === "future" ? "in the future" : "implausibly old"} and was adjusted` : ""}`,
      // The claim is recorded even when it was accepted, so a later dispute has both numbers.
      meta: {
        outcome: e.outcome,
        leadId: e.leadId,
        claimedAt: claimed.toISOString(),
        storedAt: calledAt.toISOString(),
        adjusted,
      },
    });

    results.push({ clientKey: e.clientKey, status: "saved" });
  }

  if (results.some((r) => r.status === "saved")) {
    revalidatePath("/my-desk");
    revalidatePath("/pipeline");
  }
  return { ok: true, results };
}
