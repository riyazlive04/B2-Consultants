"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CAPABILITIES, type CapabilityKey } from "@/lib/capabilities";
import { setUserCapability } from "@/server/users-actions";
import { toast } from "@/components/ui/feedback";
import { Card, Hint, Toggle } from "./kit";

/**
 * Console → Per-person rules.
 *
 * ── Why this screen exists ──────────────────────────────────────────────────────
 * Commission rates were global-only - four percentages that applied to everyone - so
 * "Nilofer is first-call only" was an arrangement between people and nowhere in the system. It
 * held only because she happened not to run discovery calls; the report would have paid her for
 * one the moment she covered a slot.
 *
 * The per-user override mechanism already existed (`User.capabilities`), but it was reachable
 * only one person at a time, through a dialog inside People → Users & access. Setting up a team
 * meant opening four dialogs and remembering what you had set in the previous three. This is the
 * same data as a grid, which is the shape the question actually has: person × permission.
 *
 * ── What a toggle here means ────────────────────────────────────────────────────
 * An override, not the whole truth. Missing = the person's ROLE default applies, which is why a
 * fresh install behaves exactly as before. Admins hold everything and cannot lose it, so their
 * rows are locked - the founder can never lock themselves out of their own business.
 */

/** The keys worth setting per person. The rest are role-shaped and belong in the access dialog. */
const PER_PERSON_GROUPS: { title: string; blurb: string; keys: CapabilityKey[] }[] = [
  {
    title: "Commission eligibility",
    blurb:
      "Which legs of a deal split this person earns. Turning one off does NOT hide their work - the payout report still shows they ran the call, marked “not eligible” at zero, so nothing disappears silently.",
    keys: ["commission.firstCall", "commission.discovery", "commission.closer"],
  },
  {
    title: "Sales & pipeline",
    blurb: "What they may change beyond their own records.",
    keys: ["pipeline.configure", "outreach.qualify", "qualification.manage"],
  },
  {
    title: "Money & delivery",
    blurb: "Privileged writes. Grant deliberately.",
    keys: ["finance.write", "rewards.approve", "agreements.issue", "batches.manage", "germanNote.finance"],
  },
];

export type PersonRow = {
  id: string;
  name: string;
  role: string;
  /** Resolved: role default merged with this person's overrides. */
  held: Record<string, boolean>;
};

export function PerPersonPanel({ people }: { people: PersonRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const toggle = async (userId: string, key: CapabilityKey, next: boolean) => {
    const cell = `${userId}:${key}`;
    setBusy(cell);
    const res = await setUserCapability(userId, key, next);
    setBusy(null);
    if (!res.ok) return toast(res.error, "error");
    toast(next ? "Granted" : "Removed");
    router.refresh();
  };

  if (people.length === 0) {
    return (
      <Card>
        <p className="text-sm text-muted">No active team members with a login yet.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <Hint>
        Per-person overrides. A switch here beats the role default; leave it as the role default
        and nothing changes. <strong>Admins hold everything</strong> and are shown locked - the
        founder can never remove their own access.
      </Hint>

      {PER_PERSON_GROUPS.map((group) => (
        <Card key={group.title} title={group.title} subtitle={group.blurb}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  <th className="py-2 pr-3 font-semibold text-ink-2">Person</th>
                  {group.keys.map((key) => {
                    const def = CAPABILITIES.find((c) => c.key === key);
                    return (
                      <th key={key} className="px-3 py-2 text-center font-semibold text-ink-2" title={def?.description}>
                        {def?.name ?? key}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => {
                  const isAdmin = p.role === "ADMIN";
                  return (
                    <tr key={p.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 pr-3">
                        <span className="font-medium text-ink">{p.name}</span>
                        <span className="ml-2 text-caption text-ink-3">{p.role}</span>
                      </td>
                      {group.keys.map((key) => (
                        <td key={key} className="px-3 py-2.5 text-center">
                          <span className="inline-flex justify-center">
                            <Toggle
                              hideLabel
                              label={`${p.name} - ${CAPABILITIES.find((c) => c.key === key)?.name ?? key}`}
                              checked={isAdmin || Boolean(p.held[key])}
                              disabled={isAdmin || busy === `${p.id}:${key}`}
                              title={isAdmin ? "Admins always hold every capability" : undefined}
                              onChange={(next) => toggle(p.id, key, next)}
                            />
                          </span>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
