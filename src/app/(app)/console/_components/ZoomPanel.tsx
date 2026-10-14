"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleSlash, TriangleAlert } from "lucide-react";
import type { ZoomConfig } from "@/lib/config-schema";
import { toast } from "@/components/ui/feedback";
import { saveZoomConfig } from "@/server/console-actions";
import { safeAction } from "@/lib/action-guard";
import { Card, ColHead, ColRow, ColScroll, Hint, NameCell, SaveBar, TextIn } from "./kit";

/**
 * Which Zoom account hosts whose calls (Console → Sales ops → Availability).
 *
 * ── WHAT THE FOUNDER CHOOSES HERE, AND WHAT THEY CANNOT ───────────────────────────
 * The MAPPING only. Arming Zoom at all is `ZOOM_ENABLED` in the environment, and the three
 * credentials are secrets, so neither appears on this form - a web form that can start sending
 * on a live account is a web form that can do it by accident. The badge below just reports which
 * state the server is in.
 *
 * ── WHY A BLANK ROW IS FINE ───────────────────────────────────────────────────────
 * An unmapped person falls through to the default, and a blank default falls through to the Zoom
 * account owner. So the worst case is "every call runs from the owner's account", which still
 * produces a working link for every prospect - never a missing one. The cost is that two calls at
 * the same time would share one room, which is what the warning below is for.
 *
 * The emails cannot be validated against Zoom: the Server-to-Server app is deliberately granted
 * only the four meeting scopes, not `user:read`, so the app cannot list the account's users. A
 * typo therefore surfaces as a failed meeting creation on the next booking, not as an error here.
 */

const COLS = "1fr 1fr";

export type ZoomPanelPerson = { id: string; name: string };

export function ZoomPanel({
  config,
  people,
  runtime,
}: {
  config: ZoomConfig;
  people: ZoomPanelPerson[];
  /** Read from the server's env - reported, never editable here. */
  runtime: { enabled: boolean; configured: boolean; envEnabled: boolean };
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ZoomConfig>(config);
  const [saved, setSaved] = useState<ZoomConfig>(config);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);

  const emailFor = (userId: string) => draft.hosts.find((h) => h.userId === userId)?.email ?? "";

  const setEmail = (userId: string, email: string) =>
    setDraft((d) => {
      const rest = d.hosts.filter((h) => h.userId !== userId);
      // A cleared box REMOVES the mapping rather than storing "", which would otherwise fail the
      // schema's email check and block the whole save on a field the founder just emptied.
      return { ...d, hosts: email.trim() ? [...rest, { userId, email: email.trim() }] : rest };
    });

  /**
   * Two people resolving to one Zoom account means their calls share a room. Worth saying out
   * loud: it is the single most likely way this config goes subtly wrong, and the symptom (a
   * prospect dropped into someone else's live call) is the kind nobody reports politely.
   */
  const resolved = people.map((p) => emailFor(p.id).toLowerCase() || "(owner account)");
  const shared = resolved.filter((e, i) => resolved.indexOf(e) !== i);
  const sharesHost = people.length > 1 && shared.length > 0;

  async function save() {
    setBusy(true);
    setError(null);
    const res = await safeAction(() => saveZoomConfig(draft));
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setSaved(draft);
    toast("Zoom hosts saved");
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Hint>
        When a prospect books a call, the app creates the <strong>Zoom meeting</strong> for it and
        attaches the join link to the booking. Give each person the Zoom login email their calls
        should run from. Leave a row blank and their calls run from the Zoom{" "}
        <strong>account owner</strong> instead - which works, but means two calls at the same time
        would share one room.
      </Hint>

      <Card>
        <div className="flex items-start gap-2 text-xs">
          {runtime.enabled ? (
            <>
              <CircleCheck size={14} className="mt-px shrink-0 text-ok" aria-hidden />
              <p className="text-ink-2">
                <strong className="text-ink-1">Armed.</strong> New bookings get a Zoom link
                automatically, reschedules move the meeting, and cancellations delete it.
              </p>
            </>
          ) : runtime.envEnabled && !runtime.configured ? (
            <>
              <TriangleAlert size={14} className="mt-px shrink-0 text-warn" aria-hidden />
              <p className="text-ink-2">
                <strong className="text-ink-1">Misconfigured.</strong> <code>ZOOM_ENABLED</code> is
                on but the credentials are missing, so no meeting can be created.
              </p>
            </>
          ) : (
            <>
              <CircleSlash size={14} className="mt-px shrink-0 text-ink-3" aria-hidden />
              <p className="text-ink-2">
                <strong className="text-ink-1">Off.</strong> Set <code>ZOOM_ENABLED</code> and the
                three <code>ZOOM_*</code> credentials in the environment to arm it. Bookings work
                exactly as before meanwhile - they simply carry no meeting link.
              </p>
            </>
          )}
        </div>
      </Card>

      <Card>
        <ColScroll>
          <div className="space-y-1.5">
            <ColHead cols={COLS} labels={["Person", "Zoom login email"]} />
            {people.length === 0 ? (
              <p className="px-1 py-3 text-xs text-ink-3">
                Nobody takes bookings yet - add a booking calendar above first.
              </p>
            ) : (
              people.map((p, i) => (
                <ColRow key={p.id} cols={COLS} index={i}>
                  <NameCell className="font-medium">{p.name}</NameCell>
                  <TextIn
                    ariaLabel={`Zoom email for ${p.name}`}
                    value={emailFor(p.id)}
                    placeholder="runs from the account owner"
                    onChange={(v) => setEmail(p.id, v)}
                  />
                </ColRow>
              ))
            )}
            <ColRow cols={COLS} index={people.length}>
              <NameCell className="text-ink-3">Everyone else / unassigned slots</NameCell>
              <TextIn
                ariaLabel="Default Zoom host email"
                value={draft.defaultHostEmail}
                placeholder="runs from the account owner"
                onChange={(v) => setDraft((d) => ({ ...d, defaultHostEmail: v }))}
              />
            </ColRow>
          </div>
        </ColScroll>

        {sharesHost && (
          <p className="mt-3 flex items-start gap-2 text-xs text-ink-2">
            <TriangleAlert size={13} className="mt-px shrink-0 text-warn" aria-hidden />
            Two or more people resolve to the same Zoom account, so calls that overlap would land
            in the same room. Give each person their own Zoom login, or keep their hours apart.
          </p>
        )}

        <SaveBar dirty={dirty} onSave={save} busy={busy} error={error} />
      </Card>
    </div>
  );
}
