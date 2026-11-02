/**
 * SETTINGS WITH MORE THAN ONE DOOR.
 *
 * Some stored rules are deliberately editable from several screens - the confirm-or-cancel loop
 * belongs beside the WhatsApp template that asks the question, beside the calendar it releases
 * slots on, and in the Console where every other automation is armed. That is the founder's call
 * and it is a good one.
 *
 * What was wrong is that no door said so. Each form looked like the place the setting lived, so
 * changing it in one screen and later opening another was a surprise - the second screen appeared
 * to be showing something different when it was showing the same row. (There is no stale copy:
 * every door reads and merges the one config. The problem was never the data, it was that nobody
 * was told.)
 *
 * So the doors are listed HERE, once, and each screen renders the list minus itself through
 * `SharedSettingNotice`. Adding a fourth door is one entry and every existing screen mentions it.
 */

export type SettingDoor = { readonly id: string; readonly label: string; readonly href: string };

export type SharedSetting = {
  readonly key: string;
  /** How the notice names the rule, lower-case, mid-sentence. */
  readonly what: string;
  readonly doors: readonly SettingDoor[];
};

export const SHARED_SETTINGS = {
  confirmLoop: {
    key: "confirmLoop",
    what: "confirm-or-cancel settings",
    doors: [
      { id: "whatsapp", label: "WhatsApp → Settings", href: "/whatsapp" },
      { id: "bookings", label: "Bookings → Availability & booking rules", href: "/bookings/availability" },
      { id: "console", label: "Console → Confirm-or-cancel", href: "/console?tab=sales-ops" },
    ],
  },
  capabilities: {
    key: "capabilities",
    what: "per-person permissions",
    doors: [
      { id: "console", label: "Console → Per-person rules", href: "/console?tab=access" },
      { id: "users", label: "Users → Edit access", href: "/people" },
    ],
  },
} as const satisfies Record<string, SharedSetting>;

export type SharedSettingKey = keyof typeof SHARED_SETTINGS;

/** The other doors onto this rule - everything but the screen asking. */
export function otherDoors(key: SharedSettingKey, selfId: string): readonly SettingDoor[] {
  return SHARED_SETTINGS[key].doors.filter((d) => d.id !== selfId);
}
