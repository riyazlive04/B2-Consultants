/**
 * Builds the VSL funnel to match the live Synamate funnel it replaces.
 *
 * Synamate's step list (screenshot, 06/08/2026) is reproduced NAME-FOR-NAME so the team
 * recognises the funnel after the cutover:
 *   Landing Page · VSL · Apply Team Page · Disco with Asma · Disco with Ameen ·
 *   Congrats · Success Strategy Session · Disco with Loshini · Workshop Follow Up
 *
 * Only VSL is designed here — it is the one page we have a reference for. The rest are
 * created as SCAFFOLDS (logo, title, footer) so the funnel's shape is right and each has a
 * real URL to point traffic at; their bodies are still to be designed.
 *
 * Re-runnable: every write is keyed on [funnelId, slug], so running it twice updates rather
 * than duplicates. It never touches the Landing step's body copy.
 *
 * Usage: npx tsx prisma/build-vsl-funnel.ts [--video <embed-url>]
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FUNNEL_SLUG = "vsl-funnel";

/** --video <url>, so the embed can be dropped in without editing this file. */
function videoArg(): string {
  const i = process.argv.indexOf("--video");
  return i !== -1 ? process.argv[i + 1] ?? "" : "";
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
          // Straight to booking, NOT the opt-in popup: whoever is on this page has already
          // submitted that form — showing it again would ask for details they just gave.
          href: "/book",
          variant: "primary",
          style: { align: "center" },
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

/** name, slug, and whether it is the fully designed page. */
const STEPS: Array<{ name: string; slug: string; seoTitle?: string; designed?: boolean }> = [
  { name: "Landing Page", slug: "landing" }, // exists — renamed only, body untouched
  { name: "VSL", slug: "vsl", seoTitle: "Why Indian professionals get ignored in Germany — B2 Consultants", designed: true },
  { name: "Apply Team Page", slug: "apply-team-page" },
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
  const funnel = await prisma.funnel.findUnique({ where: { slug: FUNNEL_SLUG }, include: { steps: true } });
  if (!funnel) throw new Error(`No funnel with slug "${FUNNEL_SLUG}"`);

  await prisma.funnel.update({
    where: { id: funnel.id },
    data: { headerBlocks: HEADER as never, footerBlocks: FOOTER as never },
  });
  console.log("· funnel header + footer set (logo bar / legal strip, shown on every step)");

  for (const [position, s] of STEPS.entries()) {
    const existing = funnel.steps.find((x) => x.slug === s.slug);

    if (existing) {
      // Body is only rewritten for the page we actually designed; Landing keeps its own.
      const data: Record<string, unknown> = { name: s.name, position };
      if (s.designed) {
        data.blocks = vslBlocks(video);
        if (s.seoTitle) data.seoTitle = s.seoTitle;
      } else {
        const { kept, removed } = stripInlineChrome((existing.blocks as Block[]) ?? []);
        if (removed.length) {
          data.blocks = kept as never;
          console.log(`  ↳ moved to funnel chrome, removed from body: ${removed.join(", ")}`);
        }
      }
      await prisma.funnelStep.update({ where: { id: existing.id }, data });
      console.log(`· updated  ${String(position)}. ${s.name.padEnd(26)} /p/${FUNNEL_SLUG}/${s.slug}${s.designed ? "  (designed)" : ""}`);
      continue;
    }

    await prisma.funnelStep.create({
      data: {
        funnelId: funnel.id,
        name: s.name,
        slug: s.slug,
        position,
        seoTitle: s.seoTitle ?? null,
        blocks: (s.designed ? vslBlocks(video) : scaffoldBlocks(s.slug, s.name)) as never,
      },
    });
    console.log(`· created  ${String(position)}. ${s.name.padEnd(26)} /p/${FUNNEL_SLUG}/${s.slug}${s.designed ? "  (designed)" : "  (scaffold)"}`);
  }

  if (!video) {
    console.log("\n! VSL video URL not supplied — the video block is empty and renders nothing.");
    console.log("  Re-run with:  npx tsx prisma/build-vsl-funnel.ts --video <embed-url>");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
