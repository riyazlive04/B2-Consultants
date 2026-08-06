import type { CSSProperties } from "react";
import type { Block, NodeStyle } from "@/lib/sites-types";
import { normalizeRow } from "@/lib/sites-types";
import type { PublicForm as PublicFormType } from "@/server/forms-metrics";
import PublicForm from "./PublicForm";
import { FormPopupTrigger } from "./FormPopup";

/**
 * Renders a funnel/site page's node tree (section → row → column → element).
 *
 * ── Why the styling is inline and not Tailwind classes ──────────────────────────
 * The builder lets an editor pick any padding, colour or width. Tailwind can only ship classes
 * that exist at build time, so a class-based approach would mean either a fixed menu of a dozen
 * paddings (which is not a page builder) or unsafe dynamic class names that the compiler strips.
 * Inline styles are the honest mechanism here. They stay bounded because `NodeStyle` is a closed
 * set of primitives — an editor cannot express `position: fixed`.
 *
 * ── Mobile ─────────────────────────────────────────────────────────────────────
 * A node's phone overrides can't be inline (there is no inline media query), so each node with a
 * `styleMobile` emits a scoped `@media` rule keyed on its own id. That keeps the desktop path at
 * zero extra bytes and only pays for nodes that actually differ.
 */

const ALIGN: Record<string, string> = { left: "text-left", center: "text-center", right: "text-right" };

/**
 * Design-token names resolve to the CSS variables the app already themes with, so a rebrand moves
 * every page; anything else is passed through as a literal (hex, rgb, gradient).
 */
const TOKENS: Record<string, string> = {
  primary: "var(--primary)", "primary-soft": "var(--primary-soft)", "primary-strong": "var(--primary-strong)",
  ink: "var(--ink)", "ink-2": "var(--ink-2)", "ink-3": "var(--ink-3)",
  surface: "var(--surface)", "surface-2": "var(--surface-2)", app: "var(--app)",
  line: "var(--line)", "on-accent": "var(--on-accent)",
};
const color = (v?: string) => (v ? TOKENS[v] ?? v : undefined);
const px = (n?: number) => (n == null ? undefined : `${n}px`);
const box = (v?: [number, number, number, number]) => (v ? v.map((n) => `${n}px`).join(" ") : undefined);

/**
 * Chip palette for `pill` and `avatar` — background / foreground pairs.
 *
 * Literal values rather than theme tokens: these are the LANDING PAGE's colours (amber for the
 * guarantee, green for a result, the three phase colours), and they must not shift when the
 * dashboard's accent changes with the signed-in user's role. A funnel page has one look for
 * everybody who lands on it.
 *
 * Each pair is chosen for contrast on its own background, so the text stays legible without a
 * second set of rules.
 */
const TONES: Record<string, { bg: string; fg: string }> = {
  neutral: { bg: "#eef1f5", fg: "#41505f" },
  amber: { bg: "#fef3c7", fg: "#92400e" },
  blue: { bg: "#e0edff", fg: "#1d4ed8" },
  green: { bg: "#f0fdf4", fg: "#166534" },
  orange: { bg: "#fff1e6", fg: "#c2410c" },
  navy: { bg: "#1b2f7d", fg: "#ffffff" },
  violet: { bg: "#efe9ff", fg: "#5b21b6" },
};

const SHADOW: Record<string, string> = {
  none: "none",
  card: "0 1px 2px rgba(0,0,0,.04), 0 1px 3px rgba(0,0,0,.06)",
  soft: "0 4px 16px rgba(0,0,0,.08)",
};

/** A NodeStyle → a real style object. Shared by the desktop path and the mobile media rule. */
function toCss(s: NodeStyle | Partial<NodeStyle> | undefined): CSSProperties {
  if (!s) return {};
  const out: CSSProperties = {
    background: color(s.background),
    color: color(s.color),
    padding: box(s.padding),
    margin: box(s.margin),
    borderRadius: px(s.radius),
    borderWidth: px(s.borderWidth),
    borderStyle: s.borderWidth ? "solid" : undefined,
    borderColor: color(s.borderColor),
    maxWidth: px(s.maxWidth),
    width: px(s.width),
    height: px(s.height),
    objectFit: s.objectFit,
    fontSize: px(s.fontSize),
    fontWeight: s.fontWeight,
    lineHeight: s.lineHeight,
    letterSpacing: px(s.letterSpacing),
    textAlign: s.align,
    gap: px(s.gap),
    boxShadow: s.shadow ? SHADOW[s.shadow] : undefined,
    display: s.hidden ? "none" : undefined,
    fontStyle: s.italic ? "italic" : undefined,
    /**
     * A column carries Tailwind's `flex-1`, which is `flex: 1 1 0%` — INCLUDING a zero basis.
     * Setting `flexGrow` alone therefore left the basis at 0, so a `grow: 0` column (the avatar,
     * the day badge) collapsed to nothing and the name printed straight over the top of it.
     * Restoring `auto` makes the column as wide as its content, which is what "don't grow" means
     * to whoever set it. `grow: 0` also stops shrinking, so a badge cannot be squeezed until its
     * text wraps.
     */
    flexGrow: s.grow,
    flexBasis: s.grow != null ? "auto" : undefined,
    flexShrink: s.grow === 0 ? 0 : undefined,
  };
  // Strip undefined so a parent's inherited value isn't clobbered by an explicit `undefined`.
  for (const k of Object.keys(out) as (keyof CSSProperties)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** Turns a style object into a CSS declaration body for the scoped mobile rule. */
function toCssText(s: CSSProperties): string {
  return Object.entries(s)
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v as string} !important`)
    .join(";");
}

/**
 * Section background presets.
 *
 * `dark` sets a foreground colour too — a band that changed only its background would render dark
 * ink on dark, which is how an inverted CTA strip silently becomes unreadable.
 */
const BAND: Record<string, CSSProperties> = {
  plain: { background: "var(--surface)" },
  muted: { background: "var(--surface-2)" },
  dark: { background: "#0e1f6b", color: "#ffffff" },
  brand: { background: "var(--primary)", color: "var(--on-accent)" },
};

function nodeStyle(b: Block): CSSProperties {
  const band = b.type === "section" ? BAND[b.background ?? "plain"] ?? {} : {};
  const css = { ...band, ...toCss(b.style) };
  // A section is full-bleed; its `maxWidth` caps the CONTENT inside it, not the band itself.
  // Leaving it on the outer element would shrink the coloured background to a centred stripe.
  if (b.type === "section") delete css.maxWidth;
  return css;
}

/**
 * Is this node inside an inverted (dark/brand) band?
 *
 * Threaded down the recursion rather than left to CSS inheritance, because the text elements
 * carry Tailwind colour classes (`text-ink-2`, `text-ink-3`) and a class beats an inherited
 * value every time. The visible symptom was the closing line of the navy CTA band rendering
 * near-black on navy — present, styled, and unreadable.
 */
function invertedFor(b: Block, parent: boolean): boolean {
  if (b.type !== "section") return parent;
  return b.background === "dark" || b.background === "brand";
}

function MobileRule({ b }: { b: Block }) {
  const css = toCssText(toCss(b.styleMobile));
  if (!css) return null;
  /**
   * `dangerouslySetInnerHTML`, not children — and it is the SAFE choice here, despite the name.
   *
   * As `<style>{css}</style>` React escapes the CSS as text: the `"` around the attribute value
   * became `&quot;` in the server HTML but stayed `"` on the client, so every styled node threw
   * a hydration mismatch and the rule never applied. Raw insertion is the documented way to emit
   * a stylesheet, and the value is not user input — it is a whitelisted `NodeStyle` rendered by
   * `toCssText`, with the id filtered below.
   *
   * The id is stripped to `[A-Za-z0-9_-]` regardless: it reaches us from stored page JSON, and a
   * `"` or `{` in it would let a saved page close the selector and write rules of its own.
   */
  const safeId = b.id.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeId) return null;
  return <style dangerouslySetInnerHTML={{ __html: `@media(max-width:640px){[data-n="${safeId}"]{${css}}}` }} />;
}

function renderBlock(b: Block, forms: Record<string, PublicFormType>, utm?: Record<string, string>, inv = false) {
  const align = ALIGN[b.style?.align ?? b.align ?? "left"] ?? "text-left";
  const style = nodeStyle(b);
  const inverted = invertedFor(b, inv);
  // On an inverted band every muted text tone becomes the band's OWN colour at reduced opacity,
  // so a secondary paragraph still reads as secondary instead of disappearing into the navy.
  const tone = (cls: string) => (inverted ? "text-current opacity-80" : cls);
  const kids = (list: Block[] | undefined) => (list ?? []).map((c) => renderBlock(c, forms, utm, inverted));
  /**
   * Every node carries its id (so the scoped mobile rule can target it) and its type.
   *
   * `data-t` costs a handful of bytes on the public page and buys the builder its entire model of
   * the document from the DOM alone: which nodes accept a drop inside, which can be typed into
   * directly. The alternative — the editor re-deriving that by walking the block tree in parallel
   * with the rendered output — is two representations of one page that can disagree.
   */
  // NOTE: no `key` in here. Spreading a key into JSX is deprecated in React 18 and removed in
  // 19 — it warns on every one of the ~100 nodes a landing page renders, and in 19 the key would
  // simply be dropped, breaking reconciliation. Each call site passes `key={b.id}` explicitly.
  const attrs = { "data-n": b.id, "data-t": b.type, style };

  switch (b.type) {
    // ── containers ──────────────────────────────────────────────────────────────
    case "section": {
      // Full-bleed: the page wrapper constrains content to a readable measure, but a band's
      // BACKGROUND has to reach both edges of the viewport. `100vw` would overflow by the
      // scrollbar's width, so the width comes from the wrapper and the bleed from padding.
      const inner = b.style?.maxWidth === 0 ? "w-full" : "mx-auto w-full";
      return (
        <section key={b.id} {...attrs} className="w-full">
          <MobileRule b={b} />
          <div className={`${inner} px-4`} style={{ maxWidth: b.style?.maxWidth || 1120 }}>
            <div className="flex flex-col gap-6">{kids(b.children)}</div>
          </div>
        </section>
      );
    }
    case "row": {
      const cols = normalizeRow(b);
      return (
        <div key={b.id} {...attrs} className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <MobileRule b={b} />
          {cols.map((c) => renderBlock(c, forms, utm, inverted))}
        </div>
      );
    }
    case "column":
      return (
        <div key={b.id} {...attrs} className="flex min-w-0 flex-1 flex-col gap-4">
          <MobileRule b={b} />
          {kids(b.children)}
        </div>
      );
    case "card":
      return (
        <div
          key={b.id}
          {...attrs}
          style={{ borderRadius: 14, borderWidth: 1, borderStyle: "solid", borderColor: "var(--line)", background: "var(--surface)", padding: "20px", ...style }}
          className="flex flex-col gap-3"
        >
          <MobileRule b={b} />
          {kids(b.children)}
        </div>
      );

    // ── text ────────────────────────────────────────────────────────────────────
    case "heading":
      return <h1 key={b.id} {...attrs} className={`font-display text-display-l font-bold ${align}`}><MobileRule b={b} />{b.text}</h1>;
    case "subheading":
      return <h2 key={b.id} {...attrs} className={`font-display text-h1 font-semibold ${align}`}><MobileRule b={b} />{b.text}</h2>;
    case "eyebrow":
      return (
        <p key={b.id} {...attrs} className={`text-caption font-semibold uppercase tracking-[0.14em] ${tone("text-ink-3")} ${align}`}>
          <MobileRule b={b} />{b.text}
        </p>
      );
    case "text":
      return <p key={b.id} {...attrs} className={`whitespace-pre-wrap text-base leading-relaxed ${tone("text-ink-2")} ${align}`}><MobileRule b={b} />{b.text}</p>;
    case "bullets":
      return b.variant === "check" || b.variant === "dash" ? (
        <ul key={b.id} {...attrs} className="flex flex-col gap-2.5">
          <MobileRule b={b} />
          {(b.items ?? []).map((it, i) => (
            <li key={i} className="flex items-start gap-2.5 text-base leading-relaxed">
              {/* aria-hidden: the marker is decoration. A screen reader already announces this
                  as a list item; reading "tick" before every line is noise. */}
              <span aria-hidden className={`mt-0.5 flex-none ${b.variant === "dash" ? "opacity-50" : "font-bold text-primary"}`}>
                {b.variant === "dash" ? "—" : "✔"}
              </span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul key={b.id} {...attrs} className={`list-disc space-y-1.5 pl-6 ${tone("text-ink-2")}`}>
          <MobileRule b={b} />
          {(b.items ?? []).map((it, i) => <li key={i}>{it}</li>)}
        </ul>
      );
    case "pill": {
      const t = TONES[b.tone ?? "neutral"] ?? TONES.neutral;
      return (
        <div key={b.id} {...attrs} className={align}>
          <MobileRule b={b} />
          <span
            // whitespace-nowrap: "27 days" broke onto two lines the moment its column was
            // narrow, turning a badge into a two-storey block.
            className="inline-block whitespace-nowrap rounded-full px-3 py-1 text-caption font-bold uppercase tracking-[0.1em]"
            style={{ background: t.bg, color: t.fg }}
          >
            {b.text}
          </span>
        </div>
      );
    }
    case "avatar": {
      const t = TONES[b.tone ?? "blue"] ?? TONES.blue;
      return (
        <div
          key={b.id}
          {...attrs}
          // aria-hidden: the initials duplicate the name printed right beside them, so announcing
          // "B K" before "Baby Karuppusamy" is noise to a screen reader, not information.
          aria-hidden
          className="grid h-11 w-11 flex-none place-items-center rounded-full text-sm font-bold"
          style={{ background: t.bg, color: t.fg, ...style }}
        >
          <MobileRule b={b} />
          {b.text}
        </div>
      );
    }
    case "dot": {
      const dt = TONES[b.tone ?? "blue"] ?? TONES.blue;
      return (
        // mt-[7px] aligns the disc with the cap height of the text beside it, not the top of
        // its box — which is where plain flex-start would put it.
        <span key={b.id} {...attrs} aria-hidden className="mt-[7px] block h-2 w-2 flex-none rounded-full" style={{ background: dt.fg, ...style }} />
      );
    }
    case "stat":
      return (
        <div key={b.id} {...attrs} className={align || "text-center"}>
          <MobileRule b={b} />
          <p className="font-display text-display-m font-bold leading-none">{b.text}</p>
          {b.label && <p className="mt-1.5 text-caption uppercase tracking-wide opacity-75">{b.label}</p>}
        </div>
      );

    // ── media & action ──────────────────────────────────────────────────────────
    case "image": {
      if (!b.url) return null;
      // eslint-disable-next-line @next/next/no-img-element
      const img = <img src={b.url} alt={b.alt ?? ""} className="mx-auto max-w-full rounded-card" />;
      const popupForm = b.opensFormId ? forms[b.opensFormId] : undefined;
      // A still with a play button drawn on it is a promise that clicking does something. When the
      // author has wired one up, the whole image becomes the control — `block` and `w-full` so the
      // button does not shrink-wrap and leave a dead strip beside the picture.
      return popupForm ? (
        <div key={b.id} {...attrs}>
          <MobileRule b={b} />
          <FormPopupTrigger
            form={popupForm}
            title={b.modalTitle}
            subtitle={b.modalSubtitle}
            utm={utm}
            ariaLabel={b.alt || "Open the form"}
            className="block w-full cursor-pointer rounded-card transition-opacity hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {img}
          </FormPopupTrigger>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img key={b.id} {...attrs} src={b.url} alt={b.alt ?? ""} className="mx-auto max-w-full rounded-card" />
      );
    }
    case "video":
      return b.url ? (
        <div key={b.id} {...attrs} className="relative overflow-hidden rounded-card" style={{ paddingTop: "56.25%", ...style }}>
          <MobileRule b={b} />
          {/*
            `allow` carries the permissions a Vimeo/YouTube player needs to be more than a picture:
            without `autoplay` a player that was told to start does nothing, and without
            `encrypted-media` a DRM-protected upload refuses to play at all. This matches the
            attribute list Vimeo's own embed code ships with, so pasting a plain player URL into
            this block behaves the same as pasting their full <iframe> into a Custom HTML block.

            `referrerPolicy` is Vimeo's default too — their CDN uses the referrer for domain-level
            privacy settings, so stripping it can turn a working video into a "not authorised".
          */}
          <iframe
            src={b.url}
            className="absolute inset-0 h-full w-full"
            allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            title={b.alt || "Video"}
          />
        </div>
      ) : null;
    case "button": {
      const btnCls = `inline-flex h-12 items-center justify-center rounded-btn px-6 text-base font-semibold ${
        b.variant === "soft"
          ? "bg-primary-soft text-primary-strong"
          : b.variant === "outline"
            ? "border border-primary text-primary-strong"
            : b.variant === "accent"
              // The amber CTA that sits on the navy band. Hard-coded rather than themed for
              // the same reason as TONES: a funnel page looks the same to every visitor.
              ? "bg-[#fbbf24] text-[#1f2937] hover:bg-[#f59e0b]"
              : "bg-primary text-on-accent hover:bg-primary-strong"
      }`;
      const popupForm = b.opensFormId ? forms[b.opensFormId] : undefined;
      return (
        <div key={b.id} {...attrs} className={align}>
          <MobileRule b={b} />
          {popupForm ? (
            // The popup wins over `href` when both are set — see the note on `opensFormId`.
            <FormPopupTrigger form={popupForm} title={b.modalTitle} subtitle={b.modalSubtitle} utm={utm} className={btnCls}>
              {b.label || "Continue"}
            </FormPopupTrigger>
          ) : (
            <a href={b.href || "#"} className={btnCls}>
              {b.label || "Continue"}
            </a>
          )}
        </div>
      );
    }
    case "form":
      return b.formId && forms[b.formId] ? (
        <div key={b.id} {...attrs} className="mx-auto w-full max-w-md"><MobileRule b={b} /><PublicForm form={forms[b.formId]} utm={utm} /></div>
      ) : (
        <p key={b.id} className="text-center text-sm text-ink-3">[form not published]</p>
      );

    // ── custom code ─────────────────────────────────────────────────────────────
    /**
     * GHL's "Custom HTML/Javascript". Rendered VERBATIM and unescaped — that is the entire
     * feature, and sanitising it would break the embeds (calendars, pixels, widgets) it exists
     * for. The safety boundary is therefore at authoring time, not here: only an admin with the
     * page-editing capability can create or edit one.
     */
    case "html":
      return b.html ? <div key={b.id} {...attrs} dangerouslySetInnerHTML={{ __html: b.html }} /> : null;

    // ── spacing ─────────────────────────────────────────────────────────────────
    case "divider":
      return <hr key={b.id} {...attrs} className="border-line" />;
    case "spacer":
      return <div key={b.id} {...attrs} style={{ height: b.size ?? 24, ...style }} />;
    default:
      return null;
  }
}

/**
 * Renders a page's node list.
 *
 * Sections are full-bleed and bring their own width; anything at the top level that is NOT a
 * section is a leaf from a page authored before the node model, so it keeps the old constrained
 * column. That is what lets every existing funnel step render untouched.
 */
export default function SiteBlocks({
  blocks,
  forms,
  utm,
}: {
  blocks: Block[];
  forms: Record<string, PublicFormType>;
  utm?: Record<string, string>;
}) {
  const legacy = blocks.filter((b) => b.type !== "section");
  const sections = blocks.filter((b) => b.type === "section");
  return (
    <>
      {legacy.length > 0 && (
        <div className="mx-auto max-w-2xl space-y-5 px-4 py-14">
          {legacy.map((b) => renderBlock(b, forms, utm))}
        </div>
      )}
      {sections.map((b) => renderBlock(b, forms, utm))}
    </>
  );
}
