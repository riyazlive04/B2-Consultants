/**
 * Rebuild the Synamate `training-page` as a native funnel step.
 *
 * Source of truth is the LIVE page (https://optin.b2consultants.de/training-page) — every string
 * below was read off it, not rewritten, so the two read identically during the changeover. Four
 * of its sections were GHL "Custom HTML/Javascript" blocks; they are native nodes here.
 *
 * Idempotent: upserts the funnel by slug and the step by (funnel, slug), so re-running replaces
 * the page's blocks and nothing else. Editing the page in the builder afterwards and re-running
 * this WILL discard those edits — it is a rebuild, not a merge.
 *
 *   npm run db:training-page
 *
 * NOTE: the hero slot holds an IMAGE, not a player — the Synamate page shows a play-button still
 * there and the actual video lives on the following step.
 */

import { PrismaClient } from "@prisma/client";
import type { Block } from "../src/lib/sites-types";

const prisma = new PrismaClient();

/**
 * Served by us, from `public/media/` — NOT hotlinked from GHL's CDN.
 *
 * The page originally pointed at `images.leadconnectorhq.com`, which works right up until
 * Synamate is switched off and then silently takes both images with it. These are the brand's
 * own files, supplied by the founder, so they belong with the code: versioned, cached by the
 * CDN, and with no third party in the path.
 *
 * The media LIBRARY (Supabase Storage) is for content someone uploads later; a page's own logo
 * and hero still are build assets, and giving them a storage dependency would only add a way for
 * them to go missing.
 */
const LOGO_URL = "/media/b2-logo.png";
const HERO_IMAGE_URL = "/media/ameen-hero.webp";
const CTA_LABEL = "Apply for Guided Mode →";

/**
 * The CTAs and the hero still open a FORM POPUP rather than navigating — this is what the live
 * Synamate page does, and it is the difference between a visitor who is captured on the page they
 * landed on and one who is asked to make a second decision (following a link) before giving you
 * anything at all.
 *
 * Wired by slug at run time, because the form is a row someone created in the Forms section and
 * this file cannot know its id. Every node that should raise the popup carries `POPUP_MARKER`
 * below; `main()` swaps it for the real id, or strips it and leaves the plain link if no such
 * form is published yet. A marker rather than matching on labels or node ids: it says which nodes
 * are meant to do this, in the place where they are defined.
 */
const POPUP_FORM_SLUG = process.env.TRAINING_PAGE_FORM_SLUG ?? "apply-guided-mode";
const POPUP_MARKER = "__popup_form__";
const POPUP_TITLE = "See exactly why German companies ignore your applications.";
const POPUP_SUBTITLE = "20 minutes. Free. Changes everything.";
const popupProps = { opensFormId: POPUP_MARKER, modalTitle: POPUP_TITLE, modalSubtitle: POPUP_SUBTITLE };
/** The Synamate CTA scrolls to the booking form. Ours points at the in-house booking page. */
const CTA_HREF = "/book";

let seq = 0;
const id = (p: string) => `${p}-${(++seq).toString(36)}`;

// ── node helpers, so the page below reads as structure rather than as object soup ──
/** `width` caps the CONTENT inside the band, not the band — the original's cards sit in 860px. */
const section = (background: Block["background"], children: Block[], pad = 72, width = 1080): Block => ({
  id: id("sec"), type: "section", background, children,
  style: { padding: [pad, 0, pad, 0], maxWidth: width },
  styleMobile: { padding: [40, 0, 40, 0] },
});
const row = (children: Block[], gap = 24): Block => ({ id: id("row"), type: "row", children, style: { gap } });
const col = (children: Block[], grow = 1): Block => ({ id: id("col"), type: "column", children, style: { grow } });
const card = (children: Block[]): Block => ({ id: id("card"), type: "card", children });
// Explicit sizes, not the app's type scale. The dashboard's `display-l` is sized for a data
// screen read at arm's length; a sales hero is the first thing on a cold visitor's phone and the
// original sets it far larger. Mobile drops it so the headline still fits three lines.
const h1 = (text: string): Block => ({
  id: id("h1"), type: "heading", text,
  style: { align: "center", fontSize: 60, lineHeight: 1.15 },
  styleMobile: { fontSize: 30 },
});
const h2 = (text: string, align: "left" | "center" = "center"): Block => ({ id: id("h2"), type: "subheading", text, style: { align } });
const eyebrow = (text: string, align: "left" | "center" = "center"): Block => ({ id: id("eb"), type: "eyebrow", text, style: { align } });
const p = (text: string, align: "left" | "center" = "center"): Block => ({ id: id("p"), type: "text", text, style: { align } });
const checks = (items: string[]): Block => ({ id: id("ul"), type: "bullets", items, variant: "check" });
const cta = (align: "left" | "center" = "center"): Block => ({
  // `href` is kept as the fallback: if the popup form is not published, the button still goes
  // somewhere useful rather than becoming decoration.
  id: id("cta"), type: "button", label: CTA_LABEL, href: CTA_HREF, variant: "primary", style: { align }, ...popupProps,
});
const stat = (text: string, label: string): Block => ({ id: id("st"), type: "stat", text, label, style: { align: "center" } });

const pill = (text: string, tone: NonNullable<Block["tone"]>, align: NonNullable<Block["align"]> = "center"): Block =>
  ({ id: id("pill"), type: "pill", text, tone, style: { align } });
const dashes = (items: string[]): Block => ({ id: id("dl"), type: "bullets", items, variant: "dash" });

/**
 * A testimonial as the original draws it: initials in a circle, name and role beside them, the
 * elapsed-days badge pushed to the right, then an italic quote and a labelled result.
 */
const testimonial = (initials: string, tone: NonNullable<Block["tone"]>, name: string, role: string, days: string, quote: string, result: string): Block =>
  card([
    row([
      col([{ id: id("av"), type: "avatar", text: initials, tone }], 0),
      col([
        { id: id("tn"), type: "text", text: name, style: { fontWeight: 700, color: "ink", fontSize: 15 } },
        { id: id("tr"), type: "text", text: role, style: { fontSize: 12, color: "ink-3" } },
      ], 3),
      col([pill(days, "green", "right")], 0),
    ], 12),
    { id: id("tq"), type: "text", text: quote, style: { fontSize: 13.5, lineHeight: 1.65, color: "ink-2", italic: true } },
    // A rule between the quote and the result, as on the original — it separates what the student
    // said from what actually happened, which are two different kinds of claim.
    { id: id("thr"), type: "divider" },
    { id: id("trl"), type: "text", text: "RESULT", style: { fontSize: 10, fontWeight: 700, letterSpacing: 1, color: "ink-3" } },
    { id: id("tres"), type: "text", text: result, style: { fontWeight: 600, fontSize: 13.5, color: "ink" } },
  ]);

/** One curriculum phase — a full-width card, as on the original, not a third of a row. */
const phase = (label: string, tone: NonNullable<Block["tone"]>, weeks: string, title: string, items: string[]): Block =>
  card([
    pill(label, tone, "left"),
    { id: id("pw"), type: "text", text: weeks, style: { fontSize: 12, color: "ink-3" } },
    { id: id("pt"), type: "subheading", text: title, style: { align: "left", fontSize: 21 } },
    dashes(items),
  ]);

/** One of the six "everything included" tiles: a bold title over a grey explanatory line. */
const perk = (title: string, detail: string): Block =>
  card([
    row([
      col([{ id: id("dot"), type: "dot", tone: "blue" }], 0),
      col([
        { id: id("pk"), type: "text", text: title, style: { fontWeight: 700, fontSize: 14.5, color: "#111827", align: "left" } },
        { id: id("pd"), type: "text", text: detail, style: { fontSize: 13, color: "#6b7280", align: "left", lineHeight: 1.55 } },
      ]),
    ], 10),
  ]);

/** A stat in the dark band: bordered box, transparent fill, so it reads as a chip not a card. */
const statBox = (figure: string, label: string): Block => ({
  id: id("sb"), type: "card",
  style: { background: "rgba(255,255,255,.06)", borderWidth: 1, borderColor: "rgba(255,255,255,.25)", radius: 12, padding: [14, 18, 14, 18] },
  children: [stat(figure, label)],
});

const BLOCKS: Block[] = [
  // 1 ── header
  // The logo is a 1199px asset. Uncapped it filled the whole first screen and pushed the headline
  // below the fold; the original renders it as a small header mark.
  section("plain", [{ id: id("logo"), type: "image", url: LOGO_URL, alt: "B2 Consultants", style: { maxWidth: 104 } }], 24),

  // 2 ── hero
  section("plain", [
    h1("Your First German Interview Call. In 90 days."),
    { id: id("sub"), type: "text", text: "250+ professionals. 9 countries. One outcome - a German interview call.\nDon't get one in 90 days? We keep working. Free.", style: { align: "center", fontSize: 18, color: "ink" } },
    row([
      // An IMAGE, not a video: the original shows a play-button still and the real video is on the
      // next step. A video element here would embed an empty iframe.
      col([{ id: id("hero-img"), type: "image", url: HERO_IMAGE_URL, alt: "Watch the training", style: { radius: 10 }, ...popupProps }], 1.15),
      col([
        { id: id("hh"), type: "subheading", text: "This program is ONLY for IT & Mechanical professionals who...", style: { align: "left", fontSize: 19 } },
        checks([
          "have 2+ years of experience but get zero replies from German companies",
          "have sent 50+ applications and heard nothing back",
          "don't know what is broken and want someone to fix it",
        ]),
        cta("left"),
      ]),
    ], 32),
  ]),

  // 3 ── social proof
  section("muted", [
    eyebrow("Real students. Real results."),
    h2("They were exactly where you are now."),
    p("Zero callbacks. Ignored applications. No idea what was wrong."),
    row([
      col([testimonial("BK", "blue", "Baby Karuppusamy", "IT Professional", "27 days", "\"I received an interview call shortly after updating my resume. The feedback really helped me present my profile more effectively.\"", "Interview call in 27 days")]),
      col([testimonial("MA", "orange", "Mohana Adithyan", "IT Professional", "20 days", "\"In 20 days I had my first German interview. The manager said my profile looked promising. I cleared Round 1 and made it to Round 2.\"", "First German interview in 20 days. Cleared Round 1.")]),
    ]),
    row([
      col([testimonial("KG", "green", "Kanakaraj Gurusamy", "IT Professional", "33 days", "\"I optimized my resume, cleared ATS, and received a reply asking for documents for the next interview stage. First positive response I have ever received.\"", "ATS cleared. Moved to next interview stage in 33 days.")]),
      col([testimonial("RR", "violet", "Raja Ramaraj", "Senior Software Test Engineer · Berlin", "45 days", "\"Applied on the weekend. Interview invite on Monday. It was not just editing documents — it was a strategic conversation about positioning myself in a competitive market.\"", "Interview scheduled in 45 days. Now based in Berlin.")]),
    ]),
    { id: id("skool"), type: "text", text: "These are real posts from our Skool community. Unedited.", style: { align: "center", fontSize: 12.5, color: "ink-3" } },
  ], 72, 900),

  // 4 ── guarantee
  // The headline is TWO nodes, not one: the original sets "The Interview or" in ink and
  // "We Don't Give Up." in brand blue. Colouring part of a single string would need inline rich
  // text, which the node model deliberately does not have.
  section("plain", [
    pill("Our Guarantee", "amber"),
    { id: id("g1"), type: "subheading", text: "The Interview or", style: { align: "center", fontSize: 30 } },
    { id: id("g2"), type: "subheading", text: "We Don't Give Up.", style: { align: "center", fontSize: 30, color: "primary-strong" } },
    p("Complete every milestone. Do the work. If you still don't get a single German interview call in 90 days — we keep coaching you. Free. Until you do."),
    {
      id: id("gbox"), type: "card",
      style: { background: "surface-2", borderWidth: 1, borderColor: "line", radius: 14, padding: [22, 24, 22, 24] },
      children: [
        { id: id("gl"), type: "eyebrow", text: "What this means for you", style: { align: "left" } },
        checks([
          "No refund games. We don't give your money back and disappear. We stay until the job is done.",
          "We keep working. Free. Extended coaching at zero extra cost until you land your first German interview call.",
          "One condition. You must complete all milestones — applications, weekly check-ins, and follow-ups. The guarantee is for doers, not watchers.",
        ]),
      ],
    },
    { id: id("gfine"), type: "text", text: "This guarantee applies to students who complete all program milestones within the 90-day sprint. Extended support continues for up to 12 months from program start date.", style: { align: "center", fontSize: 12, color: "ink-3" } },
  ], 72, 820),

  // 5 ── curriculum
  section("muted", [
    eyebrow("What you get"),
    h2("1 month of coaching. 90 days of execution."),
    p("A step-by-step system built for the German job market. Not theory. Real work."),
    phase("Phase 1 · Week 1–2", "blue", "Weeks 1 & 2", "Building Your Foundation", [
      "German format resume built live — English and German",
      "LinkedIn and Xing profiles optimized for the German market",
      "Your master resume template ready to use",
    ]),
    phase("Phase 2 · Week 3", "orange", "Week 3", "Approaching the German Market", [
      "Hidden job market strategy — make German employers come to you",
      "OIC framework — optimize, implement, convert applications to calls",
      "Live job application deep dive with a selected student",
      "Mid-week QnA to review your execution",
    ]),
    phase("Phase 3 · Week 4 + Sprint", "green", "Week 4 onwards", "Execution & 90-Day Sprint", [
      "3-day execution kickoff using all frameworks",
      "Interview preparation — process, types, do's and don'ts",
      "Weekly targets set by your mentor",
      "Weekly progress tracking — green, yellow or red flags",
    ]),
    { id: id("inc"), type: "subheading", text: "Everything included for 1 full year", style: { align: "center", fontSize: 19 } },
    row([
      col([perk("24 live QnA calls", "2x per month directly with Ameen and team for 12 months")]),
      col([perk("5 mock interview sessions", "30-minute sessions scheduled before your real interviews")]),
      col([perk("Unlimited resume reviews", "Submit anytime during your 1-year program")]),
    ], 16),
    row([
      col([perk("All session recordings", "Every class and QnA recording available for 1 year")]),
      col([perk("Lifetime Skool + WhatsApp access", "Peer learning, accountability partners, seniors and experts in your domain")]),
      col([perk("Green-Yellow-Red tracking system", "We monitor your sprint weekly and pull you back if you fall off track")]),
    ], 16),
    { id: id("cnote"), type: "text", text: "This is a group coaching program. Every session is live. Every framework is built for the German market specifically.", style: { align: "center", fontSize: 12.5, color: "ink-3" } },
  ], 72, 900),

  // 6 ── stats + closing CTA (the navy band)
  section("dark", [
    pill("★ Next batch filling now", "navy"),
    { id: id("d1"), type: "subheading", text: "Your first German interview call.", style: { align: "center", fontSize: 30 } },
    { id: id("d2"), type: "subheading", text: "In 90 days.", style: { align: "center", fontSize: 30, color: "#fbbf24" } },
    p("We take fewer than 9 students per batch. Every student gets real attention. Once the batch is full — it is full."),
    row([
      col([statBox("< 9", "Students per batch")]),
      col([statBox("90", "Day sprint")]),
      col([statBox("200+", "Students coached")]),
    ], 16),
    { id: id("dcta"), type: "button", label: CTA_LABEL, href: CTA_HREF, variant: "accent", style: { align: "center" }, ...popupProps },
    { id: id("dnote"), type: "text", text: "Watch a short video first. Then book your call.", style: { align: "center", fontSize: 12.5 } },
  ], 72, 820),

  // 7 ── footer
  section("plain", [
    { id: id("fc"), type: "text", text: "© B2 Consultants 2026", style: { align: "center", fontSize: 12, color: "ink-3" } },
    { id: id("fl"), type: "text", text: "Privacy Policy · Terms", style: { align: "center", fontSize: 12, color: "ink-3" } },
  ], 28),
];

/**
 * Swap the popup marker for the real form id, or strip it so the CTA falls back to its link.
 * Returns how many nodes were wired — 0 with a warning is the honest outcome when the form has
 * not been published, and is much better than a page of buttons that open an empty dialog.
 */
function resolvePopup(list: Block[], formId: string | null): number {
  let n = 0;
  for (const b of list) {
    if (b.opensFormId === POPUP_MARKER) {
      if (formId) {
        b.opensFormId = formId;
        n++;
      } else {
        delete b.opensFormId;
        delete b.modalTitle;
        delete b.modalSubtitle;
      }
    }
    n += resolvePopup(b.children ?? [], formId);
  }
  return n;
}

async function main() {
  const popupForm = await prisma.form.findFirst({
    where: { slug: POPUP_FORM_SLUG, published: true },
    select: { id: true, name: true },
  });
  const wired = resolvePopup(BLOCKS, popupForm?.id ?? null);

  const funnel = await prisma.funnel.upsert({
    where: { slug: "vsl-funnel" },
    create: { name: "VSL Funnel", slug: "vsl-funnel", published: false },
    update: {},
    select: { id: true, name: true, published: true },
  });

  const step = await prisma.funnelStep.upsert({
    where: { funnelId_slug: { funnelId: funnel.id, slug: "landing" } },
    create: {
      funnelId: funnel.id,
      name: "Landing",
      slug: "landing",
      position: 0,
      blocks: BLOCKS as unknown as object,
      seoTitle: "Your First German Interview Call. In 90 days. | B2 Consultants",
      seoDescription: "250+ professionals. 9 countries. One outcome - a German interview call. Don't get one in 90 days? We keep working. Free.",
    },
    update: { blocks: BLOCKS as unknown as object },
    select: { id: true, name: true },
  });

  const count = (list: Block[]): number => list.reduce((n, b) => n + 1 + count(b.children ?? []), 0);
  console.log(`Funnel "${funnel.name}" · step "${step.name}"`);
  console.log(`  ${BLOCKS.length} sections, ${count(BLOCKS)} nodes total`);
  console.log(`  → /p/vsl-funnel/landing  (funnel is ${funnel.published ? "published" : "a DRAFT — publish it to serve publicly"})`);
  if (wired) console.log(`  ${wired} CTAs open the "${popupForm?.name}" popup on click`);
  else console.log(`  ⚠ no published form with slug "${POPUP_FORM_SLUG}" — CTAs link to ${CTA_HREF} instead of opening a popup.\n    Publish that form (or set TRAINING_PAGE_FORM_SLUG) and re-run.`);
  if (!HERO_IMAGE_URL) console.log(`  ⚠ hero image is empty — set it in the builder: Landing → hero row → left column → Image.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
