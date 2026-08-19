import type { Block } from "./sites-types";

/**
 * The starter content behind the section library and the page templates.
 *
 * ── Why this lives in code and is seeded, rather than being read from here at runtime ─────────
 * A built-in is a `SectionSnippet` row like any other, so the picker has ONE source, snippets the
 * team saves sort alongside the shipped ones, and a built-in can be edited after insertion
 * without anything special happening. What `builtIn` buys is only that the delete button is
 * withheld - you cannot empty the library by tidying it.
 *
 * The definitions live here because they are content we author and want in review and in git,
 * not rows someone typed into a production database once.
 *
 * ── Why the copy is real ──────────────────────────────────────────────────────────────────────
 * Lorem ipsum in a page template gets shipped. The strings below are B2's actual proposition,
 * so a section dropped onto a page and left alone still reads as this business - and the parts
 * that MUST be changed (a form to pick, a video to point at) are left visibly empty instead.
 */

let seq = 0;
/** Ids here are placeholders - every insert re-generates them, so two copies cannot collide. */
const nid = (p: string) => `${p}${(seq++).toString(36)}`;

const section = (background: Block["background"], children: Block[], pad = 72): Block => ({
  id: nid("sec"), type: "section", background, children,
  style: { padding: [pad, 0, pad, 0], maxWidth: 1080 },
  styleMobile: { padding: [40, 0, 40, 0] },
});
const row = (children: Block[], gap = 28): Block => ({ id: nid("row"), type: "row", children, style: { gap } });
const col = (children: Block[], grow = 1): Block => ({ id: nid("col"), type: "column", children, style: { grow, gap: 14 } });
const card = (children: Block[]): Block => ({
  id: nid("card"), type: "card", children,
  style: { padding: [28, 28, 28, 28], radius: 16, shadow: "card", gap: 10 },
});
const h = (text: string, fontSize = 46): Block => ({
  id: nid("h"), type: "heading", text,
  style: { align: "center", fontSize, lineHeight: 1.15, fontWeight: 800 },
  styleMobile: { fontSize: Math.round(fontSize * 0.62) },
});
const sub = (text: string): Block => ({
  id: nid("sub"), type: "subheading", text, style: { align: "center", fontSize: 24, lineHeight: 1.35 },
  styleMobile: { fontSize: 19 },
});
const p = (text: string, align: "left" | "center" = "center"): Block => ({
  id: nid("p"), type: "text", text, style: { align, fontSize: 17, lineHeight: 1.65 },
});
const eyebrow = (text: string): Block => ({
  id: nid("eb"), type: "eyebrow", text,
  style: { align: "center", fontSize: 13, fontWeight: 700, letterSpacing: 1.5 },
});
const pill = (text: string, tone: Block["tone"] = "amber"): Block => ({ id: nid("pill"), type: "pill", text, tone, style: { align: "center" } });
const cta = (label: string, href = "/book", variant: Block["variant"] = "primary"): Block => ({
  id: nid("cta"), type: "button", label, href, variant, style: { align: "center" },
});
const bullets = (items: string[]): Block => ({ id: nid("bl"), type: "bullets", items, variant: "check", style: { fontSize: 17, lineHeight: 1.9 } });
const stat = (text: string, label: string): Block => ({ id: nid("st"), type: "stat", text, label, style: { align: "center" } });
const spacer = (size: number): Block => ({ id: nid("sp"), type: "spacer", size });

/** A form node with NO form chosen - the author picks one, and an unset embed renders as a
 *  visible placeholder rather than as a silently missing opt-in. */
const formSlot = (): Block => ({ id: nid("form"), type: "form" });

const testimonial = (quote: string, name: string, initials: string, tone: Block["tone"]): Block =>
  card([
    { id: nid("av"), type: "avatar", text: initials, tone },
    { id: nid("q"), type: "text", text: quote, style: { align: "left", fontSize: 16, lineHeight: 1.7, italic: true } },
    { id: nid("nm"), type: "text", text: name, style: { align: "left", fontSize: 14, fontWeight: 700 } },
  ]);

export type SnippetSeed = {
  name: string;
  category: string;
  scope: "SECTION" | "PAGE";
  blocks: Block[];
};

// ─────────────────────────── Sections ───────────────────────────

const SECTIONS: SnippetSeed[] = [
  {
    name: "Hero - headline and CTA",
    category: "Hero",
    scope: "SECTION",
    blocks: [section("plain", [
      eyebrow("FOR EXPERIENCED PROFESSIONALS"),
      h("Land a role in Germany - with a plan, not a job board"),
      sub("One-to-one coaching that takes you from CV to signed offer."),
      spacer(12),
      cta("Apply for Guided Mode →"),
      p("Free 30-minute call · No obligation"),
    ], 88)],
  },
  {
    name: "Hero - copy beside a form",
    category: "Hero",
    scope: "SECTION",
    blocks: [section("plain", [
      row([
        col([
          { id: nid("h"), type: "heading", text: "Get the Germany relocation roadmap", style: { align: "left", fontSize: 44, lineHeight: 1.15, fontWeight: 800 }, styleMobile: { fontSize: 30 } },
          p("Where the jobs are, what a German CV has to show, and the visa route that fits your profile.", "left"),
          bullets(["A CV that passes the first screen", "Which visa applies to you", "What the market pays for your role"]),
        ], 1.2),
        col([card([
          { id: nid("fh"), type: "subheading", text: "Send it to me", style: { align: "center", fontSize: 21 } },
          formSlot(),
        ])], 1),
      ]),
    ], 72)],
  },
  {
    name: "Video / VSL band",
    category: "Hero",
    scope: "SECTION",
    blocks: [section("muted", [
      h("Watch this before you apply", 38),
      p("12 minutes. It explains exactly how the programme works and who it is not for."),
      spacer(20),
      { id: nid("vid"), type: "video", url: "", alt: "Programme walkthrough" },
      spacer(20),
      cta("I'm ready - book my call →"),
    ], 72)],
  },
  {
    name: "What you get - checklist",
    category: "Body",
    scope: "SECTION",
    blocks: [section("plain", [
      h("What working together looks like", 38),
      spacer(16),
      row([
        col([bullets(["Positioning built around your actual experience", "A CV and LinkedIn rewritten for German recruiters", "Company shortlist, not a job-board scroll"])]),
        col([bullets(["Interview practice with real feedback", "Offer and salary negotiation support", "Visa and relocation paperwork walked through"])]),
      ]),
    ], 72)],
  },
  {
    name: "Proof - three stats",
    category: "Social proof",
    scope: "SECTION",
    blocks: [section("muted", [
      eyebrow("THE RECORD SO FAR"),
      spacer(20),
      row([col([stat("200+", "Professionals coached")]), col([stat("27", "Days to first interview, on average")]), col([stat("€68k", "Median offer accepted")])]),
    ], 64)],
  },
  {
    name: "Testimonials - three cards",
    category: "Social proof",
    scope: "SECTION",
    blocks: [section("plain", [
      h("What they said afterwards", 38),
      spacer(24),
      row([
        col([testimonial("I had been applying for eight months with nothing. Three weeks after we rewrote the CV I had two interviews.", "Priya S. - Data Engineer", "PS", "blue")]),
        col([testimonial("The salary conversation alone paid for the programme several times over.", "Rahul M. - Product Manager", "RM", "green")]),
        col([testimonial("What I actually needed was to stop guessing. The plan removed all of it.", "Anjali K. - QA Lead", "AK", "orange")]),
      ]),
    ], 72)],
  },
  {
    name: "Guarantee band",
    category: "Closing",
    scope: "SECTION",
    blocks: [section("plain", [
      pill("OUR GUARANTEE"),
      spacer(12),
      sub("Do the work and you will get interviews - or we keep coaching you, free, until you do."),
    ], 56)],
  },
  {
    name: "Closing CTA - dark band",
    category: "Closing",
    scope: "SECTION",
    blocks: [section("dark", [
      h("There are a limited number of places each month", 36),
      p("The call is free and it is a real conversation - we will tell you if this is not the right fit."),
      spacer(20),
      cta("Book my free call →", "/book", "accent"),
    ], 80)],
  },
  {
    name: "Header - logo bar",
    category: "Header & footer",
    scope: "SECTION",
    blocks: [section("plain", [
      row([
        col([{ id: nid("logo"), type: "image", url: "/media/b2-logo.png", alt: "B2 Consultants", style: { align: "left" } }], 1),
        col([cta("Book a call", "/book", "outline")], 1),
      ]),
    ], 18)],
  },
  {
    name: "Footer - legal strip",
    category: "Header & footer",
    scope: "SECTION",
    blocks: [section("muted", [
      { id: nid("div"), type: "divider" },
      spacer(16),
      p("© B2 Consultants · Imprint · Privacy policy · Terms"),
      { id: nid("fp"), type: "text", text: "This site is not part of Facebook or Meta Platforms, Inc.", style: { align: "center", fontSize: 13 } },
    ], 32)],
  },
];

// ─────────────────────────── Page templates ───────────────────────────

const PAGES: SnippetSeed[] = [
  {
    name: "Opt-in page",
    category: "Lead capture",
    scope: "PAGE",
    blocks: [
      ...SECTIONS[1].blocks,
      ...SECTIONS[4].blocks,
      ...SECTIONS[7].blocks,
    ],
  },
  {
    name: "VSL page",
    category: "Lead capture",
    scope: "PAGE",
    blocks: [
      ...SECTIONS[0].blocks,
      ...SECTIONS[2].blocks,
      ...SECTIONS[3].blocks,
      ...SECTIONS[5].blocks,
      ...SECTIONS[6].blocks,
      ...SECTIONS[7].blocks,
    ],
  },
  {
    name: "Booking / application page",
    category: "Booking",
    scope: "PAGE",
    blocks: [
      section("plain", [
        eyebrow("STEP 2 OF 2"),
        h("Pick a time that suits you", 40),
        p("The call runs 30 minutes. Come with your CV open and a shortlist of roles you have been going for."),
        spacer(24),
        card([formSlot()]),
      ], 72),
      ...SECTIONS[5].blocks,
    ],
  },
  {
    name: "Thank-you page",
    category: "Booking",
    scope: "PAGE",
    blocks: [
      section("plain", [
        pill("YOU'RE BOOKED", "green"),
        spacer(16),
        h("That's confirmed - check your inbox", 40),
        p("The invitation is on its way, with a calendar link and the joining details."),
        spacer(24),
        card([
          { id: nid("nh"), type: "subheading", text: "Before we speak", style: { align: "left", fontSize: 20 } },
          bullets(["Have your current CV to hand", "Note the three roles you most want", "Be somewhere you can talk for half an hour"]),
        ]),
        spacer(24),
        p("Something come up? Reply to the email and we will move it."),
      ], 88),
    ],
  },
];

export const BUILT_IN_SNIPPETS: SnippetSeed[] = [...SECTIONS, ...PAGES];
