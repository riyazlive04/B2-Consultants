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
  | { kind: "image"; url: string; overlay?: string }
  /**
   * A CSS gradient, stored as the raw `linear-gradient(...)` / `radial-gradient(...)` value.
   *
   * A flat colour cannot express the navy the site's hero and CTA bands are actually painted in -
   * it is a three-stop 165deg ramp, and approximating it with its middle stop is visibly not the
   * same band. Kept as a string rather than a stop list because the value is copied verbatim from
   * a design, and a structured model would only have to be flattened back into this on render.
   *
   * Validated at the normaliser, not here: only `linear-gradient(...)` and `radial-gradient(...)`
   * are accepted, so a stored page cannot smuggle `url(...)` or a second declaration into the
   * style attribute.
   */
  | { kind: "gradient"; css: string };

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

/**
 * Per-element presentation overrides, set from the editor's Styles tab. Every field is optional
 * and absent means "use the theme" - so a page built before these existed renders exactly as
 * it did, and an author only ever overrides the one property they meant to.
 */
export type BlockStyle = {
  /** px. */
  fontSize?: number;
  fontWeight?: 400 | 500 | 600 | 700 | 800;
  /** px; may be negative for tight headlines. */
  letterSpacing?: number;
  textTransform?: "none" | "uppercase" | "capitalize";
  /** Background of the element itself - today only buttons paint one. */
  background?: string;
  /** Corner radius in px. Absent = the theme radius. */
  radius?: number;
  /**
   * Cap the element's own width in px, independent of the section's.
   *
   * A centred intro paragraph under a section title runs to the full 1170px content width without
   * this, which is roughly 160 characters a line - unreadable, and not what any of these designs
   * do. Centred blocks are centred within the cap.
   */
  maxWidth?: number;
  /** Unitless line-height. Tight (1.05) on a display number, loose (1.8) on body copy. */
  lineHeight?: number;
};

/**
 * A column's own box - background, padding, radius, border.
 *
 * ── Why this is not per-block styling ─────────────────────────────────────────────────────────
 * A card on this design is FOUR blocks (icon, title, paragraph, feature list) that share one white
 * rounded box. Painting a background on each block gives four boxes; painting it on the section
 * gives one band behind all three cards. The box belongs to the column, which is the only node
 * between the two.
 *
 * ── Why a parallel array and not a field on the column ────────────────────────────────────────
 * `columns` is `SiteBlock[][]` - a bare list with no node of its own - and every page, template
 * and builder call site is written against that shape. `columnStyles[i]` styles column `i` and
 * leaves all of them untouched; turning columns into objects would be a migration of every stored
 * page for a feature that is optional on all of them.
 */
export type ColumnStyle = {
  background?: string;
  /** Text colour for the whole card. Set it and the blocks inside inherit, as on a coloured band. */
  color?: string;
  /** px, CSS shorthand order: [top, right, bottom, left]. */
  padding?: [number, number, number, number];
  radius?: number;
  borderWidth?: number;
  borderColor?: string;
  shadow?: "none" | "card" | "soft";
  /**
   * This column's share of the row, as a grid fr weight. Default 1 - every column equal.
   *
   * Equal columns cannot describe a header (a small logo, a wide menu, a button) or the founder
   * band's 1 / 1.3 portrait-and-copy split. Applied only at the widest breakpoint: once the row
   * has folded to two-up or stacked, a weight is describing a layout that is no longer there.
   */
  grow?: number;
  /**
   * Where the blocks sit vertically when this column is shorter than the row.
   *
   * Grid stretches every column to the tallest one, so a short column next to three paragraphs of
   * copy pins its contents to the top with the remainder as dead space below - which reads as a
   * mistake rather than as a layout. Default "start", the behaviour every existing page has.
   */
  justify?: "start" | "center" | "end";
  /**
   * Vertical gap between the blocks in px.
   *
   * The column's default is a generous 20px, which is right for a page band and wrong inside a
   * card: a heading and the caption belonging to it read as one unit at 8px and as two unrelated
   * lines at 20px. Every card on this design sets it.
   */
  gap?: number;
};

export type SiteBlock = {
  id: string;
  type: SiteBlockType;
  text?: string;
  /**
   * The tail of the line, painted in the accent colour - "…get <span>hired in Germany.</span>".
   *
   * Every headline on this site ends in a coloured phrase, and it has to stay on the SAME line as
   * the rest of the sentence. Two stacked blocks cannot do that: they are two paragraphs with a
   * gap between them, which reads as two headlines. One field, appended inline, is the whole
   * mechanism - and it degrades to nothing when unset, so no existing block changes.
   */
  accentText?: string;
  /** Colour of `accentText`. Absent = the theme's primary, which is what it means every time. */
  accentColor?: string;
  align?: "left" | "center" | "right";
  url?: string;
  alt?: string;
  label?: string;
  /** Second, smaller line under a button's label ("Free · 45 min"). */
  subText?: string;
  href?: string;
  /** Open the link in a new tab. Internal links default to the same tab; external ones always open new. */
  newTab?: boolean;
  /** See NavItem.forwardParams - same job, for a CTA button. */
  forwardParams?: boolean;
  variant?: "primary" | "soft" | "outline";
  style?: BlockStyle;
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
  /**
   * The `id` this band renders with, so the header menu can link to it as `/#about`.
   *
   * Explicitly authored rather than reusing `id`: the storage id is a generated string the author
   * never sees, and a menu built on it would break the moment a section is rebuilt from a
   * template. It is also the only field here a visitor can observe, so it is filtered to
   * `[A-Za-z][A-Za-z0-9_-]*` at the normaliser rather than trusted.
   */
  anchor?: string;
  /** Columns of blocks. One entry = a single column; two = the live "About Me" band. */
  columns: SiteBlock[][];
  /** Per-column box, positionally matched to `columns`. See ColumnStyle. */
  columnStyles?: (ColumnStyle | null)[];
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
  if (o.kind === "gradient") {
    const css = str(o.css, 400);
    // The value lands in a style attribute, so it is checked rather than trusted: one gradient
    // function, balanced parens, and no `;`, `{`, `}` or `url(` that could close the declaration
    // and start another. A page that fails the check renders as a plain band, not as an injection.
    const ok =
      !!css &&
      /^(linear|radial)-gradient\([^;{}]*\)$/.test(css) &&
      !/url\s*\(/i.test(css) &&
      css.split("(").length === css.split(")").length;
    return ok ? { kind: "gradient", css } : { kind: "none" };
  }
  return { kind: "none" };
}

const SHADOWS = new Set(["none", "card", "soft"]);

/** [t, r, b, l] in px, or undefined - a partial box is dropped rather than half-applied. */
function box(raw: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(raw) || raw.length !== 4) return undefined;
  const v = raw.map(num);
  return v.every((x): x is number => x !== undefined && x >= 0 && x <= 400)
    ? [v[0], v[1], v[2], v[3]] as [number, number, number, number]
    : undefined;
}

function normaliseColumnStyle(raw: unknown): ColumnStyle | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const c: ColumnStyle = {};
  const bg = str(o.background, 400);
  if (bg) c.background = bg;
  const col = str(o.color, 40);
  if (col) c.color = col;
  const pad = box(o.padding);
  if (pad) c.padding = pad;
  const r = num(o.radius);
  if (r !== undefined && r >= 0 && r <= 200) c.radius = r;
  const bw = num(o.borderWidth);
  if (bw !== undefined && bw >= 0 && bw <= 20) c.borderWidth = bw;
  const bc = str(o.borderColor, 40);
  if (bc) c.borderColor = bc;
  if (typeof o.shadow === "string" && SHADOWS.has(o.shadow)) c.shadow = o.shadow as ColumnStyle["shadow"];
  const g = num(o.gap);
  if (g !== undefined && g >= 0 && g <= 200) c.gap = g;
  const gr = num(o.grow);
  if (gr !== undefined && gr > 0 && gr <= 20) c.grow = gr;
  if (o.justify === "center" || o.justify === "end" || o.justify === "start") c.justify = o.justify;
  // An empty object is dropped, so "no box" serialises as null on the way back out too.
  return Object.keys(c).length ? c : null;
}

const WEIGHTS = new Set([400, 500, 600, 700, 800]);

function normaliseStyle(raw: unknown): BlockStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const s: BlockStyle = {};
  const fs = num(o.fontSize);
  if (fs !== undefined && fs >= 8 && fs <= 200) s.fontSize = fs;
  const fw = num(o.fontWeight);
  if (fw !== undefined && WEIGHTS.has(fw)) s.fontWeight = fw as BlockStyle["fontWeight"];
  const ls = num(o.letterSpacing);
  if (ls !== undefined && ls >= -10 && ls <= 40) s.letterSpacing = ls;
  if (o.textTransform === "uppercase" || o.textTransform === "capitalize" || o.textTransform === "none") {
    s.textTransform = o.textTransform;
  }
  const bg = str(o.background, 40);
  if (bg) s.background = bg;
  const r = num(o.radius);
  if (r !== undefined && r >= 0 && r <= 200) s.radius = r;
  const mw = num(o.maxWidth);
  if (mw !== undefined && mw >= 40 && mw <= 2000) s.maxWidth = mw;
  const lh = num(o.lineHeight);
  if (lh !== undefined && lh >= 0.8 && lh <= 3) s.lineHeight = lh;
  // An empty object is dropped so "no overrides" serialises the same way it always did.
  return Object.keys(s).length ? s : undefined;
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
    accentText: str(o.accentText, 500),
    accentColor: str(o.accentColor, 40),
    align,
    url: str(o.url),
    alt: str(o.alt, 300),
    label: str(o.label, 200),
    subText: str(o.subText, 200),
    href: str(o.href),
    newTab: o.newTab === true,
    forwardParams: o.forwardParams === true,
    variant,
    style: normaliseStyle(o.style),
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
    const colStyles = Array.isArray(o.columnStyles) ? o.columnStyles.map(normaliseColumnStyle) : [];
    // An anchor is a DOM id a visitor's URL can address, so it is filtered to an identifier here
    // rather than escaped at render - there is exactly one place to get that wrong.
    const anchorRaw = str(o.anchor, 60);
    const anchor = anchorRaw && /^[A-Za-z][A-Za-z0-9_-]*$/.test(anchorRaw) ? anchorRaw : undefined;
    return [{
      id: str(o.id, 60) ?? `s${i}`,
      name: str(o.name, 120),
      width: o.width === "contained" ? "contained" : "full",
      background: normaliseBackground(o.background),
      padding: [num(padRaw[0]) ?? 64, num(padRaw[1]) ?? 64],
      anchor,
      // Dropped entirely when no column carries a box, so a page that never used one serialises
      // exactly as it did before this field existed.
      columnStyles: colStyles.some((c) => c !== null) ? colStyles : undefined,
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
