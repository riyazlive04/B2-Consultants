/**
 * Rebuild the b2consultants HOME page from the client's 2026 redesign of b2consultants.de.
 *
 *   node --env-file=.env scripts/rebuild-b2-home.mjs           # dry run: prints what it would do
 *   node --env-file=.env scripts/rebuild-b2-home.mjs --apply   # write it
 *
 * ── What this replaces, and what it leaves alone ──────────────────────────────────────────────
 * The client rewrote the copy AND the design: the 2025 site was violet (#4949ef) in Montserrat and
 * Raleway with a portrait hero; the new one is navy (#0d1b3e) and red (#e63946) in Inter, built
 * from card grids. So this rewrites the site THEME and the shared header/footer as well as the "/"
 * page - a page in the new design under the old theme would be neither.
 *
 * The other four pages (/aboutus, /career, /privacy, /terms) are untouched. They are unpublished
 * and were never part of what /s/b2consultants serves; `scripts/rebuild-b2-site.mjs` still builds
 * them, in the OLD design. Do not run that script against this site any more - it would put the
 * violet theme, the old nav and the old home page back.
 *
 * ── Where the values come from ────────────────────────────────────────────────────────────────
 * Copy is lifted verbatim from the live page's markup, not retyped from a screenshot. Colours,
 * type sizes and radii are read out of the page's own stylesheet, e.g.
 *     .hero-section-a8f3   linear-gradient(165deg,#0a1628 0%,#0d1b3e 40%,#132952 100%)
 *     .section-title-s2t4  40px / 900 / #0d1b3e / -1px
 *     .step-card-v5w7      #fff, radius 16, 1px #eef0f4
 *     body                 Inter
 *
 * ── The four places this is deliberately NOT a pixel copy ─────────────────────────────────────
 * 1. Display type is one size, not two. The renderer has no per-breakpoint font size, so each
 *    headline takes a value between the live desktop and mobile sizes (title 40/30 -> 34). The
 *    hero sets no size at all, because the renderer's own default is already 40px phone / 52px
 *    desktop - which is the live page's own pair.
 * 2. The two "Learn more" / "Read all success stories" links are dropped. On the live page they
 *    point at #programs-page and #success-stories, neither of which exists in the document - they
 *    are dead anchors, and reproducing them as real-looking links would be worse than the CTA
 *    that already sits under each grid.
 * 3. The footer's legal links point at b2consultants.de. Our own /privacy and /terms exist but are
 *    unpublished, so linking them internally would 404 for every visitor. Repoint them the moment
 *    those pages are published.
 * 4. Step numbers and the founder portrait panel are numerals and a tinted panel, not the circular
 *    badge and the 4:5 image frame the live page draws. A circle around one block is the one thing
 *    the block model cannot express, and the live page's own portrait is a placeholder anyway.
 */

import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const prisma = new PrismaClient();

// ── Palette, read from the live stylesheet ────────────────────────────────────
const NAVY = "#0d1b3e";
const NAVY_DEEP = "#070e1f";
const RED = "#e63946";
const INK = "#0d1b3e";
const MUTED = "#5a6170";
const BODY = "#3a3f4b";
const FAINT = "#8a919e";
const TINT = "#f8f9fb";
const LINE = "#eef0f4";
const DARK_BAND = "linear-gradient(165deg,#0a1628 0%,#0d1b3e 50%,#132952 100%)";
const ON_DARK = "rgba(255,255,255,0.72)";
const ON_DARK_FAINT = "rgba(255,255,255,0.45)";

const OPTIN = "https://optin.b2consultants.de/lp";
const LOGO = "/media/b2-logo-white.png";
/**
 * Where the logo links, and the one value in this file that is about the STAGING url rather than
 * the design: the site is served under /s/b2consultants until DNS is cut over, so "/" here is the
 * dashboard. Change this to "/" on the day b2consultants.de points at this app.
 */
const SITE_ROOT = "/s/b2consultants";

export const THEME = {
  primary: RED,
  onPrimary: "#ffffff",
  background: "#ffffff",
  text: INK,
  textMuted: MUTED,
  // The live page loads exactly one family and sets it on <body> for everything.
  headingFont: "Inter, sans-serif",
  bodyFont: "Inter, sans-serif",
  radius: 8,
  contentWidth: 1120,
};

/**
 * The header menu.
 *
 * Every item is an on-page anchor, which is what the live header does too. It is also the only
 * honest option here: "/" is the only PUBLISHED page on this site, so a menu of page links would
 * be a menu of 404s.
 */
export const NAV = [
  { label: "About Us", href: "#about" },
  { label: "Programs", href: "#programs" },
  { label: "Success Stories", href: "#success" },
  { label: "Contact", href: "#contact" },
];

// ── Small builders, so a card costs a line and not thirty ─────────────────────
const sec = (id, name, o) => ({
  id,
  name,
  width: "full",
  background: o.bg ?? { kind: "none" },
  padding: o.pad,
  ...(o.anchor ? { anchor: o.anchor } : {}),
  columns: o.columns,
  ...(o.columnStyles ? { columnStyles: o.columnStyles } : {}),
});
const color = (c) => ({ kind: "color", color: c });
const gradient = (css) => ({ kind: "gradient", css });

const text = (id, t, style, o = {}) => ({ id, type: "text", text: t, style, ...o });
const title = (id, t, style, o = {}) => ({ id, type: "subheading", text: t, style, ...o });
const spacer = (id, size) => ({ id, type: "spacer", size });

/** The red uppercase kicker above every section title. */
const kicker = (id, t) =>
  text(id, t, { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2.5 }, {
    align: "center",
    color: RED,
  });

/** A section title. 34px is the midpoint of the live page's 40 desktop / 30 phone pair. */
const sectionTitle = (id, t, accent) =>
  title(id, t, { fontSize: 34, fontWeight: 800, letterSpacing: -1, lineHeight: 1.2, maxWidth: 780 }, {
    align: "center",
    color: INK,
    ...(accent ? { accentText: accent, accentColor: RED } : {}),
  });

const sectionSub = (id, t) =>
  text(id, t, { fontSize: 17, lineHeight: 1.6, maxWidth: 660 }, { align: "center", color: MUTED });

const cta = (id, text_) => ({
  id,
  type: "button",
  label: text_,
  href: OPTIN,
  // Without this, every opt-in the page produces arrives with no idea which page produced it.
  forwardParams: true,
  newTab: true,
  align: "center",
  color: "#ffffff",
  style: { background: RED, radius: 8, fontSize: 18, fontWeight: 700 },
});

/** A tinted card on a white band - the problem grid and the differentiators. */
const CARD_TINT = {
  background: TINT,
  padding: [32, 30, 32, 30],
  radius: 14,
  borderWidth: 1,
  borderColor: LINE,
  gap: 10,
};
/** A white card on a tinted band - the steps and the testimonials. */
const CARD_WHITE = {
  background: "#ffffff",
  padding: [36, 30, 36, 30],
  radius: 16,
  borderWidth: 1,
  borderColor: LINE,
  shadow: "card",
  gap: 12,
};
/** A card on the navy band - the founder's credentials. */
const CARD_DARK = {
  background: "rgba(255,255,255,0.04)",
  padding: [18, 18, 18, 18],
  radius: 10,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.07)",
  gap: 8,
};

/** icon + bold title + description: the shape of nearly every card on this page. */
const iconCard = (p, icon, heading, desc, o = {}) => [
  text(`${p}-i`, icon, { fontSize: 30, lineHeight: 1 }, { align: o.align }),
  title(`${p}-t`, heading, { fontSize: 19, fontWeight: 800, letterSpacing: -0.3 }, {
    align: o.align,
    color: o.ink ?? INK,
  }),
  text(`${p}-d`, desc, { fontSize: 15, lineHeight: 1.7 }, { align: o.align, color: o.muted ?? MUTED }),
];

// ── Shared header / footer ────────────────────────────────────────────────────
export const HEADER = [
  sec("hdr", "Header", {
    bg: color(NAVY),
    pad: [14, 14],
    // A logo, a five-item menu and a button. Equal thirds wrap the menu onto a second line.
    columnStyles: [{ grow: 1 }, { grow: 2.4 }, { grow: 1.6 }],
    columns: [
      [{ id: "hdr-logo", type: "logo", url: LOGO, alt: "B2 Consultants", href: SITE_ROOT, width: 48, height: 48 }],
      [{ id: "hdr-nav", type: "nav", align: "center", style: { fontSize: 14, fontWeight: 500 } }],
      [
        {
          id: "hdr-cta",
          type: "button",
          label: "Book a Free Discovery Call",
          href: OPTIN,
          forwardParams: true,
          newTab: true,
          align: "right",
          color: "#ffffff",
          style: { background: RED, radius: 6, fontSize: 14, fontWeight: 600 },
        },
      ],
    ],
  }),
];

export const FOOTER = [
  // `anchor: "contact"` is what the header's Contact item scrolls to - on the live site Contact is
  // the footer, not a page.
  sec("ftr", "Footer", {
    bg: color(NAVY_DEEP),
    pad: [56, 28],
    anchor: "contact",
    columns: [
      [
        { id: "ftr-logo", type: "logo", url: LOGO, alt: "B2 Consultants", href: SITE_ROOT, width: 52, height: 52 },
        text("ftr-tag", "Helping IT and Mechanical professionals build real careers in Germany.",
          { fontSize: 14, lineHeight: 1.7 }, { color: "rgba(255,255,255,0.5)" }),
        text("ftr-mail", "info@b2consultants.de", { fontSize: 14 }, { color: "rgba(255,255,255,0.62)" }),
        text("ftr-wa", "WhatsApp: +91 72049 11304", { fontSize: 14 }, { color: "rgba(255,255,255,0.62)" }),
      ],
      [
        text("ftr-h1", "Navigate",
          { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 },
          { color: "#ffffff" }),
        {
          id: "ftr-l1",
          type: "footerLinks",
          items: ["About Us|#about", "Programs|#programs", "Success Stories|#success"],
        },
      ],
      [
        text("ftr-h2", "Programs",
          { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 },
          { color: "#ffffff" }),
        {
          id: "ftr-l2",
          type: "footerLinks",
          items: ["Self Program|#programs", "Guided Program|#programs", "Elite Program|#programs"],
        },
      ],
      [
        text("ftr-h3", "Connect",
          { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 },
          { color: "#ffffff" }),
        {
          id: "ftr-l3",
          type: "footerLinks",
          // See note 3 at the top of this file: our own copies of these are not published yet.
          items: [
            "Career|https://b2consultants.de/career",
            "Privacy Policy|https://b2consultants.de/privacypolicy",
            "Terms of Service|https://b2consultants.de/termsofservice",
          ],
        },
      ],
    ],
  }),
  sec("ftr-bottom", "Footer bottom", {
    bg: color(NAVY_DEEP),
    pad: [0, 28],
    columns: [[
      { id: "ftr-rule", type: "divider" },
      text("ftr-copy", "© 2026 B2 Consultants. All rights reserved. | b2consultants.de",
        { fontSize: 13 }, { align: "center", color: "rgba(255,255,255,0.32)" }),
    ]],
  }),
];

// ── The home page ─────────────────────────────────────────────────────────────
//
// A band that carries a heading AND a grid is TWO sections: a section holds one grid, and its
// title has to span the full width above it rather than sit in the first cell. They share a
// background and meet on zero padding, so they read as one band.

const HERO = sec("hero", "Hero", {
  bg: gradient(DARK_BAND),
  pad: [104, 88],
  columns: [[
    {
      id: "hero-h",
      type: "heading",
      // No fontSize: the renderer's own 40px/52px pair is already the live page's pair, and it is
      // the only display type on the page that gets a phone size at all.
      text: "Helping IT and Mechanical professionals get ",
      accentText: "hired in Germany.",
      accentColor: RED,
      align: "center",
      style: { fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.15, maxWidth: 900 },
    },
    text("hero-sub", "For professionals with 2+ years of experience. Real interview calls. Real conversions.",
      { fontSize: 20, lineHeight: 1.5, maxWidth: 820 }, { align: "center", color: "rgba(255,255,255,0.75)" }),
    spacer("hero-sp", 12),
    cta("hero-cta", "Book a Free Discovery Call"),
    text("hero-note", "No spam. No pressure. Just an honest conversation about your career.",
      { fontSize: 13 }, { align: "center", color: ON_DARK_FAINT }),
    spacer("hero-sp2", 12),
    text("hero-badges", "✓ No fake promises   ·   ✓ Real strategy, not generic advice   ·   ✓ Founded in Germany",
      { fontSize: 13, fontWeight: 500, lineHeight: 2 }, { align: "center", color: "rgba(255,255,255,0.6)" }),
  ]],
});

const stat = (p, n, plus, desc) => [
  text(`${p}-n`, n, { fontSize: 36, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }, {
    align: "center",
    color: INK,
    accentText: plus,
    accentColor: RED,
  }),
  text(`${p}-d`, desc, { fontSize: 14, fontWeight: 500, lineHeight: 1.4 }, { align: "center", color: MUTED }),
];
const STAT_TILE = { background: TINT, padding: [24, 16, 24, 16], radius: 12, borderWidth: 1, borderColor: LINE, gap: 8 };

const TRUST_HEAD = sec("trust-head", "Trust bar heading", {
  pad: [56, 32],
  columns: [[
    text("trust-l", "Trusted by Professionals Since 2017",
      { fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: 2.5 },
      { align: "center", color: FAINT }),
  ]],
});

const TRUST_GRID = sec("trust-grid", "Trust bar", {
  pad: [0, 56],
  columnStyles: [STAT_TILE, STAT_TILE, STAT_TILE, STAT_TILE],
  columns: [
    stat("t1", "350", "+", "Direct students coached and guided personally"),
    stat("t2", "10,000", "+", "Professionals reached through our content since 2017"),
    stat("t3", "14", "+", "Years of the founder living and working in Germany"),
    stat("t4", "100", "%", "Strategies based on real German hiring experience"),
  ],
});

const PROBLEM_HEAD = sec("problem-head", "Problem heading", {
  pad: [80, 40],
  columns: [[
    kicker("prob-k", "The Problem"),
    sectionTitle("prob-t", "Why most skilled professionals fail to get hired in Germany"),
    sectionSub("prob-s", "It is not about your skills. It is about your strategy. Most professionals make the same mistakes and never hear back from German companies."),
  ]],
});

const PROBLEM_1 = sec("problem-1", "Problem cards 1", {
  pad: [0, 32],
  columnStyles: [CARD_TINT, CARD_TINT],
  columns: [
    iconCard("p1", "❌", "Applying the wrong way",
      "Sending 100s of applications without understanding how German hiring works. Different country, different rules. What works in your country does not work in Germany."),
    iconCard("p2", "❌", "Resume that German companies ignore",
      "Generic-style CVs do not match German standards. German recruiters look for specific formats, specific details, and specific structures. Your resume is your first impression. Most get it wrong."),
  ],
});

const PROBLEM_2 = sec("problem-2", "Problem cards 2", {
  pad: [0, 80],
  columnStyles: [CARD_TINT, CARD_TINT],
  columns: [
    iconCard("p3", "❌", "No understanding of the German job market",
      "Which companies sponsor visas? Which cities have demand for your skills? Which job portals actually work? Without answers to these questions, you are searching blind."),
    iconCard("p4", "❌", "Following advice from people who never did it",
      "Taking guidance from consultants who have never worked in Germany, never faced a German interview, and never navigated the German system themselves. You deserve advice from someone who has done it."),
  ],
});

const step = (p, n, heading, desc) => [
  text(`${p}-n`, n, { fontSize: 44, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }, {
    align: "center",
    color: INK,
  }),
  title(`${p}-t`, heading, { fontSize: 20, fontWeight: 800, letterSpacing: -0.3 }, { align: "center", color: INK }),
  text(`${p}-d`, desc, { fontSize: 15, lineHeight: 1.7 }, { align: "center", color: MUTED }),
];

const HOW_HEAD = sec("how-head", "How it works heading", {
  bg: color(TINT),
  pad: [80, 40],
  columns: [[
    kicker("how-k", "How It Works"),
    sectionTitle("how-t", "Three steps to your German career"),
    sectionSub("how-s", "A clear, proven process. No confusion. No guesswork. Just a structured path from where you are to where you want to be."),
  ]],
});

const HOW_GRID = sec("how-grid", "How it works", {
  bg: color(TINT),
  pad: [0, 80],
  columnStyles: [CARD_WHITE, CARD_WHITE, CARD_WHITE],
  columns: [
    step("s1", "1", "Assess Your Profile",
      "We start with a deep analysis of your skills, experience, and qualifications. Not every profile is the same. We find your unique strengths and match them to real demand in the German market. Honest assessment. No false hopes."),
    step("s2", "2", "Coach You the German Strategies",
      "We teach you exactly how German hiring works. Resume in the German format. LinkedIn strategies that attract German recruiters. Interview preparation for the German style. Every detail, covered."),
    step("s3", "3", "Get Hired in Germany",
      "You start receiving real interview calls from real German companies. Our students do not just get replies. They get offers. We support you until you hold your job contract in hand."),
  ],
});

/**
 * A program's feature list.
 *
 * A `text` block with newlines rather than `bullets`: the live page marks each line with a tick,
 * and `bullets` can only draw a disc - a ticked list rendered with discs is a list with two
 * markers on every row.
 */
const features = (id, items) =>
  text(id, items.map((i) => `✓  ${i}`).join("\n"), { fontSize: 14, lineHeight: 2.1 }, { color: BODY });

const program = (p, tier, name, desc, items, badge) => [
  ...(badge
    ? [text(`${p}-b`, badge, { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 },
        { color: RED })]
    : []),
  text(`${p}-tier`, tier, { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2 },
    { color: RED }),
  title(`${p}-n`, name, { fontSize: 26, fontWeight: 800, letterSpacing: -0.5 }, { color: INK }),
  text(`${p}-d`, desc, { fontSize: 15, lineHeight: 1.7 }, { color: MUTED }),
  features(`${p}-f`, items),
];

const PROGRAM_CARD = {
  background: "#ffffff",
  padding: [40, 30, 36, 30],
  radius: 16,
  borderWidth: 2,
  borderColor: LINE,
  gap: 12,
};
const PROGRAM_CARD_FEATURED = {
  ...PROGRAM_CARD,
  background: "linear-gradient(180deg,#ffffff 0%,#fff5f5 100%)",
  borderColor: RED,
};

const PROGRAMS_HEAD = sec("programs-head", "Programs heading", {
  pad: [80, 40],
  anchor: "programs",
  columns: [[
    kicker("pg-k", "Our Programs"),
    sectionTitle("pg-t", "Choose the level of support you need"),
    sectionSub("pg-s", "Three programs designed for different stages and different needs. Every program is built on real strategies that work in Germany."),
  ]],
});

const PROGRAMS_GRID = sec("programs-grid", "Programs", {
  pad: [0, 40],
  columnStyles: [PROGRAM_CARD, PROGRAM_CARD_FEATURED, PROGRAM_CARD],
  columns: [
    program("pg1", "Foundation", "Self Program",
      "For self-driven professionals who want the right strategies and can execute on their own. Learn the German way of job hunting at your own pace.",
      [
        "Complete German job search strategy",
        "Resume and cover letter templates",
        "Building your social profile",
        "Self-paced learning modules",
        "Lifetime community access",
      ]),
    program("pg2", "Recommended", "Guided Program",
      "For professionals who want personal guidance and accountability. We work with you step by step to build your German career strategy and execute it together.",
      [
        "LIVE group coaching sessions",
        "Resume review and optimization",
        "Mock interviews in German style",
        "Application strategy and tracking",
        "Direct WhatsApp support",
      ], "Most Popular"),
    program("pg3", "Premium", "Elite Program",
      "For professionals who want the highest level of support. End-to-end guidance from profile assessment to job offer, with priority access to the founder.",
      [
        "Direct founder involvement",
        "Priority profile positioning",
        "German company introductions",
        "Visa and relocation guidance",
        "Unlimited support until hired",
      ]),
  ],
});

const PROGRAMS_CTA = sec("programs-cta", "Programs CTA", {
  pad: [0, 80],
  columns: [[cta("pg-cta", "Book a Free Discovery Call")]],
});

/**
 * The founder band is a FLAT navy, not the gradient the live page uses.
 *
 * It is two sections - the portrait/copy split, then the credential grid - and a 165deg gradient
 * restarts in each one, which puts a visible seam across the middle of the band. A flat #0d1b3e is
 * the gradient's own midpoint, so the two sections meet invisibly.
 */
const FOUNDER = sec("founder", "Meet the founder", {
  bg: color(NAVY),
  pad: [80, 40],
  anchor: "about",
  columnStyles: [
    {
      background: "linear-gradient(135deg,#1a3a6e,#0d1b3e)",
      padding: [56, 28, 56, 28],
      radius: 16,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.08)",
      gap: 6,
      grow: 1,
      justify: "center",
    },
    { grow: 1.3 },
  ],
  columns: [
    [
      text("fd-mark", "B2", { fontSize: 68, fontWeight: 800, letterSpacing: -2, lineHeight: 1.1 },
        { align: "center", color: "rgba(255,255,255,0.10)" }),
      text("fd-years", "14+ Years", { fontSize: 26, fontWeight: 800, letterSpacing: -0.5 },
        { align: "center", color: "#ffffff" }),
      text("fd-years-l", "Living in Germany",
        { fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1 },
        { align: "center", color: ON_DARK_FAINT }),
    ],
    [
      text("fd-k", "Meet the Founder",
        { fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: 2.5 }, { color: RED }),
      title("fd-t", "He did not apply from India. He went to Germany. And ",
        { fontSize: 32, fontWeight: 800, letterSpacing: -1, lineHeight: 1.2 },
        { accentText: "stayed.", accentColor: RED }),
      text("fd-p1", "The founder of B2 Consultants moved to Germany to study. After completing his education, he secured a job in Germany through the German system. Not through an agent. Not through a consultancy. Through understanding how Germany actually hires.",
        { fontSize: 16, lineHeight: 1.8 }, { color: ON_DARK }),
      text("fd-p2", "That was over 11 years ago. Today, he is a German citizen. He has built a career in Germany. He has navigated every step that you are about to take. The visa process. The job search. The interviews. The culture. The language. The relocation.",
        { fontSize: 16, lineHeight: 1.8 }, { color: ON_DARK }),
      text("fd-p3", "He teaches what he has lived. Not theory from a textbook. Real experience from real life in Germany. That is the difference.",
        { fontSize: 16, lineHeight: 1.8 }, { color: ON_DARK }),
    ],
  ],
});

const cred = (p, icon, heading, desc) => [
  text(`${p}-i`, icon, { fontSize: 22, lineHeight: 1 }, {}),
  text(`${p}-t`, heading, { fontSize: 14, fontWeight: 700 }, { color: "#ffffff" }),
  text(`${p}-d`, desc, { fontSize: 13, lineHeight: 1.5 }, { color: ON_DARK }),
];

const FOUNDER_CREDS = sec("founder-creds", "Founder credentials", {
  bg: color(NAVY),
  pad: [0, 80],
  columnStyles: [CARD_DARK, CARD_DARK, CARD_DARK, CARD_DARK],
  columns: [
    cred("c1", "🎓", "Studied in Germany", "Completed higher education in the German university system"),
    cred("c2", "🌎", "German Citizen", "Full German citizenship earned through years of integration"),
    cred("c3", "💼", "Works in Germany", "Active professional career in the German industry"),
    cred("c4", "📜", "Consulate-Grade Documents",
      "Produces credibility documents for the German Consulate and companies"),
  ],
});

const testimonial = (p, quote, name, role) => [
  text(`${p}-stars`, "★★★★★", { fontSize: 16, letterSpacing: 2, lineHeight: 1 }, { color: "#f59e0b" }),
  text(`${p}-q`, quote, { fontSize: 15, lineHeight: 1.8 }, { color: BODY }),
  { id: `${p}-rule`, type: "divider" },
  text(`${p}-n`, name, { fontSize: 15, fontWeight: 700 }, { color: INK }),
  text(`${p}-r`, role, { fontSize: 13, fontWeight: 500 }, { color: FAINT }),
];

const STORIES_HEAD = sec("stories-head", "Success stories heading", {
  bg: color(TINT),
  pad: [80, 40],
  anchor: "success",
  columns: [[
    kicker("st-k", "Success Stories"),
    sectionTitle("st-t", "Real professionals. Real jobs. Real results."),
    sectionSub("st-s", "These are not paid actors. These are skilled professionals who followed the B2 Consultants process and got results that you are longing for."),
  ]],
});

const TESTIMONIAL_CARD = { ...CARD_WHITE, gap: 14 };

const STORIES_GRID = sec("stories-grid", "Success stories", {
  bg: color(TINT),
  pad: [0, 80],
  columnStyles: [TESTIMONIAL_CARD, TESTIMONIAL_CARD, TESTIMONIAL_CARD],
  columns: [
    testimonial("ts1",
      "I had been applying to German companies for over a year with zero response. After joining B2 Consultants, I understood why. My resume was wrong. My approach was wrong. Within 4 months of following the guided strategy, I had 3 interview calls and one offer. I am now working in Munich as a Software Developer.",
      "Rajesh K.", "Software Developer, Munich"),
    testimonial("ts2",
      "As a Mechanical Engineer, I thought Germany would be impossible without knowing German fluently. B2 Consultants showed me which companies hire in English, how to position my experience, and how to prepare for German-style interviews. I got hired in Stuttgart within 5 months.",
      "Priya S.", "Mechanical Engineer, Stuttgart"),
    testimonial("ts3",
      "The best part about B2 Consultants is the honesty. They told me exactly what I needed to improve and did not sugarcoat anything. The founder personally reviewed my profile, fixed my CV, and coached me for interviews. I am now in Frankfurt working as an IT Consultant. Worth every rupee.",
      "Arun M.", "IT Consultant, Frankfurt"),
  ],
});

const WHY_HEAD = sec("why-head", "Why us heading", {
  pad: [80, 40],
  columns: [[
    kicker("why-k", "Why B2 Consultants"),
    sectionTitle("why-t", "What makes us different"),
    sectionSub("why-s", "There are many consultants who promise Germany. Here is why professionals choose us."),
  ]],
});

const WHY_1 = sec("why-1", "Why us cards 1", {
  pad: [0, 32],
  columnStyles: [CARD_TINT, CARD_TINT],
  columns: [
    iconCard("w1", "🏆", "Founder who actually lives in Germany",
      "Not someone who visited Germany once. Not someone who read about it online. Our founder has lived in Germany for over 14 years, studied there, worked there, and became a citizen. He teaches from lived experience."),
    iconCard("w2", "📋", "Consulate-grade documentation",
      "We produce professional documents that are accepted by the German Consulate and German companies. This is not generic template work. This is precision documentation that meets German standards."),
  ],
});

const WHY_2 = sec("why-2", "Why us cards 2", {
  pad: [0, 80],
  columnStyles: [CARD_TINT, CARD_TINT],
  columns: [
    iconCard("w3", "🙌", "Honest assessment, not false promises",
      "We do not tell you what you want to hear. We tell you what you need to hear. If your profile needs work, we will say it clearly and help you fix it. If Germany is not right for you right now, we will tell you that too."),
    iconCard("w4", "🎯", "Strategies that produce real interviews",
      "Our methods are not theoretical. They are tested and refined by someone who navigated the German job market personally. Our students get real interview calls from real German companies. That is the only metric that matters."),
  ],
});

const FINAL_CTA = sec("final-cta", "Closing CTA", {
  bg: gradient(DARK_BAND),
  pad: [88, 88],
  columns: [[
    title("fc-t", "Your career in Germany starts with one ",
      { fontSize: 36, fontWeight: 800, letterSpacing: -1.5, lineHeight: 1.2, maxWidth: 760 },
      { align: "center", accentText: "conversation.", accentColor: RED }),
    text("fc-s", "Book a free discovery call. We will assess your profile, tell you exactly where you stand, and show you the path forward. No cost. No obligation. Just clarity.",
      { fontSize: 17, lineHeight: 1.7, maxWidth: 680 }, { align: "center", color: "rgba(255,255,255,0.65)" }),
    spacer("fc-sp", 12),
    cta("fc-cta", "Book a Free Discovery Call"),
    text("fc-note", "Limited slots available each week. We only take professionals we can genuinely help.",
      { fontSize: 13 }, { align: "center", color: "rgba(255,255,255,0.42)" }),
  ]],
});

export const HOME = [
  HERO,
  TRUST_HEAD,
  TRUST_GRID,
  PROBLEM_HEAD,
  PROBLEM_1,
  PROBLEM_2,
  HOW_HEAD,
  HOW_GRID,
  PROGRAMS_HEAD,
  PROGRAMS_GRID,
  PROGRAMS_CTA,
  FOUNDER,
  FOUNDER_CREDS,
  STORIES_HEAD,
  STORIES_GRID,
  WHY_HEAD,
  WHY_1,
  WHY_2,
  FINAL_CTA,
];

export const SEO = {
  title: "Home",
  seoTitle: "B2 Consultants | Get Hired in Germany",
  seoDescription:
    "We help IT and Mechanical professionals with 2+ years experience get real interview calls and job offers in Germany. Book a free discovery call today.",
};

// ── Write ─────────────────────────────────────────────────────────────────────

async function main() {
  const site = await prisma.site.findUnique({
    where: { slug: "b2consultants" },
    include: { sections: true, pages: { where: { path: "/" } } },
  });
  if (!site) throw new Error('No site with slug "b2consultants" - nothing to replace.');
  const page = site.pages[0];
  if (!page) throw new Error('The b2consultants site has no "/" page.');

  const blockCount = HOME.reduce((n, s) => n + s.columns.reduce((m, c) => m + c.length, 0), 0);
  console.log(`site   ${site.id}  (${site.published ? "published" : "unpublished"})`);
  console.log(`page   ${page.id}  "/"  (${page.published ? "published" : "unpublished"}, ${page.views} views)`);
  console.log(`theme  ${site.theme.primary} ${site.theme.headingFont}  ->  ${THEME.primary} ${THEME.headingFont}`);
  console.log(`nav    ${site.navMenu.length} items -> ${NAV.length}`);
  console.log(`home   ${Array.isArray(page.sections) ? page.sections.length : 0} sections -> ${HOME.length} (${blockCount} blocks)`);
  for (const kind of ["HEADER", "FOOTER"]) {
    const s = site.sections.find((x) => x.kind === kind);
    console.log(`${kind.toLowerCase().padEnd(6)} ${s ? `${s.blocks.length} sections -> ` : "MISSING -> create "}${(kind === "HEADER" ? HEADER : FOOTER).length}`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Snapshot first. This page takes paid traffic and the editor's version history is the only
    // way back from a bad rewrite - a direct DB write that skips it removes that.
    await tx.sitePageRevision.create({
      data: { pageId: page.id, sections: page.sections, label: "before the 2026 redesign" },
    });

    await tx.site.update({
      where: { id: site.id },
      data: { theme: THEME, navMenu: NAV },
    });

    for (const [kind, blocks, name] of [["HEADER", HEADER, "Header"], ["FOOTER", FOOTER, "Footer"]]) {
      const existing = site.sections.find((x) => x.kind === kind);
      if (existing) await tx.siteSection.update({ where: { id: existing.id }, data: { blocks } });
      else await tx.siteSection.create({ data: { siteId: site.id, kind, name, blocks } });
    }

    await tx.sitePage.update({
      where: { id: page.id },
      data: { ...SEO, sections: HOME, published: true },
    });
  });

  console.log("\nWritten. The public route caches for 300s and this write cannot call");
  console.log("revalidatePath, so allow up to 5 minutes - or redeploy, which rebuilds it.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
