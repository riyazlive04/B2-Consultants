/**
 * Shapes behind the marketing website - the JSON stored on Site.theme, Site.navMenu,
 * SitePage.sections and SiteSection.blocks.
 *
 * Isomorphic: the builder, the public renderer and the server actions all import the same
 * normalisers, so the browser and the server cannot disagree about what a page contains.
 *
 * ── Why a Section wraps Blocks, when funnels have bare blocks ──────────────────────────────
 * `sites-types.ts` (funnels) has a flat `Block[]` that renders into a fixed centred column. That
 * is why the funnel builder cannot reproduce b2consultants.de: the violet header band, the
 * full-bleed "About Me" band and the footer are all SECTIONS - full-width strips with their own
 * background, that contain a contained row of blocks.
 *
 * So the model here is Section → Block[], and the section owns the background and the width.
 * Blocks stay deliberately close to the funnel `Block` shape so the two renderers can converge
 * later, but they are NOT the same type: these carry per-block styling the funnel blocks lack.
 */

// ─────────────────────────── Theme ───────────────────────────

/**
 * Per-site design tokens. Held on the Site row rather than read from the dashboard's Tailwind
 * theme ON PURPOSE - this website must not inherit the app's look, and the two must be free to
 * diverge without either dragging the other.
 */
export type SiteTheme = {
  /** Brand colour - buttons, links, filled bands. */
  primary: string;
  /** Text on top of `primary`. Stored, not computed: the contrast call is a design decision. */
  onPrimary: string;
  /** Default page background and body text. */
  background: string;
  text: string;
  /** Muted body text (captions, secondary paragraphs). */
  textMuted: string;
  /** Font family stacks. The live site renders in Inter; GHL also loads five faces it never uses. */
  headingFont: string;
  bodyFont: string;
  /** Corner radius for buttons and cards, in px. */
  radius: number;
  /** Max content width inside a contained section, in px. */
  contentWidth: number;
};

/**
 * Defaults taken from the LIVE b2consultants.de, read out of its own CSS custom properties rather
 * than eyeballed from a screenshot:
 *   --color-m2ti8lx2: #4949ef   the brand violet on the header and the "About Me" band
 *   --headlinefont:   Montserrat
 *   --contentfont:    Raleway
 *   .inner            max-width: 1170px
 *
 * The fonts are the correction worth flagging: the page's markup also mentions Inter, but that is
 * GHL's own editor chrome, not the rendered site. Headings are Montserrat and body copy is Raleway.
 */
export function defaultTheme(): SiteTheme {
  return {
    primary: "#4949ef",
    onPrimary: "#ffffff",
    background: "#ffffff",
    text: "#101828",
    textMuted: "#475467",
    headingFont: "Montserrat, sans-serif",
    bodyFont: "Raleway, sans-serif",
    radius: 8,
    contentWidth: 1170,
  };
}

// ─────────────────────────── Nav ───────────────────────────

/**
 * One item in the shared header menu.
 *
 * `href` is a raw string, not a page reference, because the live nav's first item points at
 * optin.b2consultants.de - a different hostname on a different platform. A model that could only
 * express "one of our pages" could not describe the menu we are reproducing.
 */
export type NavItem = {
  label: string;
  href: string;
  /**
   * Forward the visitor's query string (utm_*, fbclid, gclid) onto the target.
   *
   * This is how attribution survives the hop to the GHL opt-in funnel. Without it every opt-in
   * arrives context-free and "did the rebuilt page convert better?" becomes unanswerable - the one
   * question the rebuild exists to answer. Off for internal links, which keep params anyway.
   */
  forwardParams?: boolean;
};

// ─────────────────────────── Sections & blocks ───────────────────────────

export type SectionWidth =
  /** Background spans the viewport; content is capped at theme.contentWidth. */
  | "full"
  /** Both background and content are capped - a card-like band. */
  | "contained";

export type SectionBackground =
  | { kind: "none" }
  | { kind: "color"; color: string }
  | { kind: "image"; url: string; overlay?: string };

export type SiteBlockType =
  | "heading"
  | "subheading"
  | "text"
  | "image"
  | "button"
  | "bullets"
  | "divider"
  | "spacer"
  | "video"
  | "map"
  | "form"
  | "nav"
  | "logo"
  | "footerLinks";

export type SiteBlock = {
  id: string;
  type: SiteBlockType;
  text?: string;
  align?: "left" | "center" | "right";
  url?: string;
  alt?: string;
  label?: string;
  href?: string;
  /** See NavItem.forwardParams - same job, for a CTA button. */
  forwardParams?: boolean;
  variant?: "primary" | "soft" | "outline";
  items?: string[];
  /** Spacer height in px. */
  size?: number;
  formId?: string;
  /** Per-block colour override, for text sitting on a coloured band. */
  color?: string;
  /** Render the image as a circle - the hero portrait on the live homepage. */
  rounded?: boolean;
  /** Explicit intrinsic size, so next/image can reserve space and avoid layout shift. */
  width?: number;
  height?: number;
};

/** A full-width horizontal strip. The unit the live site is actually built from. */
export type SiteSectionBlock = {
  id: string;
  /** Editor-facing name ("Hero", "About Me"). Never rendered. */
  name?: string;
  width: SectionWidth;
  background: SectionBackground;
  /** Vertical padding in px: [top, bottom]. */
  padding: [number, number];
  /** Columns of blocks. One entry = a single column; two = the live "About Me" band. */
  columns: SiteBlock[][];
};

// ─────────────────────────── Normalisation ───────────────────────────

const BLOCK_TYPES = new Set<string>([
  "heading", "subheading", "text", "image", "button", "bullets",
  "divider", "spacer", "video", "map", "form", "nav", "logo", "footerLinks",
]);

function str(v: unknown, max = 2000): string | undefined {
  return typeof v === "string" && v ? v.slice(0, max) : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function normaliseBackground(raw: unknown): SectionBackground {
  if (!raw || typeof raw !== "object") return { kind: "none" };
  const o = raw as Record<string, unknown>;
  if (o.kind === "color") {
    const color = str(o.color, 40);
    return color ? { kind: "color", color } : { kind: "none" };
  }
  if (o.kind === "image") {
    const url = str(o.url, 2000);
    return url ? { kind: "image", url, overlay: str(o.overlay, 40) } : { kind: "none" };
  }
  return { kind: "none" };
}

function normaliseBlock(raw: unknown, i: number): SiteBlock | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o.type);
  if (!BLOCK_TYPES.has(type)) return null;
  const align = o.align === "left" || o.align === "center" || o.align === "right" ? o.align : undefined;
  const variant =
    o.variant === "primary" || o.variant === "soft" || o.variant === "outline" ? o.variant : undefined;
  return {
    id: str(o.id, 60) ?? `b${i}`,
    type: type as SiteBlockType,
    text: str(o.text, 20000),
    align,
    url: str(o.url),
    alt: str(o.alt, 300),
    label: str(o.label, 200),
    href: str(o.href),
    forwardParams: o.forwardParams === true,
    variant,
    items: Array.isArray(o.items)
      ? o.items.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 500))
      : undefined,
    size: num(o.size),
    formId: str(o.formId, 60),
    color: str(o.color, 40),
    rounded: o.rounded === true,
    width: num(o.width),
    height: num(o.height),
  };
}

/**
 * Turn whatever is in the `sections` column into today's shape.
 *
 * Every read path goes through this - the editor, the public renderer, the revision restore - so a
 * page saved before a field existed renders identically to one saved after. Ids fall back to the
 * INDEX rather than being generated, so re-reading the same stored page twice yields the same ids
 * and React does not remount every row.
 */
export function normaliseSections(raw: unknown): SiteSectionBlock[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r, i): SiteSectionBlock[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const padRaw = Array.isArray(o.padding) ? o.padding : [];
    const cols = Array.isArray(o.columns) ? o.columns : [];
    return [{
      id: str(o.id, 60) ?? `s${i}`,
      name: str(o.name, 120),
      width: o.width === "contained" ? "contained" : "full",
      background: normaliseBackground(o.background),
      padding: [num(padRaw[0]) ?? 64, num(padRaw[1]) ?? 64],
      // A section with no columns at all is still a section - an empty band the editor can fill,
      // not a reason to drop the row and silently lose it from the page.
      columns: (cols.length ? cols : [[]]).map((col) =>
        (Array.isArray(col) ? col : []).map(normaliseBlock).filter((b): b is SiteBlock => b !== null),
      ),
    }];
  });
}

export function normaliseTheme(raw: unknown): SiteTheme {
  const base = defaultTheme();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  return {
    primary: str(o.primary, 40) ?? base.primary,
    onPrimary: str(o.onPrimary, 40) ?? base.onPrimary,
    background: str(o.background, 40) ?? base.background,
    text: str(o.text, 40) ?? base.text,
    textMuted: str(o.textMuted, 40) ?? base.textMuted,
    headingFont: str(o.headingFont, 200) ?? base.headingFont,
    bodyFont: str(o.bodyFont, 200) ?? base.bodyFont,
    radius: num(o.radius) ?? base.radius,
    contentWidth: num(o.contentWidth) ?? base.contentWidth,
  };
}

export function normaliseNav(raw: unknown): NavItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((r): NavItem[] => {
    if (!r || typeof r !== "object") return [];
    const o = r as Record<string, unknown>;
    const label = str(o.label, 120);
    const href = str(o.href, 2000);
    return label && href ? [{ label, href, forwardParams: o.forwardParams === true }] : [];
  });
}

// ─────────────────────────── Paths ───────────────────────────

/**
 * Normalise a public page path.
 *
 * NOT `slugify`. The live URLs are being reproduced exactly and "/aboutus" is not what slugify
 * would produce from "About Us" - it would give "about-us" and quietly break every inbound link
 * and every ad already pointing at the real one.
 */
export function normalisePath(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed || trimmed === "/") return "/";
  const cleaned = trimmed
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/\/+/g, "/")
    .slice(0, 120);
  return cleaned ? `/${cleaned}` : "/";
}
