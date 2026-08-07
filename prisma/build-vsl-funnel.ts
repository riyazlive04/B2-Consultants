/**
 * Builds the VSL funnel to match the live Synamate funnel it replaces.
 *
 * Synamate's step list (screenshot, 06/08/2026) is reproduced NAME-FOR-NAME so the team
 * recognises the funnel after the cutover:
 *   Landing Page · VSL · Apply Team Page · Disco with Asma · Disco with Ameen ·
 *   Congrats · Success Strategy Session · Disco with Loshini · Workshop Follow Up
 *
 * VSL and Apply Team Page are designed here — the two we have a reference for. Disco with
 * Asma / Ameen are authored separately by `scripts/build-disco-pages.ts`, which owns them
 * because their bodies need a booking calendar bound to a real user id. The rest are created
 * as SCAFFOLDS (logo, title, footer) so the funnel's shape is right and each has a real URL to
 * point traffic at; their bodies are still to be designed.
 *
 * Re-runnable: every write is keyed on [funnelId, slug], so running it twice updates rather
 * than duplicates. It never touches the Landing step's body copy.
 *
 * Usage: npx tsx prisma/build-vsl-funnel.ts [--video <embed-url>] [--only <step-slug>]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FUNNEL_SLUG = "vsl-funnel";

/**
 * The step the VSL's CTA hands off to. Named once because it is used twice — to build the
 * button's href and to declare the step itself in STEPS — and a link that disagrees with the
 * step it points at is a 404 nobody notices until the ad is already running.
 */
const APPLY_SLUG = "apply-team-page";

/** The two discovery steps the apply page hands off to — same reason as APPLY_SLUG. */
const DISCO_ASMA_SLUG = "disco-with-asma";
const DISCO_AMEEN_SLUG = "disco-with-ameen";

/**
 * The VSL player, as Synamate serves it (07/08/2026).
 *
 * Their page carries this as a Custom HTML block wrapping Vimeo's full <iframe> plus a
 * `player.js` tag. It is a plain URL here instead, because the `video` block renders the same
 * iframe — same `allow` list, same `referrerPolicy`, same 56.25% aspect wrapper (see the note
 * in `SiteBlocks`). The dropped `player.js` is only Vimeo's JS control API; nothing on this
 * page drives the player from script, and it would not have run anyway — a Custom HTML block
 * is injected with `dangerouslySetInnerHTML`, which the HTML spec does not execute <script>
 * from. Every query param is preserved verbatim, so Vimeo's own analytics still line up.
 */
const VIDEO_URL =
  "https://player.vimeo.com/video/1192620469?badge=0&autopause=0&player_id=0&app_id=58479";

/** --video <url>, so a re-cut can be swapped in without editing this file. */
function videoArg(): string {
  const i = process.argv.indexOf("--video");
  return i !== -1 ? process.argv[i + 1] ?? VIDEO_URL : VIDEO_URL;
}

/**
 * --only <step-slug>, limiting the run to one step.
 *
 * Without it this script asserts the WHOLE funnel: it renames steps, strips inline chrome from
 * bodies, and creates any step that is missing. All of that is correct for a first build and
 * all of it is unwanted when you came back to change one page on a funnel that is already live.
 */
function onlyArg(): string | null {
  const i = process.argv.indexOf("--only");
  return i !== -1 ? process.argv[i + 1] ?? null : null;
}

type Block = Record<string, unknown>;

// ─────────────────────────── funnel-wide chrome ───────────────────────────

/** The logo bar above every step. */
const HEADER: Block[] = [
  {
    id: "fh-sec",
    type: "section",
    background: "plain",
    style: { padding: [24, 0, 8, 0], maxWidth: 1080 },
    styleMobile: { padding: [20, 0, 4, 0] },
    children: [
      { id: "fh-logo", type: "image", url: "/media/b2-logo.png", alt: "B2 Consultants", style: { maxWidth: 104 } },
    ],
  },
];

/** The legal strip below every step. */
const FOOTER: Block[] = [
  {
    id: "ff-sec",
    type: "section",
    background: "plain",
    style: { padding: [28, 0, 28, 0], maxWidth: 1080 },
    styleMobile: { padding: [24, 0, 32, 0] },
    children: [
      { id: "ff-c", type: "text", text: "© B2 Consultants 2026", style: { align: "center", color: "ink-3", fontSize: 12 } },
      { id: "ff-l", type: "text", text: "Privacy Policy · Terms", style: { align: "center", color: "ink-3", fontSize: 12 } },
    ],
  },
];

// ─────────────────────────── the VSL page ───────────────────────────

function vslBlocks(videoUrl: string): Block[] {
  return [
    {
      id: "vsl-hero",
      type: "section",
      background: "plain",
      style: { padding: [8, 0, 8, 0], maxWidth: 1080 },
      styleMobile: { padding: [4, 0, 4, 0] },
      children: [
        {
          id: "vsl-h1",
          type: "heading",
          text: "This is why Indian professionals get ignored in Germany - and how we fix it.",
          // The reference page sets this headline in the brand violet, not ink.
          style: { align: "center", color: "primary", fontSize: 40, lineHeight: 1.2, fontWeight: 800 },
          styleMobile: { fontSize: 26 },
        },
      ],
    },
    {
      id: "vsl-video-sec",
      type: "section",
      background: "plain",
      style: { padding: [24, 0, 24, 0], maxWidth: 1080 },
      styleMobile: { padding: [16, 0, 16, 0] },
      children: [
        // An empty `url` renders NOTHING rather than a broken frame — deliberate, so a
        // published page never shows a dead embed while the real URL is still missing.
        { id: "vsl-video", type: "video", url: videoUrl, style: { radius: 10 } },
      ],
    },
    {
      id: "vsl-cta-sec",
      type: "section",
      background: "plain",
      style: { padding: [8, 0, 56, 0], maxWidth: 1080 },
      styleMobile: { padding: [8, 0, 40, 0] },
      children: [
        {
          id: "vsl-sub",
          type: "text",
          text: "Book a 20-minute call to see if Guided Mode is right for you.",
          style: { align: "center", color: "ink", fontSize: 18 },
        },
        {
          id: "vsl-cta",
          type: "button",
          label: "Apply Now",
          // On to the funnel's next step, NOT the opt-in popup: whoever is on this page has
          // already submitted that form — showing it again would ask for details they just gave.
          //
          // Kept inside /p/<funnel>/ rather than sent to the standalone /book route so the step
          // records a view and the VSL → Apply drop-off is measurable.
          href: `/p/${FUNNEL_SLUG}/${APPLY_SLUG}`,
          variant: "primary",
          style: { align: "center" },
        },
      ],
    },
  ];
}

// ─────────────────────────── the Apply page ───────────────────────────

/**
 * One team member's pick: the button, then their portrait under it.
 *
 * Button ABOVE the photo, which reads as backwards until you see the source page — the photo is
 * what makes the choice ("who do I want to talk to?"), and it sits directly above the NEXT
 * person's button in the single mobile column. Keeping the source's order avoids a tap landing
 * on the wrong person.
 *
 * The portrait is self-hosted from `public/media` rather than hotlinked to Synamate's CDN: this
 * funnel exists to replace that account, and a page that still pulls its images from the system
 * being switched off breaks the day it is.
 */
function teamPick(id: string, name: string, photo: string, stepSlug: string): Block {
  return {
    id: `ap-col-${id}`,
    type: "column",
    style: { gap: 16 },
    children: [
      {
        id: `ap-btn-${id}`,
        type: "button",
        label: `Book a call with ${name}`,
        href: `/p/${FUNNEL_SLUG}/${stepSlug}`,
        variant: "primary",
        style: { align: "center" },
      },
      {
        // Square box + `cover` = a circle that CROPS. `radius` alone on a non-square source
        // would have given an ellipse, and a plain width cap would have squashed the face.
        id: `ap-img-${id}`,
        type: "image",
        url: photo,
        alt: `${name}, B2 Consultants`,
        style: { width: 270, height: 270, radius: 9999, objectFit: "cover" },
        styleMobile: { width: 220, height: 220 },
      },
    ],
  };
}

function applyBlocks(): Block[] {
  return [
    {
      id: "ap-hero",
      type: "section",
      background: "plain",
      style: { padding: [8, 0, 8, 0], maxWidth: 1080 },
      styleMobile: { padding: [4, 0, 4, 0] },
      children: [
        {
          id: "ap-h1",
          type: "heading",
          text: "Book A FREE Discovery Call With Team B2",
          style: { align: "center", color: "primary", fontSize: 34, lineHeight: 1.25, fontWeight: 800 },
          styleMobile: { fontSize: 24 },
        },
        {
          /**
           * Set in one colour. The source page renders this sentence with its words in a mix of
           * violet and near-black — the signature of copy pasted into a rich-text field with its
           * spans intact, not a design decision, and it reads as a rendering fault. A `text`
           * block is single-colour anyway; violet matches the dominant tone there.
           */
          id: "ap-sub",
          type: "text",
          text:
            "Here's your opportunity to connect directly with one of our experts, to discover how " +
            "our program could be a right fit for you, this is NOT a sales call rather a session " +
            "to find out, if we are the right career counselling partner for your next dream job " +
            "in Germany.",
          style: { align: "center", color: "primary", fontSize: 16, lineHeight: 1.6 },
        },
      ],
    },
    {
      id: "ap-team-sec",
      type: "section",
      background: "plain",
      style: { padding: [24, 0, 56, 0], maxWidth: 900 },
      styleMobile: { padding: [16, 0, 40, 0] },
      children: [
        {
          id: "ap-team-row",
          type: "row",
          style: { gap: 32 },
          children: [
            teamPick("asma", "Asma", "/media/asma.webp", DISCO_ASMA_SLUG),
            teamPick("ameen", "Ameen", "/media/ameen.webp", DISCO_AMEEN_SLUG),
          ],
        },
      ],
    },
  ];
}

/** Scaffold body for a step we have no design for yet. */
function scaffoldBlocks(id: string, title: string): Block[] {
  return [
    {
      id: `${id}-sec`,
      type: "section",
      background: "plain",
      style: { padding: [56, 0, 72, 0], maxWidth: 1080 },
      children: [
        { id: `${id}-h`, type: "heading", text: title, style: { align: "center", fontSize: 34, lineHeight: 1.2 } },
        {
          id: `${id}-n`,
          type: "text",
          text: "This step is part of the funnel structure. Its content has not been designed yet.",
          style: { align: "center", color: "ink-3", fontSize: 15 },
        },
      ],
    },
  ];
}

/**
 * name, slug, and — for a page we have actually designed — the builder for its body.
 *
 * `body` replaced a `designed: boolean`, which could only ever mean "use vslBlocks" and so had
 * no way to express a second designed page.
 */
const STEPS: Array<{ name: string; slug: string; seoTitle?: string; body?: (video: string) => Block[] }> = [
  { name: "Landing Page", slug: "landing" }, // exists — renamed only, body untouched
  { name: "VSL", slug: "vsl", seoTitle: "Why Indian professionals get ignored in Germany — B2 Consultants", body: vslBlocks },
  {
    name: "Apply Team Page",
    slug: APPLY_SLUG,
    seoTitle: "Book a free discovery call with Team B2 — B2 Consultants",
    body: applyBlocks,
  },
  { name: "Disco with Asma", slug: "disco-with-asma" },
  { name: "Disco with Ameen", slug: "disco-with-ameen" },
  { name: "Congrats", slug: "congrats" },
  { name: "Success Strategy Session", slug: "success-strategy-session" },
  { name: "Disco with Loshini", slug: "disco-with-loshini" },
  { name: "Workshop Follow Up", slug: "workshop-follow-up" },
];

/**
 * The logo and legal strip move from the Landing step's own body to the funnel chrome, so
 * they are authored once instead of nine times. Landing already carries both inline, so they
 * have to come OUT of its body or the page renders each twice.
 *
 * Matched STRUCTURALLY, never by index: a section whose only child is the logo image, and a
 * section whose children are just the copyright lines. A body that has already been cleaned
 * (a second run) simply matches nothing.
 */
function stripInlineChrome(blocks: Block[]): { kept: Block[]; removed: string[] } {
  const removed: string[] = [];
  const kept = blocks.filter((b) => {
    const children = (b as { children?: Block[] }).children ?? [];
    if (b.type !== "section" || children.length === 0) return true;

    const onlyLogo =
      children.length === 1 &&
      children[0].type === "image" &&
      typeof children[0].url === "string" &&
      (children[0].url as string).includes("b2-logo");

    const onlyLegal =
      children.length <= 2 &&
      children.every(
        (c) => c.type === "text" && typeof c.text === "string" && /©|Privacy Policy/.test(c.text as string),
      );

    if (onlyLogo || onlyLegal) {
      removed.push(`${b.id} (${onlyLogo ? "logo bar" : "legal strip"})`);
      return false;
    }
    return true;
  });
  return { kept, removed };
}

async function main() {
  const video = videoArg();
  const only = onlyArg();
  if (only && !STEPS.some((s) => s.slug === only)) {
    throw new Error(`--only "${only}" is not a step of this funnel. Known: ${STEPS.map((s) => s.slug).join(", ")}`);
  }
  const funnel = await prisma.funnel.findUnique({ where: { slug: FUNNEL_SLUG }, include: { steps: true } });
  if (!funnel) throw new Error(`No funnel with slug "${FUNNEL_SLUG}"`);
  if (only) console.log(`· --only ${only}: every other step is left exactly as it is\n`);

  // Asserted even under --only: the chrome is funnel-wide, so a single designed step still gets
  // its logo bar and legal strip. Writing the same blocks back is a no-op when they already match.
  await prisma.funnel.update({
    where: { id: funnel.id },
    data: { headerBlocks: HEADER as never, footerBlocks: FOOTER as never },
  });
  console.log("· funnel header + footer set (logo bar / legal strip, shown on every step)");

  for (const [position, s] of STEPS.entries()) {
    if (only && s.slug !== only) continue;
    const existing = funnel.steps.find((x) => x.slug === s.slug);

    if (existing) {
      // Body is only rewritten for a page we actually designed; Landing keeps its own.
      const data: Record<string, unknown> = { name: s.name, position };
      if (s.body) {
        data.blocks = s.body(video);
        if (s.seoTitle) data.seoTitle = s.seoTitle;
      } else {
        const { kept, removed } = stripInlineChrome((existing.blocks as Block[]) ?? []);
        if (removed.length) {
          data.blocks = kept as never;
          console.log(`  ↳ moved to funnel chrome, removed from body: ${removed.join(", ")}`);
        }
      }
      await prisma.funnelStep.update({ where: { id: existing.id }, data });
      console.log(`· updated  ${String(position)}. ${s.name.padEnd(26)} /p/${FUNNEL_SLUG}/${s.slug}${s.body ? "  (designed)" : ""}`);
      continue;
    }

    await prisma.funnelStep.create({
      data: {
        funnelId: funnel.id,
        name: s.name,
        slug: s.slug,
        position,
        seoTitle: s.seoTitle ?? null,
        blocks: (s.body ? s.body(video) : scaffoldBlocks(s.slug, s.name)) as never,
      },
    });
    console.log(`· created  ${String(position)}. ${s.name.padEnd(26)} /p/${FUNNEL_SLUG}/${s.slug}${s.body ? "  (designed)" : "  (scaffold)"}`);
  }

  console.log(`\n· VSL player: ${video}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
