"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Wallet,
  GitBranch,
  Users,
  ClipboardList,
  GraduationCap,
  FileSearch,
  Filter,
  Landmark,
  BookOpen,
  CalendarCheck,
  Trophy,
  Map as MapIcon,
  LayoutGrid,
  Home,
  Menu,
  X,
  UserCircle,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { key: string; label: string; href: string; phase: number };

/** Map each section to a line icon. Falls back to a neutral grid glyph. */
const ICONS: Record<string, LucideIcon> = {
  finance: Wallet,
  pipeline: GitBranch,
  bookings: CalendarCheck,
  people: Users,
  "daily-log": ClipboardList,
  arena: Trophy,
  "my-journey": MapIcon,
  students: GraduationCap,
  "cv-check": FileSearch,
  funnel: Filter,
  cash: Landmark,
  guide: BookOpen,
};

/**
 * Light navigation rail (Realty-Hub style): a "Menu" label, items with soft
 * circular icon chips, and a dark rounded-pill for the active item. Fixed rail on
 * desktop; slides in behind a hamburger on mobile, plus a floating bottom nav.
 */
export function Sidebar({
  items,
  user,
}: {
  items: NavItem[];
  user: { name: string; email: string; role: string; image?: string | null };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const initials = user.name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const NavLink = ({ href, label, Icon }: { href: string; label: string; Icon: LucideIcon }) => {
    const active = isActive(href);
    return (
      <Link
        href={href}
        className={`group flex items-center gap-3 rounded-full py-1.5 pl-1.5 pr-3 text-sm transition-colors ${
          active ? "bg-ink text-white" : "text-ink hover:bg-sidebar-2"
        }`}
      >
        <span
          className={`grid h-8 w-8 flex-none place-items-center rounded-full transition-colors ${
            active ? "bg-white/15 text-white" : "bg-sidebar-2 text-ink group-hover:bg-white"
          }`}
        >
          <Icon size={16} strokeWidth={2} />
        </span>
        <span className="truncate">{label}</span>
      </Link>
    );
  };

  const nav = (
    <nav className="flex h-full flex-col p-4">
      {/* brand */}
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-1.5 py-1">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-accent text-sm font-bold text-white">
          B2
        </span>
        <span className="flex flex-col leading-tight">
          <span className="text-sm font-semibold text-ink">B2 Consultants</span>
          <span className="text-[11px] text-sidebar-muted">Founder Dashboard</span>
        </span>
      </Link>

      <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
          Menu
        </p>
        {items.map((item) => (
          <NavLink key={item.key} href={item.href} label={item.label} Icon={ICONS[item.key] ?? LayoutGrid} />
        ))}

        <p className="px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted">
          Account
        </p>
        <NavLink href="/profile" label="My Profile" Icon={UserCircle} />
      </div>

      {/* current user block → profile */}
      <Link
        href="/profile"
        className="mt-4 flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-2.5 transition-colors hover:bg-white"
      >
        {user.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.image} alt="" className="h-9 w-9 flex-none rounded-full object-cover" />
        ) : (
          <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-white">
            {initials}
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
          <p className="truncate text-xs text-muted">View profile</p>
        </div>
      </Link>
    </nav>
  );

  return (
    <>
      {/* mobile top strip */}
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface px-4 py-3 md:hidden">
        <Link href="/" className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-xs font-bold text-white">
            B2
          </span>
          <span className="text-sm font-semibold text-ink">B2 Consultants</span>
        </Link>
        <button
          type="button"
          aria-label="Open menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-surface-2"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="overlay-in absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="dialog-in absolute left-0 top-0 h-full w-[82%] max-w-xs bg-surface shadow-pop">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-surface-2"
            >
              <X size={20} />
            </button>
            {nav}
          </aside>
        </div>
      )}

      {/* desktop: fixed light rail */}
      <aside className="sticky top-0 hidden h-screen w-64 flex-none overflow-y-auto border-r border-line bg-sidebar md:block">
        {nav}
      </aside>

      {/* mobile: floating bottom nav */}
      <BottomNav items={items} isActive={isActive} onMore={() => setOpen(true)} />
    </>
  );
}

/** Floating pill navigation for phones - Home, top sections, and a More trigger. */
function BottomNav({
  items,
  isActive,
  onMore,
}: {
  items: NavItem[];
  isActive: (href: string) => boolean;
  onMore: () => void;
}) {
  const quick = items.filter((i) => i.href !== "/").slice(0, 3);
  const cell =
    "flex flex-1 flex-col items-center justify-center gap-0.5 rounded-full py-1.5 text-[11px] font-medium transition-colors";

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
      <div className="glass flex w-full max-w-md items-stretch gap-1 rounded-full border border-line p-1.5 shadow-pop">
        <Link href="/" className={`${cell} ${isActive("/") ? "bg-ink text-white" : "text-muted"}`}>
          <Home size={18} />
          Home
        </Link>
        {quick.map((item) => {
          const Icon = ICONS[item.key] ?? LayoutGrid;
          const active = isActive(item.href);
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`${cell} ${active ? "bg-ink text-white" : "text-muted"}`}
            >
              <Icon size={18} />
              <span className="max-w-[3.5rem] truncate">{item.label.split(" ")[0]}</span>
            </Link>
          );
        })}
        <button type="button" onClick={onMore} aria-label="More sections" className={`${cell} text-muted`}>
          <Menu size={18} />
          More
        </button>
      </div>
    </nav>
  );
}
