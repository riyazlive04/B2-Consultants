import type { ReactNode } from "react";

/**
 * The app's presentational vocabulary, extracted from the Users & access screen.
 *
 * Before this file every screen re-invented the same card: 127 copies of
 * `rounded-card border border-line bg-surface p-5 shadow-card`, each a little
 * different. Now there is one way to build a page, and re-theming happens in
 * globals.css rather than in a hundred className strings.
 *
 * Nothing here holds state or handlers, so a server component can render it
 * directly. Anything interactive lives in `controls.tsx`.
 *
 * RULE: no hex, ever. Every colour resolves through a CSS variable, which is the
 * only reason the dark theme keeps working for free.
 */

// ───────────────────────────── tone ─────────────────────────────

/** Colour is spent on MEANING only (design system §1). These are the meanings. */
export type Tone = "neutral" | "primary" | "good" | "warn" | "bad" | "info";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "text-muted bg-surface-2",
  primary: "text-primary-strong bg-primary-soft",
  good: "text-good bg-good-soft",
  warn: "text-warn bg-warn-soft",
  bad: "text-bad bg-bad-soft",
  info: "text-ink-2 bg-sky",
};

// ───────────────────────────── page chrome ─────────────────────────────

/**
 * Every page opens the same way: title, one line of orientation, actions on the
 * right. Nineteen pages each hand-rolled this; now they don't.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  eyebrow,
  icon,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  eyebrow?: string;
  /** a line icon; rendered in the soft primary chip the section headers use */
  icon?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3.5">
        {icon && (
          <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-field bg-primary-soft text-primary">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{eyebrow}</p>
          )}
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/**
 * The one card. `flush` drops the body padding for tables and lists that draw
 * their own row dividers edge to edge.
 */
export function Card({
  title,
  subtitle,
  actions,
  children,
  footer,
  flush = false,
  className = "",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
}) {
  const hasHeader = Boolean(title || actions);
  return (
    <section className={`overflow-hidden rounded-card border border-line bg-surface shadow-card ${className}`}>
      {hasHeader && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {typeof title === "string" ? (
              <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
            ) : (
              title
            )}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={flush ? "" : "p-5"}>{children}</div>
      {footer && <div className="border-t border-line bg-surface-2 px-5 py-3">{footer}</div>}
    </section>
  );
}

/** An icon + words card heading. Pass it as `Card`'s `title`. */
export function CardTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2 font-display text-[15px] font-semibold text-ink">
      {icon && <span className="text-primary">{icon}</span>}
      {children}
    </span>
  );
}

/** A bare panel — the card's inset cousin, for grouping inside a Card. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-field border border-line bg-surface-2 p-3.5 ${className}`}>{children}</div>;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-3">{children}</div>;
}

export function Hint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted">{children}</p>;
}

export function Divider() {
  return <hr className="border-t border-line" />;
}

/** Responsive grid for metric cards / stat tiles. */
export function Grid({ cols = 4, children }: { cols?: 2 | 3 | 4; children: ReactNode }) {
  const cls =
    cols === 2
      ? "sm:grid-cols-2"
      : cols === 3
        ? "sm:grid-cols-2 lg:grid-cols-3"
        : "sm:grid-cols-2 lg:grid-cols-4";
  return <div className={`grid grid-cols-1 gap-4 ${cls}`}>{children}</div>;
}

// ───────────────────────────── badges & identity ─────────────────────────────

export function Pill({
  tone = "neutral",
  children,
  title,
}: {
  tone?: Tone;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

/** A chip that names a thing rather than a state — outlined, not filled. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex whitespace-nowrap rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
      {children}
    </span>
  );
}

export function Avatar({
  name,
  image,
  size = 36,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  const initials = name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";
  if (image) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={image} alt="" className="flex-none rounded-full object-cover" style={{ height: size, width: size }} />;
  }
  return (
    <span
      aria-hidden
      className="grid flex-none place-items-center rounded-full bg-primary-soft font-bold text-primary-strong"
      style={{ height: size, width: size, fontSize: size * 0.36 }}
    >
      {initials}
    </span>
  );
}

/** Name over email — the table cell that identifies a person. */
export function PersonCell({
  name,
  secondary,
  image,
  badge,
}: {
  name: string;
  secondary?: string;
  image?: string | null;
  badge?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={name} image={image} />
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          <span className="truncate">{name}</span>
          {badge}
        </p>
        {secondary && <p className="truncate text-xs text-ink-3">{secondary}</p>}
      </div>
    </div>
  );
}

// ───────────────────────────── tables ─────────────────────────────

/**
 * Table chrome only. Pages own their rows — a generic row renderer buys nothing
 * once cells contain buttons, pills and links, which they always do here.
 */
export function TableShell({
  head,
  children,
  minWidth = 820,
}: {
  head: ReactNode;
  children: ReactNode;
  minWidth?: number;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left" style={{ minWidth }}>
        <thead>
          <tr className="border-b border-line bg-surface-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">
            {head}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, align = "left" }: { children?: ReactNode; align?: "left" | "right" }) {
  return (
    <th scope="col" className={`px-5 py-3 ${align === "right" ? "text-right" : ""}`}>
      {children}
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
}: {
  children?: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return <td className={`px-5 py-4 ${align === "right" ? "tnum text-right" : ""} ${className}`}>{children}</td>;
}

export function Tr({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <tr className={`border-b border-line last:border-b-0 ${className}`}>{children}</tr>;
}

// ───────────────────────────── empty & loading ─────────────────────────────

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid place-items-center rounded-field border border-dashed border-line-strong bg-surface-2 px-6 py-12 text-center">
      {icon && <span className="mb-3 text-ink-3">{icon}</span>}
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {body && <p className="mt-1 max-w-md text-sm text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Label above a figure — the small stat used inside cards and headers. */
export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p
        className={`tnum mt-0.5 font-display text-xl font-bold tracking-tight ${
          tone && tone !== "neutral" ? TONE_CLASS[tone].split(" ")[0] : "text-ink"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/** A labelled horizontal bar. Used for targets, goals, quota. */
export function ProgressBar({ pct, tone = "primary" }: { pct: number; tone?: Tone }) {
  const colour =
    tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)" : tone === "bad" ? "var(--bad)" : "var(--primary)";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: colour }}
      />
    </div>
  );
}
