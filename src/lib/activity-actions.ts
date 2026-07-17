/**
 * Isomorphic vocabulary for the activity log — importable from client AND server.
 *
 * An action is a dotted verb: `<subject>.<verb>` or `<area>.<subject>.<verb>`, e.g.
 * `call.log`, `lead.update`, `finance.income.create`.
 *
 * WHY THERE IS NO HARDCODED UNION OF EVERY ACTION
 * The obvious design is `type ActivityAction = "call.log" | "lead.update" | …`, with one
 * central list every call site must register in. It was rejected twice over: it makes one
 * file a merge bottleneck for changes spread across ~35 action modules, and — worse — the
 * founder's filter dropdown would then be a hand-maintained mirror of what's actually in
 * the table. Mirrors drift. An action that stopped firing would still be offered as a
 * filter, and one added without a catalogue entry would be invisible to it.
 *
 * So the filter list is derived from the DB (`SELECT DISTINCT action`) and always matches
 * reality, and this file only handles PRESENTATION: how a verb reads, and what colour it
 * carries. Both degrade gracefully for a verb they've never seen, which is what lets a new
 * action ship by adding exactly one `logActivity` call and nothing else.
 */

/** Free-form by design — see the header. Kept as a named type so intent reads at call sites. */
export type ActivityAction = string;

/** Drives tone in the feed/table. Derived from the verb, so a new action is coloured for free. */
export type ActivityKind = "create" | "update" | "delete" | "send" | "auth" | "other";

const KIND_BY_VERB: Record<string, ActivityKind> = {
  create: "create", add: "create", log: "create", record: "create", issue: "create",
  generate: "create", post: "create", import: "create", duplicate: "create",
  update: "update", edit: "update", assign: "update", move: "update", reorder: "update",
  confirm: "update", reschedule: "update", postpone: "update", block: "update",
  unblock: "update", lock: "update", unlock: "update", publish: "update",
  correct: "update", promote: "update", restore: "update", settle: "update",
  delete: "delete", remove: "delete", cancel: "delete", archive: "delete", void: "delete",
  send: "send", resend: "send", notify: "send", email: "send", sms: "send", whatsapp: "send",
  invite: "auth", suspend: "auth", reinstate: "auth", signin: "auth", signout: "auth",
  grant: "auth", revoke: "auth",
};

/** The trailing segment is the verb: `finance.income.create` → `create`. */
export function activityVerb(action: ActivityAction): string {
  return action.split(".").pop() ?? action;
}

export function activityKind(action: ActivityAction): ActivityKind {
  return KIND_BY_VERB[activityVerb(action)] ?? "other";
}

/**
 * Nicer names for verbs whose derived label would read badly. Anything absent falls through
 * to `humanise`, so this list is an improvement, never a requirement.
 */
const LABEL_OVERRIDES: Record<string, string> = {
  "call.log": "Call logged",
  "lead.create": "Lead added",
  "lead.update": "Lead edited",
  "lead.assign": "Lead assigned",
  "lead.contacted": "Lead marked contacted",
  "outcome.create": "Discovery outcome recorded",
  "dailylog.submit": "Daily log submitted",
  "dailylog.correct": "Daily log corrected",
  "finance.income.create": "Income recorded",
  "finance.expense.create": "Expense recorded",
  "user.suspend": "User suspended",
  "user.reinstate": "User reinstated",
};

/** "finance.income.create" → "Income recorded" / "Finance income create". Never throws. */
export function activityLabel(action: ActivityAction): string {
  const override = LABEL_OVERRIDES[action];
  if (override) return override;
  return humanise(action);
}

function humanise(action: ActivityAction): string {
  const words = action.split(/[.\-_]/).filter(Boolean);
  if (words.length === 0) return action;
  const sentence = words.join(" ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** Group an action list by its leading segment, for a grouped filter dropdown. */
export function activityGroup(action: ActivityAction): string {
  const [head] = action.split(".");
  return head ?? action;
}

// ── time, in the business timezone ─────────────────────────────

/**
 * The founder's question is "what did Asma do at 3pm", so every timestamp in this feature
 * renders in IST (CONTEXT §6) regardless of where the browser is. Formatting server-side
 * against a fixed zone also keeps SSR and hydration from disagreeing, which a bare
 * toLocaleString() would guarantee the moment the founder travelled.
 */
// Locales match the house convention in daily-log.ts / format.ts — en-GB dates, en-US times.
// Not cosmetic pedantry: en-IN renders "Fri, 17 Jul, 2026" (comma before the year) and a
// lowercase "pm", so a third style here would be visibly inconsistent with the Daily Log
// feed sitting one nav item away.
const IST = "Asia/Kolkata";

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZone: IST,
});
const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: IST,
});
const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: IST,
});

/** "3:04:09 PM" — to the second, because "exactly when" is the point of the feature. */
export function activityTime(at: Date): string {
  return TIME_FMT.format(at);
}

/** "Fri, 17 Jul 2026" */
export function activityDate(at: Date): string {
  return DATE_FMT.format(at);
}

/** "2026-07-17" in IST — the grouping key for date buckets. */
export function activityDayKey(at: Date): string {
  return DAY_KEY_FMT.format(at);
}

/** "Fri, 17 Jul 2026 · 3:04:09 PM IST" — the unambiguous form, for the table and tooltips. */
export function activityStamp(at: Date): string {
  return `${activityDate(at)} · ${activityTime(at)} IST`;
}

/** "just now" / "12m ago" / "3h ago" — relative, for the feed. `now` is injectable for tests. */
export function activityRelative(at: Date, now: Date = new Date()): string {
  const secs = Math.round((now.getTime() - at.getTime()) / 1000);
  if (secs < 0) return "just now"; // clock skew — never render "in 3 minutes"
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return activityDate(at);
}
