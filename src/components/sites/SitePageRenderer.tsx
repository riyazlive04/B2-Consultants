import Image from "next/image";
import { buildForwardedHref, isExternalHref } from "@/lib/site-links";
import type {
  NavItem,
  SectionBackground,
  SiteBlock,
  SiteSectionBlock,
  SiteTheme,
} from "@/lib/site-types";

/**
 * Renders a marketing page.
 *
 * ── Why this is not `SiteBlocks.tsx` ──────────────────────────────────────────────────────────
 * The two now share a shape - `SiteBlocks` gained full-bleed section bands and per-node styling
 * for the VSL/landing-page rebuild, so the original reason (it could only paint a fixed
 * `max-w-2xl` column) no longer holds.
 *
 * What still separates them is the THEME. A funnel step is a campaign page that inherits the
 * dashboard's own tokens; a marketing page belongs to a Site with its own brand, injected as CSS
 * custom properties on a wrapper because that theme is per-site data edited at runtime and
 * Tailwind cannot generate classes for values it has never seen. Merging the two is a genuine
 * option once the visual builder lands - the honest blocker is the theme boundary, not layout.
 */

type Ctx = {
  theme: SiteTheme;
  /** Forwardable params from the visitor's own URL. See lib/site-links.ts. */
  incoming: Record<string, string>;
  /** Path of the page being rendered - stamped onto forwarded links. */
  fromPath: string;
  siteDomain?: string | null;
  nav: NavItem[];
  logoUrl?: string | null;
};

const ALIGN: Record<string, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

/**
 * The Google Fonts stylesheet for whatever families the theme names.
 *
 * Driven by the theme rather than a static `next/font` import, because the family is per-site data
 * the team edits at runtime - a build-time import cannot know it. Returns null for system stacks so
 * a theme using only `sans-serif` does not fetch anything.
 *
 * `display=swap` on purpose: text renders immediately in a fallback rather than staying invisible
 * while the webfont downloads. On a paid-traffic landing page, invisible text is a bounced visitor.
 */
function fontHref(theme: SiteTheme): string | null {
  const families = [theme.headingFont, theme.bodyFont]
    .map((stack) => stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "")
    .filter((f) => f && !/^(sans-serif|serif|monospace|system-ui|ui-sans-serif|inherit)$/i.test(f));

  const unique = [...new Set(families)];
  if (unique.length === 0) return null;

  const spec = unique.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700;800`);
  return `https://fonts.googleapis.com/css2?${spec.join("&")}&display=swap`;
}

/** Theme as inline custom properties. Read by the rules below via `var(--site-*)`. */
function themeVars(theme: SiteTheme): React.CSSProperties {
  return {
    "--site-primary": theme.primary,
    "--site-on-primary": theme.onPrimary,
    "--site-bg": theme.background,
    "--site-text": theme.text,
    "--site-text-muted": theme.textMuted,
    "--site-radius": `${theme.radius}px`,
    "--site-content": `${theme.contentWidth}px`,
    "--site-heading-font": theme.headingFont,
    "--site-body-font": theme.bodyFont,
  } as React.CSSProperties;
}

function backgroundStyle(bg: SectionBackground): React.CSSProperties {
  switch (bg.kind) {
    case "color":
      return { backgroundColor: bg.color };
    case "image":
      return {
        backgroundImage: bg.overlay
          ? `linear-gradient(${bg.overlay}, ${bg.overlay}), url(${bg.url})`
          : `url(${bg.url})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
      };
    default:
      return {};
  }
}

/**
 * Text colour for a block sitting on a section background.
 *
 * An explicit per-block `color` wins. Otherwise a block on a COLOURED band inherits, because the
 * band sets its own colour - this is what makes the white-on-violet "About Me" copy work without
 * the author setting a colour on all eight paragraphs by hand.
 */
function inkFor(b: SiteBlock, onBand: boolean, fallback: string): string | undefined {
  if (b.color) return b.color;
  return onBand ? undefined : fallback;
}

function Anchor({
  href,
  ctx,
  className,
  style,
  children,
  forwardParams,
}: {
  href: string;
  ctx: Ctx;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
  forwardParams?: boolean;
}) {
  // Server-side forwarding only helps where a request actually exists - the editor preview, or a
  // dynamically rendered page. The public pages are STATIC, so `incoming` is empty there and the
  // real work is done in the browser by <ForwardParams />, which keys off `data-forward`.
  const target = buildForwardedHref(href, {
    forwardParams,
    incoming: ctx.incoming,
    fromPath: ctx.fromPath,
  });
  const external = isExternalHref(href, ctx.siteDomain);
  return (
    <a
      href={target || "#"}
      className={className}
      style={style}
      {...(forwardParams ? { "data-forward": "1" } : {})}
      // noopener is the one that matters - an external target with window.opener can navigate the
      // page that opened it. noreferrer is kept alongside it as the conventional pair.
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

function Block({ b, ctx, onBand }: { b: SiteBlock; ctx: Ctx; onBand: boolean }) {
  const align = ALIGN[b.align ?? "left"] ?? "text-left";
  const { theme } = ctx;

  switch (b.type) {
    case "heading":
      return (
        <h1
          className={`text-[2.5rem] font-bold leading-tight sm:text-[3.25rem] ${align}`}
          style={{ fontFamily: "var(--site-heading-font)", color: inkFor(b, onBand, theme.text) }}
        >
          {b.text}
        </h1>
      );

    case "subheading":
      return (
        <h2
          className={`text-2xl font-semibold leading-snug sm:text-3xl ${align}`}
          style={{ fontFamily: "var(--site-heading-font)", color: inkFor(b, onBand, theme.text) }}
        >
          {b.text}
        </h2>
      );

    case "text":
      return (
        <p
          className={`whitespace-pre-wrap text-base leading-relaxed ${align}`}
          style={{ color: inkFor(b, onBand, theme.textMuted) }}
        >
          {b.text}
        </p>
      );

    case "image": {
      if (!b.url) return null;
      // Intrinsic dimensions are captured at upload (MediaAsset.width/height) so space can be
      // reserved before the bytes arrive. Without them a hero image shifts the page as it loads,
      // which is both a poor first impression and a Core Web Vitals penalty on ad traffic.
      const w = b.width ?? 1200;
      const h = b.height ?? 800;
      return (
        <div className={align}>
          <Image
            src={b.url}
            alt={b.alt ?? ""}
            width={w}
            height={h}
            className={`inline-block h-auto max-w-full ${b.rounded ? "aspect-square rounded-full object-cover" : ""}`}
            style={b.rounded ? undefined : { borderRadius: "var(--site-radius)" }}
            // The hero is almost always the Largest Contentful Paint element; letting it lazy-load
            // delays the metric the whole page is judged on.
            priority={b.rounded}
            sizes="(max-width: 768px) 100vw, 1200px"
          />
        </div>
      );
    }

    case "video":
      return b.url ? (
        <div
          className="relative overflow-hidden"
          style={{ paddingTop: "56.25%", borderRadius: "var(--site-radius)" }}
        >
          <iframe
            src={b.url}
            className="absolute inset-0 h-full w-full"
            allowFullScreen
            title={b.alt || "Video"}
          />
        </div>
      ) : null;

    case "map":
      return b.url ? (
        <iframe
          src={b.url}
          className="h-64 w-full border-0"
          style={{ borderRadius: "var(--site-radius)" }}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          title={b.alt || "Map"}
        />
      ) : null;

    case "button": {
      const filled = b.variant !== "soft" && b.variant !== "outline";
      return (
        <div className={align}>
          <Anchor
            href={b.href ?? "#"}
            ctx={ctx}
            forwardParams={b.forwardParams}
            className="inline-flex h-14 items-center justify-center px-9 text-base font-bold transition-opacity hover:opacity-90"
            style={{
              borderRadius: "var(--site-radius)",
              background: filled ? "var(--site-primary)" : b.variant === "soft" ? "#ffffff" : "transparent",
              color: filled ? "var(--site-on-primary)" : "var(--site-primary)",
              border: b.variant === "outline" ? "2px solid var(--site-primary)" : undefined,
            }}
          >
            {b.label || "Continue"}
          </Anchor>
        </div>
      );
    }

    case "bullets":
      return (
        <ul
          className="list-disc space-y-2 pl-6 text-base leading-relaxed"
          style={{ color: inkFor(b, onBand, theme.textMuted) }}
        >
          {(b.items ?? []).map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      );

    case "logo":
      return b.url ? (
        <Anchor href="/" ctx={ctx} className="inline-block">
          <Image
            src={b.url}
            alt={b.alt || "Logo"}
            width={b.width ?? 160}
            height={b.height ?? 64}
            className="h-auto w-auto"
            style={{ maxHeight: b.height ?? 64 }}
            priority
          />
        </Anchor>
      ) : null;

    case "nav":
      return (
        <nav className={`flex flex-wrap items-center gap-x-6 gap-y-2 ${b.align === "right" ? "justify-end" : b.align === "center" ? "justify-center" : ""}`}>
          {ctx.nav.map((item, i) => (
            <Anchor
              key={i}
              href={item.href}
              ctx={ctx}
              forwardParams={item.forwardParams}
              className="text-base font-medium transition-opacity hover:opacity-75"
              style={{ color: inkFor(b, onBand, theme.text) }}
            >
              {item.label}
            </Anchor>
          ))}
        </nav>
      );

    case "footerLinks":
      return (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm ${b.align === "center" ? "justify-center" : ""}`}>
          {(b.items ?? []).map((raw, i) => {
            // "Label|/path" - one string per link keeps the footer editable as a plain list in the
            // builder rather than needing a nested editor for three links.
            const [label, href] = raw.split("|").map((s) => s.trim());
            return (
              <Anchor
                key={i}
                href={href || "#"}
                ctx={ctx}
                className="underline-offset-2 hover:underline"
                style={{ color: inkFor(b, onBand, theme.textMuted) }}
              >
                {label || href}
              </Anchor>
            );
          })}
        </div>
      );

    case "divider":
      return <hr style={{ borderColor: onBand ? "rgba(255,255,255,.25)" : "rgba(0,0,0,.1)" }} />;

    case "spacer":
      return <div style={{ height: b.size ?? 24 }} />;

    case "form":
      // Wired in Stage 3 alongside the editor - the funnel PublicForm needs its props threaded
      // through, and a half-wired form on a live page captures nothing while looking like it does.
      return null;

    default:
      return null;
  }
}

function Section({ s, ctx }: { s: SiteSectionBlock; ctx: Ctx }) {
  const onBand = s.background.kind !== "none";
  const inner = (
    <div
      className={
        s.columns.length > 1
          ? `grid grid-cols-1 gap-10 md:grid-cols-${Math.min(s.columns.length, 4)}`
          : ""
      }
      // Tailwind cannot generate `md:grid-cols-N` for a runtime N, so the column count is set
      // inline. The class above stays for the gap and the mobile single-column default.
      style={
        s.columns.length > 1
          ? { gridTemplateColumns: `repeat(${s.columns.length}, minmax(0, 1fr))` }
          : undefined
      }
    >
      {s.columns.map((col, ci) => (
        <div key={ci} className="flex flex-col gap-5">
          {col.map((b) => (
            <Block key={b.id} b={b} ctx={ctx} onBand={onBand} />
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <section
      style={{
        ...backgroundStyle(s.background),
        paddingTop: s.padding[0],
        paddingBottom: s.padding[1],
        // A coloured band carries light text by default - the live site's violet sections are
        // white-on-violet, and making each block opt in would mean setting it on every paragraph.
        color: onBand ? "#ffffff" : undefined,
        ...(s.width === "contained"
          ? { maxWidth: "var(--site-content)", margin: "0 auto", borderRadius: "var(--site-radius)" }
          : {}),
      }}
      className="px-5"
    >
      <div style={{ maxWidth: "var(--site-content)", margin: "0 auto" }}>{inner}</div>
    </section>
  );
}

export default function SitePageRenderer({
  sections,
  header,
  footer,
  theme,
  nav,
  incoming,
  fromPath,
  siteDomain,
}: {
  sections: SiteSectionBlock[];
  header?: SiteSectionBlock[];
  footer?: SiteSectionBlock[];
  theme: SiteTheme;
  nav: NavItem[];
  incoming: Record<string, string>;
  fromPath: string;
  siteDomain?: string | null;
}) {
  const ctx: Ctx = { theme, incoming, fromPath, siteDomain, nav };
  const fonts = fontHref(theme);
  return (
    <div
      style={{
        ...themeVars(theme),
        background: "var(--site-bg)",
        color: "var(--site-text)",
        fontFamily: "var(--site-body-font)",
      }}
      className="min-h-screen"
    >
      {/* Next hoists a stylesheet link rendered here into <head>, so the font request starts with
          the document rather than after hydration. */}
      {fonts && <link rel="stylesheet" href={fonts} />}
      {header?.map((s) => <Section key={s.id} s={s} ctx={ctx} />)}
      <main>
        {sections.map((s) => (
          <Section key={s.id} s={s} ctx={ctx} />
        ))}
      </main>
      {footer?.map((s) => <Section key={s.id} s={s} ctx={ctx} />)}
    </div>
  );
}
