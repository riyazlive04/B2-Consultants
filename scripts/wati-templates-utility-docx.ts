/**
 * Generates `WhatsApp_Templates_UTILITY_Submission_Pack.docx` — the full inventory of all 25
 * WhatsApp templates the application needs WATI/Meta to approve, written to qualify as UTILITY
 * wherever that is honestly possible, each with the sample values Meta requires at submission.
 *
 * Unlike scripts/whatsapp-templates-docx.ts (the 9 SOP messages, derived from the SOP constants and
 * declared MARKETING), this is a self-contained submission pack: the bodies here are the UTILITY
 * rewrites, so this file carries its own content rather than deriving it. Re-run after any edit.
 *
 * Run:  npx tsx scripts/wati-templates-utility-docx.ts
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { writeFileSync } from "node:fs";
import path from "node:path";

// ── palette ──
const INK = "1A1A1A";
const MUTED = "666666";
const ACCENT = "1F5C4A";
const RISK = "B3261E";
const RULE = "DDDDDD";
const SHADE = "F4F6F5";
const UTILITY = "1C6A48";
const AUTH = "33497E";
const MARKETING = "8F560F";

const FONT = "Calibri";
const MONO = "Consolas";

type Category = "UTILITY" | "AUTHENTICATION" | "MARKETING";

type Tpl = {
  area: string;
  name: string;
  kind: string;
  sub: string;
  category: Category;
  fires: string;
  vars: { name: string; sample: string }[];
  body: string;
  note?: { warn?: boolean; tag: string; text: string };
};

const catColor = (c: Category) => (c === "UTILITY" ? UTILITY : c === "AUTHENTICATION" ? AUTH : MARKETING);

// ─────────────────────────────── The 25 templates ───────────────────────────────

const TEMPLATES: Tpl[] = [
  // ── A · Discovery-call & booking lifecycle ──
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_confirmation",
    kind: "BOOKING_CONFIRMATION",
    sub: "Booking confirmation",
    category: "UTILITY",
    fires: "Once, immediately after a prospect books a discovery-call slot.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, your discovery call with B2 Consultants is confirmed for *{{slot_time}}* IST.\n\n" +
      "We'll share the joining details before the call. If you need to reschedule, use this link and we'll update your slot: {{booking_url}}",
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_reminder",
    kind: "BOOKING_REMINDER",
    sub: "Pre-call reminder",
    category: "UTILITY",
    fires: "Before an upcoming booked slot (default 24h and 2h before).",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, a reminder that your discovery call with B2 Consultants is scheduled for *{{slot_time}}* IST.\n\n" +
      "Please reply *YES* to confirm you'll attend, or pick another time here if needed: {{booking_url}}",
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_confirm_request",
    kind: "BOOKING_CONFIRM_REQUEST",
    sub: "Confirm-or-hold request (Bookings loop)",
    category: "UTILITY",
    fires: "As the call approaches — asks the prospect to reply YES to hold their slot before the auto-cancel cut-off.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sat 18 Jul, 07:00 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, please confirm your discovery call scheduled for *{{slot_time}}* IST by replying *YES*.\n\n" +
      "If you need a different time, you can rebook here and we'll update it: {{booking_url}}",
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_rescheduled",
    kind: "BOOKING_RESCHEDULED",
    sub: "Rescheduled notice",
    category: "UTILITY",
    fires: "When a call is moved to a new time — manual postpone, or promoted into a freed earlier slot.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Sun 19 Jul, 05:30 PM" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, your discovery call has been rescheduled to *{{slot_time}}* IST.\n\n" +
      "If this new time doesn't suit you, you can choose another here at your convenience: {{booking_url}}",
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_booking_auto_cancelled",
    kind: "BOOKING_AUTO_CANCELLED",
    sub: "Auto-cancelled — slot released",
    category: "UTILITY",
    fires: "When no confirmation arrives before the cut-off, so the slot is released; invites a rebook.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, as we didn't receive your confirmation in time, your discovery call slot has been released.\n\n" +
      "If you'd still like to speak with us, you can book a new time here whenever suits you: {{booking_url}}",
    note: {
      tag: "Note",
      text: "States a fact about an appointment the prospect made and offers the same booking function — it reads as UTILITY. Keep the copy factual (no “don't miss out”, no offer language) or it tips into MARKETING.",
    },
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_no_show_followup",
    kind: "NO_SHOW_FOLLOWUP",
    sub: "No-show follow-up",
    category: "UTILITY",
    fires: "For a lead marked No-show — one nudge to rebook.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, we're sorry we missed you at your scheduled discovery call.\n\n" +
      "If you'd like to arrange another time, you can book one here whenever you're ready: {{booking_url}}",
    note: {
      tag: "Borderline",
      text: "There was a booked appointment, so a plain “we missed you, rebook here” can pass as UTILITY. If Meta re-categorises it, that is acceptable — it still sends; it just counts against the marketing cap.",
    },
  },
  {
    area: "A · Discovery-call & booking lifecycle",
    name: "b2_disco_reminder",
    kind: "DISCO_REMINDER",
    sub: "Discovery-call reminder — not yet booked",
    category: "MARKETING",
    fires: "For un-booked leads (New / Disco-not-booked) who haven't scheduled a call.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "booking_url", sample: "https://app.b2consultants.de/book" },
    ],
    body:
      "Hi {{name}}, you registered interest in finding a job in Germany but haven't booked your discovery call yet.\n\n" +
      "You can book a time with our team here whenever you're ready: {{booking_url}}",
    note: {
      warn: true,
      tag: "Cannot be UTILITY",
      text: "The recipient has booked nothing — there is no transaction to notify about, so this is re-engagement, which Meta treats as MARKETING however plainly it is worded. Submit as MARKETING (opt-in is held via the website form), or drop the template and let the SOP intro/follow-up cover this contact.",
    },
  },

  // ── B · SSS calendar ──
  {
    area: "B · Success Strategy Session calendar",
    name: "b2_sss_rescheduled",
    kind: "SSS_RESCHEDULED",
    sub: "SSS rescheduled notice",
    category: "UTILITY",
    fires: "When a Success Strategy Session is moved — founder blocked the slot/day, or a manual/drag reschedule.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "slot_time", sample: "Mon 20 Jul, 06:30 PM" },
      { name: "sss_url", sample: "https://optin.b2consultants.de/sss" },
    ],
    body:
      "Hi {{name}}, your Success Strategy Session has been rescheduled to *{{slot_time}}* IST.\n\n" +
      "If this time doesn't work for you, you can choose another here at your convenience: {{sss_url}}",
  },

  // ── C · Coaching agreements ──
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_send",
    kind: "AGREEMENT_SEND",
    sub: "Signing link",
    category: "UTILITY",
    fires: "When the founder countersigns an agreement — carries the tokenised signing link.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "document_no", sample: "B2-2026-0142" },
      { name: "sign_url", sample: "https://app.b2consultants.de/sign/k7Qz2Xp9Rt4Bn" },
    ],
    body:
      "Hi {{name}}, your B2 Consultants coaching agreement (ref *{{document_no}}*) is ready for your signature.\n\n" +
      "Please review and sign it securely here — the link is unique to you: {{sign_url}}",
    note: {
      tag: "Variable choice",
      text: "The app can supply either {{sign_url}} (full link in the body) or {{sign_token}} (the 43-char token, if you approve a dynamic URL-button suffix instead). Declare ONE, not both, matching how you build the template. When submitting, paste a full real signing URL so Meta's reviewer sees the true format.",
    },
  },
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_otp",
    kind: "AGREEMENT_OTP",
    sub: "Signing verification code",
    category: "AUTHENTICATION",
    fires: "To send the one-time code that binds the signature to control of the number.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "code", sample: "482913" },
    ],
    body: "{{code}} is your B2 Consultants agreement signing code. It is valid for a short time. Do not share it with anyone.",
    note: {
      warn: true,
      tag: "Use AUTHENTICATION, not UTILITY",
      text: "A one-time passcode is Meta's AUTHENTICATION category, which has a fixed format (code + copy button, no marketing) and its own pricing. Meta rejects OTP-style copy submitted as UTILITY. Build it with WATI's authentication template flow; the {{name}} variable may have to be dropped, as AUTHENTICATION templates allow only the code parameter.",
    },
  },
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_reminder",
    kind: "AGREEMENT_REMINDER",
    sub: "Unsigned-agreement reminder",
    category: "UTILITY",
    fires: "When an issued agreement is still unsigned and the link has not expired.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "document_no", sample: "B2-2026-0142" },
      { name: "sign_url", sample: "https://app.b2consultants.de/sign/k7Qz2Xp9Rt4Bn" },
    ],
    body:
      "Hi {{name}}, a reminder that your coaching agreement (ref *{{document_no}}*) is still awaiting your signature.\n\n" +
      "You can complete it here before the link expires — it only takes a minute: {{sign_url}}",
  },
  {
    area: "C · Coaching agreements",
    name: "b2_agreement_copy",
    kind: "AGREEMENT_COPY",
    sub: "Countersigned copy",
    category: "UTILITY",
    fires: "The moment the student signs — carries the link to the sealed, countersigned PDF. Delivering it is what marks the agreement Completed.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "document_no", sample: "B2-2026-0142" },
      { name: "copy_url", sample: "https://app.b2consultants.de/copy/k7Qz2Xp9Rt4Bn" },
    ],
    body:
      "Hi {{name}}, thank you for signing. Your countersigned copy of agreement *{{document_no}}* is available to download here — please keep it for your records: {{copy_url}}",
  },

  // ── D · Finance & payments ──
  {
    area: "D · Finance & payments",
    name: "b2_payment_reminder",
    kind: "PAYMENT_REMINDER",
    sub: "Overdue payment reminder",
    category: "UTILITY",
    fires: "For a pending payment that is overdue (balance still owing).",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "amount", sample: "₹25,000" },
    ],
    body:
      "Hi {{name}}, this is a reminder that a payment of *{{amount}}* is currently due on your B2 Consultants account.\n\n" +
      "If you've already paid, please ignore this message. Otherwise, reply here and we'll assist.",
  },
  {
    area: "D · Finance & payments",
    name: "b2_emi_pre_due",
    kind: "EMI_PRE_DUE",
    sub: "Instalment due-soon reminder",
    category: "UTILITY",
    fires: "Before an instalment's due date (default 3 days out, then on the day). Runs in dry-run by default.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "seq", sample: "2" },
      { name: "total", sample: "3" },
      { name: "amount", sample: "₹25,000" },
      { name: "due_date", sample: "20 Jul 2026" },
    ],
    body:
      "Hi {{name}}, a reminder that instalment {{seq}} of {{total}} — *{{amount}}* — is due on *{{due_date}}*.\n\n" +
      "Please ensure funds are available by then. Reply here if you have any questions.",
  },

  // ── E · Student coaching ──
  {
    area: "E · Student coaching",
    name: "b2_checkin_nudge",
    kind: "CHECKIN_NUDGE",
    sub: "Check-in nudge",
    category: "UTILITY",
    fires: "For a student whose coaching check-in date has arrived or passed.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, it's time for your scheduled coaching check-in with B2 Consultants. Please reply to this message to arrange your session.",
  },
  {
    area: "E · Student coaching",
    name: "b2_sprint_miss_nudge",
    kind: "SPRINT_MISS_NUDGE",
    sub: "Sprint-miss nudge",
    category: "UTILITY",
    fires: "For a student who missed a sprint-week target.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, our records show this week's sprint target wasn't marked complete. Reply to this message and your coach will help you get back on track.",
  },

  // ── F · Outreach Specialist SOP ──
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_intro",
    kind: "SOP_INTRO",
    sub: "SOP Step 3 · WhatsApp introduction",
    category: "MARKETING",
    fires: "Immediately after opt-in (target <5 min), inviting a discovery call.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "sender", sample: "Nilofer" },
    ],
    body:
      "Hi {{name}}, this is {{sender}} from B2 Consultants. Thanks for registering your interest in finding your next job in Germany.\n\n" +
      "You can book a 20-minute discovery call with our team here: https://optin.b2consultants.de/apply\n\n" +
      "I'll also give you a quick call shortly to help you get booked.",
    note: {
      warn: true,
      tag: "Cannot be UTILITY",
      text: "This is the first contact and its whole purpose is to invite someone to book — there is no existing appointment to notify about, so it is promotional by nature. Even stripped of “*FREE*”, Meta reads an invitation-to-book to a fresh lead as MARKETING. Submit as MARKETING (opt-in is held via the website form).",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_followup_not_booked",
    kind: "SOP_FOLLOWUP",
    sub: "SOP Step 6 · Follow-up, not booked",
    category: "MARKETING",
    fires: "When the lead is still not booked at the 2-hour check.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "sender", sample: "Nilofer" },
    ],
    body:
      "Hi {{name}}, {{sender}} here from B2 Consultants. I noticed you haven't booked your discovery call with our team yet.\n\n" +
      "You can book a time directly here: https://optin.b2consultants.de/apply\n\n" +
      "Let me know if you'd like any help.",
    note: {
      warn: true,
      tag: "Cannot be UTILITY",
      text: "Same reason as Step 3 — chasing an un-booked lead is re-engagement. Submit as MARKETING.",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_disco_welcome",
    kind: "SOP_DISCO_WELCOME",
    sub: "SOP Step 13 · Disco welcome",
    category: "UTILITY",
    fires: "When the BANT verdict is YES/MAYBE and the call is booked.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "sender", sample: "Nilofer" },
      { name: "date", sample: "Sat 18 Jul" },
      { name: "time", sample: "07:00 PM" },
    ],
    body:
      "Hi {{name}}, this is {{sender}} from B2 Consultants. This confirms your discovery call is scheduled for *{{date}}* at *{{time}}* IST.\n\n" +
      "Our team is preparing for your call and will be in touch if we need anything further before then. See you soon.",
    note: {
      tag: "Made UTILITY",
      text: "Original Step 13 linked the case-studies page (social proof). That link is removed here — it is what would force MARKETING. The confirmation itself is transactional.",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_disco_confirm_1",
    kind: "SOP_DISCO_CONFIRM_1",
    sub: "SOP Step 14 · Disco confirmation 1",
    category: "UTILITY",
    fires: "At least 36h before the booked discovery call. Blocked until a Zoom link is on the card.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "date", sample: "Sat 18 Jul" },
      { name: "time", sample: "07:00 PM" },
      { name: "zoom_link", sample: "https://us02web.zoom.us/j/85512345678" },
    ],
    body:
      "Hi {{name}}, a reminder about your discovery call scheduled for *{{date}}* at *{{time}}* IST.\n\n" +
      "You can join using this link: {{zoom_link}}\n\n" +
      "Please reply *YES* to confirm your attendance.",
    note: {
      tag: "Made UTILITY",
      text: "The sales copy (“the possibilities of your next job in Germany”, “figure out your next best steps”) is removed. What remains — appointment time, join link, reply-YES — is a textbook UTILITY confirmation.",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_disco_confirm_2",
    kind: "SOP_DISCO_CONFIRM_2",
    sub: "SOP Step 15 · Disco confirmation 2",
    category: "UTILITY",
    fires: "At least 24h before, if Step 14 drew no reply.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "date", sample: "Sat 18 Jul" },
      { name: "time", sample: "07:00 PM" },
      { name: "zoom_link", sample: "https://us02web.zoom.us/j/85512345678" },
    ],
    body:
      "Hi {{name}}, we haven't yet received your confirmation for your discovery call on *{{date}}* at *{{time}}* IST.\n\n" +
      "Your joining link is: {{zoom_link}}\n\n" +
      "Please reply *YES* to confirm your attendance.",
    note: {
      tag: "Made UTILITY",
      text: "“*FREE* Personalized Discovery Call” is reduced to a plain “discovery call”. No offer language remains.",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_disco_cancel",
    kind: "SOP_DISCO_CANCEL",
    sub: "SOP Step 16 · Disco cancellation",
    category: "UTILITY",
    fires: "At least 12h before, unconfirmed after two confirmation calls.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, as we didn't receive your confirmation, your discovery call slot has been released.\n\n" +
      "If you'd still like to speak with us, you can book another time here whenever suits you: https://optin.b2consultants.de/apply",
    note: {
      tag: "Made UTILITY",
      text: "States the slot was released (a fact about the prospect's own appointment) with one functional rebook link. Kept factual — no “don't miss out”.",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_sss_confirm_1",
    kind: "SOP_SSS_CONFIRM_1",
    sub: "SOP Step 19 · SSS confirmation 1",
    category: "UTILITY",
    fires: "At least 24h before the SSS. In the SOP this carries a personalised video.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "sender", sample: "Nilofer" },
      { name: "date", sample: "Mon 20 Jul" },
      { name: "time", sample: "06:30 PM" },
    ],
    body:
      "Hi {{name}}, this is {{sender}} from B2 Consultants. This is a reminder that your Success Strategy Session is scheduled for *{{date}}* at *{{time}}* IST.\n\n" +
      "Please reply *YES* to confirm your attendance.",
    note: {
      warn: true,
      tag: "Decision needed",
      text: "The SOP's “personalised game plan / video” copy is promotional and is removed to keep this UTILITY. If B2 wants the personalised video, send it as a separate free-form (session) message after the prospect replies, or accept that a video-led template must be MARKETING. As-is, this stays a plain UTILITY confirmation.",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_sss_confirm_2",
    kind: "SOP_SSS_CONFIRM_2",
    sub: "SOP Step 20 · SSS confirmation 2",
    category: "UTILITY",
    fires: "At least 12h before the SSS, if Step 19 drew no reply.",
    vars: [
      { name: "name", sample: "Priya" },
      { name: "date", sample: "Mon 20 Jul" },
      { name: "time", sample: "06:30 PM" },
      { name: "zoom_link", sample: "https://us02web.zoom.us/j/85512345678" },
    ],
    body:
      "Hi {{name}}, we haven't yet received your confirmation for your Success Strategy Session on *{{date}}* at *{{time}}* IST.\n\n" +
      "Your joining link is: {{zoom_link}}\n\n" +
      "Please reply *YES* to confirm.",
    note: {
      tag: "Made UTILITY",
      text: "“He's prepared something very specific… would love to see you there” is removed. A closing line was added so the body doesn't end on the link variable (Meta rejects that).",
    },
  },
  {
    area: "F · Outreach Specialist SOP (Steps 3–21)",
    name: "b2_sop_sss_cancel",
    kind: "SOP_SSS_CANCEL",
    sub: "SOP Step 21 · SSS cancellation",
    category: "UTILITY",
    fires: "At least 10h before the SSS, still unconfirmed.",
    vars: [{ name: "name", sample: "Priya" }],
    body:
      "Hi {{name}}, as we didn't receive your confirmation, your Success Strategy Session slot has been released.\n\n" +
      "If you'd still like to attend, you can book another time here whenever suits you: https://optin.b2consultants.de/sss",
  },

  // ── G · Book publisher orders ──
  {
    area: "G · Book publisher orders",
    name: "b2_book_order",
    kind: "BOOK_ORDER  (new — not yet wired)",
    sub: "Order for a student's level books, sent to the publisher/vendor",
    category: "UTILITY",
    fires: "When a book order is placed with the publisher for a student's level (BookOrder → ORDERED / QUOTE_REQUESTED). Sent to the Vendor's WhatsApp number.",
    vars: [
      { name: "publisher_name", sample: "Sharma Book House" },
      { name: "order_ref", sample: "BO-2026-0087" },
      { name: "level", sample: "German A1" },
      { name: "student_name", sample: "Priya Sharma" },
      { name: "ship_to", sample: "12 MG Road, Indiranagar, Bengaluru 560038" },
      { name: "ship_phone", sample: "+91 98450 12345" },
    ],
    body:
      "Hello {{publisher_name}}, this is a book order from B2 Consultants (ref *{{order_ref}}*).\n\n" +
      "Please arrange the German *{{level}}* course books for our student {{student_name}}.\n\n" +
      "Ship to: {{ship_to}}\n" +
      "Contact on delivery: {{ship_phone}}\n\n" +
      "Kindly confirm the quotation and expected dispatch date. Thank you.",
    note: {
      warn: true,
      tag: "New touchpoint — needs building",
      text: "There is no BOOK_ORDER kind in the app's WhatsAppKind enum yet, and no send path from the Book Orders panel. Approving this template is step one; wiring it (add the kind + a “Message publisher” action on the BookOrder row that fills these variables from the Vendor and BookOrder records) is a small follow-up build. The publisher's number must be a saved WhatsApp contact / opted-in for a business-initiated template to deliver.",
    },
  },
];

// ─────────────────────────────── small builders ───────────────────────────────

const p = (
  text: string,
  opts: { size?: number; bold?: boolean; color?: string; italics?: boolean; spacing?: number; font?: string } = {},
) =>
  new Paragraph({
    spacing: { after: opts.spacing ?? 80 },
    children: [
      new TextRun({
        text,
        size: opts.size ?? 20,
        bold: opts.bold,
        italics: opts.italics,
        color: opts.color ?? INK,
        font: opts.font ?? FONT,
      }),
    ],
  });

const h1 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, size: 32, bold: true, color: INK, font: FONT })],
  });

const h2 = (text: string) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 220, after: 100 },
    children: [new TextRun({ text, size: 26, bold: true, color: ACCENT, font: FONT })],
  });

const bullet = (text: string, color = INK) =>
  new Paragraph({
    bullet: { level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, size: 20, color, font: FONT })],
  });

const checkbox = (text: string, bold = false) =>
  new Paragraph({
    spacing: { after: 70 },
    children: [
      new TextRun({ text: "☐   ", size: 22, color: INK, font: FONT }),
      new TextRun({ text, size: 20, bold, color: INK, font: FONT }),
    ],
  });

const spacer = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] });

const rule = () =>
  new Paragraph({
    spacing: { before: 120, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE } },
    children: [],
  });

function cell(text: string, opts: { bold?: boolean; mono?: boolean; shade?: boolean; width?: number; color?: string } = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { type: ShadingType.CLEAR, fill: SHADE } : undefined,
    margins: { top: 60, bottom: 60, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text,
            size: 18,
            bold: opts.bold,
            color: opts.color ?? INK,
            font: opts.mono ? MONO : FONT,
          }),
        ],
      }),
    ],
  });
}

function table(headers: string[], rows: (string | { text: string; color?: string; mono?: boolean })[][], widths: number[], monoCols: number[] = []) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, { bold: true, shade: true, width: widths[i] })),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c, i) => {
              if (typeof c === "string") return cell(c, { width: widths[i], mono: monoCols.includes(i) });
              return cell(c.text, { width: widths[i], mono: c.mono ?? monoCols.includes(i), color: c.color });
            }),
          }),
      ),
    ],
  });
}

/** The message body, monospaced and boxed, one paragraph per line so Word keeps the blank lines. */
function bodyBox(text: string): Paragraph[] {
  const lines = text.split("\n");
  return lines.map(
    (line, i) =>
      new Paragraph({
        spacing: { after: i === lines.length - 1 ? 0 : 40, before: i === 0 ? 40 : 0 },
        shading: { type: ShadingType.CLEAR, fill: SHADE },
        border: {
          left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT },
          ...(i === 0 ? { top: { style: BorderStyle.SINGLE, size: 2, color: RULE } } : {}),
          ...(i === lines.length - 1 ? { bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE } } : {}),
        },
        indent: { left: 160, right: 160 },
        children: [new TextRun({ text: line || " ", size: 19, font: MONO, color: INK })],
      }),
  );
}

// ─────────────────────────────── document sections ───────────────────────────────

function cover(): Paragraph[] {
  return [
    new Paragraph({
      spacing: { after: 60 },
      children: [new TextRun({ text: "B2 Consultants  ·  WATI / Meta submission", size: 22, bold: true, color: ACCENT, font: FONT })],
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [new TextRun({ text: "WhatsApp Templates — UTILITY Submission Pack", size: 40, bold: true, color: INK, font: FONT })],
    }),
    p("Every business-initiated WhatsApp message the application sends must be a template Meta has approved. This is the complete inventory — 26 templates across seven areas — written to qualify as UTILITY wherever that is honestly possible, each with the sample values Meta requires at submission.", {
      size: 22,
      color: MUTED,
    }),
    spacer(140),
    p("Read this before you submit", { bold: true, size: 22 }),
    bullet("You asked for these to be UTILITY, so every body is written as a plain, transactional notification — no “*FREE*”, no case-study links, no “personalised game plan”, no sales pitch. That wording is what actually earns the UTILITY category."),
    bullet("Why the wording, not just the label, matters: since April 2025 Meta categorises a template by reading its content — it re-classifies anything promotional as MARKETING regardless of what you declared, and flags accounts that repeatedly mis-declare. A UTILITY label on selling copy costs you the flag, not a cheaper message."),
    bullet("Three of the 26 cannot honestly be UTILITY (b2_disco_reminder, b2_sop_intro, b2_sop_followup_not_booked) — they are sent to people who have NOT booked anything, so there is no transaction to notify about. They are marked MARKETING with your options.", RISK),
    bullet("One template (the signing code, b2_agreement_otp) belongs in Meta's AUTHENTICATION category.", AUTH),
    bullet("Business-initiated messages stay queued for a human until each template is APPROVED and mapped in the app — nothing breaks in the meantime, it just stays manual."),
    rule(),
  ];
}

function summary(): (Paragraph | Table)[] {
  const counts = TEMPLATES.reduce(
    (a, t) => ((a[t.category] = (a[t.category] ?? 0) + 1), a),
    {} as Record<Category, number>,
  );
  return [
    h2("All 25 templates at a glance"),
    p(
      `${counts.UTILITY ?? 0} UTILITY  ·  ${counts.AUTHENTICATION ?? 0} AUTHENTICATION  ·  ${counts.MARKETING ?? 0} MARKETING.  All are new to this WATI account.`,
      { size: 19, color: MUTED, spacing: 140 },
    ),
    table(
      ["#", "Template name", "Category", "App touchpoint"],
      TEMPLATES.map((t, i) => [
        String(i + 1),
        { text: t.name, mono: true },
        { text: t.category, color: catColor(t.category) },
        { text: t.kind, mono: true },
      ]),
      [6, 40, 22, 32],
    ),
    rule(),
  ];
}

function templateSection(t: Tpl, index: number, firstInArea: boolean): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];

  if (firstInArea) {
    out.push(
      new Paragraph({
        pageBreakBefore: true,
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 40, after: 140 },
        children: [new TextRun({ text: t.area, size: 30, bold: true, color: INK, font: FONT })],
      }),
    );
  }

  out.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      spacing: { before: 220, after: 60 },
      keepNext: true,
      children: [
        new TextRun({ text: `${index + 1}.  `, size: 24, bold: true, color: INK, font: FONT }),
        new TextRun({ text: t.name, size: 24, bold: true, color: ACCENT, font: MONO }),
        new TextRun({ text: `    ${t.category}`, size: 18, bold: true, color: catColor(t.category), font: FONT }),
      ],
    }),
    p(t.sub, { size: 19, color: MUTED, spacing: 100 }),
    table(
      ["Field", "Value"],
      [
        ["Template name", { text: t.name, mono: true }],
        ["Category", { text: t.category, color: catColor(t.category) }],
        ["Language", "en"],
        ["App touchpoint (bind to this)", { text: t.kind, mono: true }],
        ["When it fires", t.fires],
      ],
      [30, 70],
    ),
    spacer(100),
    p("Body — paste exactly as shown (keep the blank lines and *asterisks*)", { bold: true, size: 20 }),
    ...bodyBox(t.body),
    spacer(140),
    p("Variables & sample values", { bold: true, size: 20 }),
    table(
      ["Order", "Variable", "Sample value (submit this to Meta)"],
      t.vars.map((v, i) => [String(i + 1), { text: `{{${v.name}}}`, mono: true }, v.sample]),
      [12, 30, 58],
    ),
    spacer(120),
  );

  if (t.note) {
    out.push(
      new Paragraph({
        spacing: { before: 40, after: 60 },
        children: [
          new TextRun({ text: `${t.note.warn ? "⚠  " : ""}${t.note.tag}`, size: 20, bold: true, color: t.note.warn ? RISK : ACCENT, font: FONT }),
        ],
      }),
      p(t.note.text, { size: 19, color: t.note.warn ? RISK : MUTED, spacing: 120 }),
    );
  }

  return out;
}

function checklist(): (Paragraph | Table)[] {
  return [
    new Paragraph({ pageBreakBefore: true, children: [] }),
    h1("Submitting & going live"),
    p("Nothing sends until each template is APPROVED in WATI and bound to its touchpoint in the app.", {
      size: 19,
      color: MUTED,
      spacing: 160,
    }),
    h2("Part A — Submit in WATI (per template)"),
    checkbox("Create each template with the EXACT snake_case name shown — the app is mapped to these names.", true),
    checkbox("Set the category as marked: UTILITY for the 22, AUTHENTICATION for the signing code, MARKETING for the three re-engagement messages. Do NOT re-declare a promotional body UTILITY to save cost — Meta re-categorises it and flags the account."),
    checkbox("Paste the body exactly, blank lines included. Keep the *asterisks* — they render as bold in WhatsApp."),
    checkbox("Declare each variable in the order shown and give it the sample value from its card. Meta rejects missing or unrealistic samples."),
    checkbox("For {{sign_url}} / {{copy_url}}, paste a full real link at submission so the reviewer sees the true format."),
    checkbox("Language en (use en_GB if WATI forces a locale). Submit and record the date; review is usually minutes but can take 24–48h."),
    checkbox("Build b2_agreement_otp through WATI's AUTHENTICATION template flow, not as a UTILITY text template."),
    h2("Part B — Wire it into the app (Admin)"),
    checkbox("Set WATI_ENABLED=true, WATI_API_ENDPOINT and WATI_ACCESS_TOKEN in the environment.", true),
    checkbox("WhatsApp → Settings → Refresh templates. All approved names should appear in the catalogue."),
    checkbox("Bind each touchpoint to its template using the App touchpoint value on each card. One template per touchpoint."),
    checkbox("Enter each template's variable list in Settings exactly as approved. A mismatch blocks the send and names the missing variable — it never delivers “Hi ,”."),
    checkbox("Send a test to your own number. Confirm variables resolve and the bold renders."),
    checkbox("Turn on sending one low-risk touchpoint at a time; watch the WhatsApp history before enabling the rest."),
    rule(),
    p("Generated from scripts/wati-templates-utility-docx.ts — re-run `npx tsx scripts/wati-templates-utility-docx.ts` after any edit. The nine SOP bodies are UTILITY rewrites of Script for Outreach Specialist.docx (Steps 3–21); the app currently ships them as MARKETING via src/lib/whatsapp-submission.ts. 26 templates · the free-form MANUAL touchpoint needs no template and is excluded; b2_book_order is a proposed new touchpoint not yet wired.", {
      size: 16,
      color: MUTED,
      italics: true,
    }),
  ];
}

// ─────────────────────────────── assemble ───────────────────────────────

async function main() {
  const seenAreas = new Set<string>();
  const templatePages = TEMPLATES.flatMap((t, i) => {
    const first = !seenAreas.has(t.area);
    seenAreas.add(t.area);
    return templateSection(t, i, first);
  });

  const doc = new Document({
    creator: "B2 Consultants",
    title: "WhatsApp Templates — UTILITY Submission Pack",
    description: "All 25 WhatsApp templates the app needs WATI to approve, written for UTILITY where possible, with sample values.",
    styles: { default: { document: { run: { font: FONT, size: 20, color: INK } } } },
    sections: [
      {
        properties: { page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } } },
        children: [
          ...cover(),
          ...summary(),
          ...templatePages,
          ...checklist(),
          spacer(160),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: "B2 Consultants — WhatsApp template submission pack",
                size: 16,
                color: MUTED,
                italics: true,
                font: FONT,
              }),
            ],
          }),
        ],
      },
    ],
  });

  const out = path.resolve(process.cwd(), "..", "WhatsApp_Templates_UTILITY_Submission_Pack.docx");
  writeFileSync(out, await Packer.toBuffer(doc));

  const counts = TEMPLATES.reduce((a, t) => ((a[t.category] = (a[t.category] ?? 0) + 1), a), {} as Record<Category, number>);
  console.log(`Wrote ${out}`);
  console.log(`${TEMPLATES.length} templates — ${counts.UTILITY ?? 0} UTILITY, ${counts.AUTHENTICATION ?? 0} AUTHENTICATION, ${counts.MARKETING ?? 0} MARKETING.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
