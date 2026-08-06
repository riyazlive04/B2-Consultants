/**
 * The section library — the pre-styled bands the team picks from when building a page.
 *
 * ── Why a curated library instead of a free-form canvas ───────────────────────────────────────
 * GoHighLevel gives you an empty canvas and per-element style controls. That freedom is mostly
 * spent producing pages that look worse than the one being replaced, and it makes brand drift the
 * default outcome once more than one person edits. Here the team chooses a band that is already on
 * brand and fills in the copy; layout stays a code decision.
 *
 * The shapes below mirror the bands the live b2consultants.de is actually built from — a violet
 * header, a hero with a circular portrait, a full-bleed violet two-column band, a contact block
 * beside a map, a CTA, and a footer. Adding a genuinely new layout is a day's work here, not a
 * sprint, and every page that uses it gets the fix.
 */

import type { SiteSectionBlock } from "./site-types";

export type SectionTemplate = {
  key: string;
  name: string;
  /** Shown under the name in the picker — what the band is FOR, not what it contains. */
  description: string;
  /** Grouping in the picker. */
  group: "Header & footer" | "Hero" | "Content" | "Conversion" | "Contact";
  build: (seed: number) => SiteSectionBlock;
};

/**
 * Ids must be unique within a page but stable across a render, so they are derived from a seed the
 * caller increments rather than from Date.now() — two sections added in the same millisecond would
 * otherwise collide, and React would treat a re-render as a remount.
 */
const mk = (seed: number, n: number) => `s${seed}b${n}`;

/** Brand violet, matching the live site's bands. Overridable per section once placed. */
const BAND = "#4949ef";

export const SECTION_TEMPLATES: SectionTemplate[] = [
  // ── Header & footer ──────────────────────────────────────────────────────────
  {
    key: "header-brand",
    name: "Header — logo and menu",
    description: "Coloured bar with the logo on the left and the site menu on the right",
    group: "Header & footer",
    build: (s) => ({
      id: `s${s}`,
      name: "Header",
      width: "full",
      background: { kind: "color", color: BAND },
      padding: [20, 20],
      columns: [
        [{ id: mk(s, 1), type: "logo", alt: "B2 Consultants", height: 64 }],
        [{ id: mk(s, 2), type: "nav", align: "right" }],
      ],
    }),
  },
  {
    key: "footer-simple",
    name: "Footer — copyright and links",
    description: "Small print with privacy and terms links",
    group: "Header & footer",
    build: (s) => ({
      id: `s${s}`,
      name: "Footer",
      width: "full",
      background: { kind: "none" },
      padding: [32, 32],
      columns: [
        [
          { id: mk(s, 1), type: "text", text: "© B2 Consultants", align: "center" },
          {
            id: mk(s, 2),
            type: "footerLinks",
            align: "center",
            // "Label|href" per line — keeps the footer a plain editable list rather than needing a
            // nested editor for three links.
            items: ["Privacy Policy|/privacy", "Terms|/terms"],
          },
        ],
      ],
    }),
  },

  // ── Hero ─────────────────────────────────────────────────────────────────────
  {
    key: "hero-portrait",
    name: "Hero — portrait, headline, CTA",
    description: "Circular photo above a large headline, promise line and button",
    group: "Hero",
    build: (s) => ({
      id: `s${s}`,
      name: "Hero",
      width: "full",
      background: { kind: "none" },
      padding: [64, 72],
      columns: [
        [
          // `rounded` also sets next/image `priority` — the hero is almost always the Largest
          // Contentful Paint element, and lazy-loading it delays the metric the page is judged on.
          { id: mk(s, 1), type: "image", rounded: true, width: 520, height: 520, align: "center" },
          { id: mk(s, 2), type: "heading", text: "Your headline here", align: "center" },
          { id: mk(s, 3), type: "text", text: "The promise, in one sentence.", align: "center" },
          {
            id: mk(s, 4),
            type: "button",
            label: "Watch Free Training",
            href: "https://optin.b2consultants.de/lp",
            align: "center",
            // ON by default on the hero CTA. This is the link that crosses to the GHL funnel, and
            // without forwarding, every opt-in it produces arrives with no attribution at all.
            forwardParams: true,
          },
        ],
      ],
    }),
  },

  // ── Content ──────────────────────────────────────────────────────────────────
  {
    key: "band-two-column",
    name: "Coloured band — two columns",
    description: "Full-width colour with a heading and two columns of copy",
    group: "Content",
    build: (s) => ({
      id: `s${s}`,
      name: "Two-column band",
      width: "full",
      background: { kind: "color", color: BAND },
      padding: [64, 64],
      columns: [
        [
          { id: mk(s, 1), type: "subheading", text: "About", align: "center" },
          { id: mk(s, 2), type: "text", text: "First column." },
        ],
        [{ id: mk(s, 3), type: "text", text: "Second column." }],
      ],
    }),
  },
  {
    key: "content-prose",
    name: "Text block",
    description: "A heading and body copy — for policy and long-form pages",
    group: "Content",
    build: (s) => ({
      id: `s${s}`,
      name: "Text",
      width: "full",
      background: { kind: "none" },
      padding: [56, 56],
      columns: [
        [
          { id: mk(s, 1), type: "subheading", text: "Heading" },
          { id: mk(s, 2), type: "text", text: "Body copy." },
        ],
      ],
    }),
  },
  {
    key: "content-bullets",
    name: "Bullet list",
    description: "A heading with a bulleted list beneath it",
    group: "Content",
    build: (s) => ({
      id: `s${s}`,
      name: "Bullets",
      width: "full",
      background: { kind: "none" },
      padding: [48, 48],
      columns: [
        [
          { id: mk(s, 1), type: "subheading", text: "What you get" },
          { id: mk(s, 2), type: "bullets", items: ["First point", "Second point", "Third point"] },
        ],
      ],
    }),
  },
  {
    key: "content-video",
    name: "Video",
    description: "An embedded video, full content width",
    group: "Content",
    build: (s) => ({
      id: `s${s}`,
      name: "Video",
      width: "full",
      background: { kind: "none" },
      padding: [48, 48],
      columns: [[{ id: mk(s, 1), type: "video" }]],
    }),
  },

  // ── Conversion ───────────────────────────────────────────────────────────────
  {
    key: "cta-button",
    name: "Call to action",
    description: "A single centred button — repeat it down a long page",
    group: "Conversion",
    build: (s) => ({
      id: `s${s}`,
      name: "CTA",
      width: "full",
      background: { kind: "none" },
      padding: [40, 56],
      columns: [
        [
          {
            id: mk(s, 1),
            type: "button",
            label: "Watch Free Training",
            href: "https://optin.b2consultants.de/lp",
            align: "center",
            forwardParams: true,
          },
        ],
      ],
    }),
  },

  // ── Contact ──────────────────────────────────────────────────────────────────
  {
    key: "contact-map",
    name: "Contact — address and map",
    description: "Postal details beside an embedded map",
    group: "Contact",
    build: (s) => ({
      id: `s${s}`,
      name: "Contact",
      width: "full",
      background: { kind: "none" },
      padding: [48, 64],
      columns: [
        [
          { id: mk(s, 1), type: "subheading", text: "B2 Consultants" },
          { id: mk(s, 2), type: "text", text: "Alter Weg 49\n64385 Reichelsheim\nGermany\ninfo@b2consultants.de" },
        ],
        [{ id: mk(s, 3), type: "map", alt: "Office location" }],
      ],
    }),
  },
];

export function templateByKey(key: string): SectionTemplate | undefined {
  return SECTION_TEMPLATES.find((t) => t.key === key);
}

/** The picker's groups, in display order, with their templates. */
export function groupedTemplates(): { group: SectionTemplate["group"]; items: SectionTemplate[] }[] {
  const order: SectionTemplate["group"][] = [
    "Hero",
    "Content",
    "Conversion",
    "Contact",
    "Header & footer",
  ];
  return order
    .map((group) => ({ group, items: SECTION_TEMPLATES.filter((t) => t.group === group) }))
    .filter((g) => g.items.length > 0);
}
