/**
 * The publisher book-order WhatsApp message - reference numbering and variable assembly.
 *
 * ══ WHY THIS TOUCHPOINT IS UNLIKE EVERY OTHER ONE ═══════════════════════════════
 * Every other WhatsApp template in this app is addressed to the person it is about: a prospect,
 * a student, a signer. `BOOK_ORDER` goes to the VENDOR. The recipient is a supplier, the subject
 * is a student, and the two must never be confused - which is why the variables carry
 * `student_name` and `ship_to` as *content* rather than addressing the reader as the subject.
 *
 * Two consequences worth stating, because both are easy to get wrong later:
 *  · The number we send to is `Vendor.phone`, never the student's. A slip here ships a student's
 *    home address to the wrong person.
 *  · `ship_to`/`ship_phone` come from the ORDER's snapshot (`BookOrder.shipToAddress/shipToPhone`),
 *    not live off the Student. The snapshot is deliberate - the books go where the student lived
 *    when we ordered, and a later address edit must not rewrite where a past parcel went.
 *
 * ══ WHY EVERY VARIABLE IS REQUIRED ══════════════════════════════════════════════
 * The approved template body uses all six. A template send with a blank parameter does not
 * degrade gracefully - it delivers "Ship to: " to a supplier, who then either ships nowhere or
 * rings to ask. So a missing value BLOCKS the send and names what is missing, rather than
 * producing a message that is technically delivered and practically useless.
 *
 * Isomorphic - no prisma, no server-only, so the rules above are unit-testable.
 */

/**
 * The six variables the approved `b2_book_order` template declares, in the order its Sample
 * Content fields were filled in WATI.
 *
 * This list is the CONTRACT with the approved template. It must stay equal to
 * `WHATSAPP_AVAILABLE_VARS.BOOK_ORDER`; a test asserts that, because the two drifting apart is
 * exactly the failure that turns into "template expects {{ship_to}}, which this touchpoint cannot
 * supply" at send time.
 */
export const BOOK_ORDER_VARS = [
  "publisher_name",
  "order_ref",
  "level",
  "student_name",
  "ship_to",
  "ship_phone",
] as const;

export type BookOrderVar = (typeof BOOK_ORDER_VARS)[number];

/** What the order reference looks like: `BO-2026-0087`. */
export const BOOK_ORDER_REF_PREFIX = "BO";

export function formatBookOrderRef(year: number, seq: number): string {
  return `${BOOK_ORDER_REF_PREFIX}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * The sequence number inside a reference for a given year, or null if this isn't one of ours.
 *
 * Used to find the next free number. Returns null rather than NaN for anything unparseable so a
 * hand-typed or legacy value in the column can never be read as a number and collide.
 */
export function parseBookOrderRefSeq(ref: string, year: number): number | null {
  const prefix = `${BOOK_ORDER_REF_PREFIX}-${year}-`;
  if (!ref.startsWith(prefix)) return null;
  const tail = ref.slice(prefix.length);
  if (!/^\d+$/.test(tail)) return null;
  const n = Number(tail);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** The next reference for `year`, given every existing ref. Gaps are not reused. */
export function nextBookOrderRef(existing: readonly string[], year: number): string {
  let max = 0;
  for (const ref of existing) {
    const seq = parseBookOrderRefSeq(ref, year);
    if (seq !== null && seq > max) max = seq;
  }
  return formatBookOrderRef(year, max + 1);
}

export type BookOrderMessageInput = {
  publisherName: string | null | undefined;
  orderRef: string | null | undefined;
  /** The level's DISPLAY name ("German A1"), not its code ("GERMAN_A1") - a vendor reads this. */
  levelLabel: string | null | undefined;
  studentName: string | null | undefined;
  shipTo: string | null | undefined;
  shipPhone: string | null | undefined;
};

/** Human wording for each gap - shown to the admin who pressed the button. */
const MISSING_LABEL: Record<BookOrderVar, string> = {
  publisher_name: "the vendor's name",
  order_ref: "an order reference",
  level: "the level",
  student_name: "the student's name",
  ship_to: "a ship-to address on the order",
  ship_phone: "a contact number for delivery",
};

export type BookOrderVarsResult =
  | { ok: true; vars: Record<BookOrderVar, string> }
  | { ok: false; missing: BookOrderVar[]; message: string };

/**
 * Assemble the six template variables, or refuse and say what is missing.
 *
 * Whitespace-only counts as missing: an address of `"   "` passes a null check and still ships
 * nowhere.
 */
export function buildBookOrderVars(input: BookOrderMessageInput): BookOrderVarsResult {
  const raw: Record<BookOrderVar, string> = {
    publisher_name: (input.publisherName ?? "").trim(),
    order_ref: (input.orderRef ?? "").trim(),
    level: (input.levelLabel ?? "").trim(),
    student_name: (input.studentName ?? "").trim(),
    ship_to: (input.shipTo ?? "").trim(),
    ship_phone: (input.shipPhone ?? "").trim(),
  };

  const missing = BOOK_ORDER_VARS.filter((v) => raw[v] === "");
  if (missing.length > 0) {
    const list = missing.map((m) => MISSING_LABEL[m]);
    const joined =
      list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
    return {
      ok: false,
      missing: [...missing],
      message: `Can't message the publisher yet - this order has no ${joined}.`,
    };
  }
  return { ok: true, vars: raw };
}

/** One-line summary stored on the message row, so the WhatsApp log reads without a join. */
export function bookOrderBodySummary(vars: Record<BookOrderVar, string>): string {
  return `Book order ${vars.order_ref} - ${vars.level} for ${vars.student_name} → ${vars.publisher_name}`;
}
