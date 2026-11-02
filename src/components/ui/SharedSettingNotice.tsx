import Link from "next/link";
import { Info } from "lucide-react";
import { otherDoors, SHARED_SETTINGS, type SharedSettingKey } from "@/lib/shared-settings";

/**
 * "This setting is also edited elsewhere" - said on every screen that edits it.
 *
 * One line, drawn from `SHARED_SETTINGS` so the three screens editing the confirm-or-cancel loop
 * cannot end up describing the arrangement differently, or stop mentioning a door that was added
 * after them. See `lib/shared-settings.ts` for why the doors are deliberate and why saying so is
 * the whole fix.
 */
export function SharedSettingNotice({
  setting,
  self,
}: {
  setting: SharedSettingKey;
  /** This screen's `id` in the setting's door list, so it does not point at itself. */
  self: string;
}) {
  const others = otherDoors(setting, self);
  if (others.length === 0) return null;
  return (
    <p
      role="note"
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 rounded-field border border-line bg-surface-2 px-3 py-2 text-caption text-muted"
    >
      <Info size={13} aria-hidden className="relative top-0.5 flex-none" />
      <span>
        One rule, {SHARED_SETTINGS[setting].doors.length} places to change it. These are the same{" "}
        {SHARED_SETTINGS[setting].what} as{" "}
        {others.map((d, i) => (
          <span key={d.id}>
            {i > 0 && (i === others.length - 1 ? " and " : ", ")}
            <Link href={d.href} className="font-medium text-accent underline">
              {d.label}
            </Link>
          </span>
        ))}
        {" "}- saving here changes them there too.
      </span>
    </p>
  );
}
