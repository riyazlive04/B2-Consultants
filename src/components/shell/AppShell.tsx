"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ChevronDown,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "./ThemeToggle";
import { RecordButton } from "./RecordButton";
import { BrandLogo } from "./BrandLogo";
import { FallbackIcon, SECTION_ICONS } from "./section-icons";
import { CommandPalette, openCommandPalette } from "@/components/ui/CommandPalette";
import { useModKey } from "@/lib/use-mod-key";
import type { SectionIconName } from "@/lib/sections";

/** Label, icon, group and order all come from the founder's section config. */
export type NavItem = {
  key: string;
  label: string;
  href: string;
  phase: number;
  icon: SectionIconName;
  group: string;
};

export function AppShell({
  items,
  user,
  currentMonth,
  runwaySlot,
  bellSlot,
  children,
}: {
  items: NavItem[];
  user: { name: string; email: string; role: string; image?: string | null };
  currentMonth: string;
  runwaySlot?: ReactNode;
  bellSlot?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { modLabel } = useModKey();
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  // §5.1: the rail collapses to icons below 1100px, regardless of preference.
  const [narrow, setNarrow] = useState(false);

  // Per-group collapse — the rail has ~27 items and used to overflow ~400px below the
  // fold with no way to fold a section. Collapsed group labels persist per-device.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // restore collapsed preference
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("b2-nav-collapsed") === "1");
      const raw = localStorage.getItem("b2-nav-groups-collapsed");
      if (raw) setCollapsedGroups(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore */
    }
  }, []);

  const toggleGroup = (label: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      try {
        localStorage.setItem("b2-nav-groups-collapsed", JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });

  // Track the 1100px breakpoint. The manual toggle can only ever collapse further,
  // never expand a rail the viewport is too narrow to hold.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1099px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const compactRail = collapsed || narrow;

  // close the mobile drawer on navigation + lock scroll + Esc
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (drawer) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [drawer]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setDrawer(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const toggleCollapse = () =>
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem("b2-nav-collapsed", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  const logout = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  // Seat names from the design file: USER seats are the telecallers.
  const roleLabel =
    { ADMIN: "Admin", HEAD: "Head coach", USER: "Telecaller", STUDENT: "Student", TUTOR: "Tutor" }[user.role] ??
    user.role;

  // The brand subtitle names the seat you're actually in — it used to read
  // "Founder Dashboard" for everyone, which was wrong for every non-Admin role.
  const workspaceLabel =
    {
      ADMIN: "Founder Dashboard",
      HEAD: "Head coach workspace",
      USER: "Telecaller workspace",
      STUDENT: "Student portal",
      TUTOR: "Tutor portal",
    }[user.role] ?? "Workspace";

  // `items` arrives pre-sorted in the founder's order. Group by its `group`, and let
  // each group land where its first item does — so reordering a section can move its
  // whole group up the rail, and no section can be orphaned by a group that isn't listed.
  const groups: { label: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const group = groups.find((g) => g.label === item.group);
    if (group) group.items.push(item);
    else groups.push({ label: item.group, items: [item] });
  }

  const Avatar = ({ size = 36 }: { size?: number }) =>
    user.image ? (
      // `user.image` is an arbitrary https URL or data: URL (see profile-actions.ts) — not a
      // fixed domain we can whitelist, so this opts out of the optimizer rather than widening
      // next.config's remotePatterns to any host.
      <Image
        src={user.image}
        alt=""
        width={size}
        height={size}
        unoptimized
        className="flex-none rounded-full object-cover"
      />
    ) : (
      <span
        className="grid flex-none place-items-center rounded-full bg-primary font-semibold text-on-accent"
        // floor initials at the 12px caption minimum (§2.1); a 32px avatar was 10.88px
        style={{ height: size, width: size, fontSize: Math.max(12, Math.round(size * 0.34)) }}
      >
        {initials}
      </span>
    );

  // Nav item (§5.2): resting ink-2 · hover surface-2 · active = primary-soft fill,
  // primary text, 3px accent bar on the left edge.
  const NavRow = ({ item, compact }: { item: NavItem; compact: boolean }) => {
    const active = isActive(item.href);
    const Icon = SECTION_ICONS[item.icon] ?? FallbackIcon;
    return (
      <Link
        href={item.href}
        prefetch
        title={compact ? item.label : undefined}
        aria-current={active ? "page" : undefined}
        className={`relative flex items-center gap-3 rounded-btn text-sm font-medium transition-colors ${
          compact ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
        } ${active ? "bg-primary-soft text-primary" : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`}
      >
        {active && (
          <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full bg-primary" />
        )}
        <Icon size={18} strokeWidth={2.1} className="flex-none" />
        {!compact && <span className="truncate">{item.label}</span>}
      </Link>
    );
  };

  const Rail = ({ compact, inDrawer = false }: { compact: boolean; inDrawer?: boolean }) => (
    <nav className="flex h-full flex-col p-3">
      {/* brand + collapse toggle */}
      <div className={`mb-5 flex items-center ${compact ? "justify-center" : "justify-between"} px-1`}>
        <Link href="/" prefetch className="flex items-center gap-2.5">
          <BrandLogo className="h-10 w-10 flex-none" />
          {!compact && (
            <span className="flex flex-col leading-tight">
              <span className="font-display text-sm font-bold text-ink">B2 Consultants</span>
              <span className="text-caption text-ink-3">{workspaceLabel}</span>
            </span>
          )}
        </Link>
        {!inDrawer && !compact && (
          <button
            type="button"
            onClick={toggleCollapse}
            aria-label="Collapse sidebar"
            className="grid h-10 w-10 place-items-center rounded-btn text-ink-2 hover:bg-surface-2 hover:text-ink"
          >
            <PanelLeftClose size={17} />
          </button>
        )}
      </div>

      {!inDrawer && compact && !narrow && (
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label="Expand sidebar"
          className="mb-2 grid h-10 w-full place-items-center rounded-btn text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      {/* Grouped nav. The scrollbar is deliberately shown: this list overflows by ~400px
          at 1080p (Reports, Founder Console, Automation, App Guide, My Profile all sit
          below the fold), and with it hidden there was no signal those sections existed. */}
      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {groups.map((g) => {
          // Collapse only applies to the labelled (expanded) rail — the icon rail has no
          // labels to click, so its items always show.
          const isCollapsed = !compact && collapsedGroups.has(g.label);
          return (
            <div key={g.label}>
              {compact ? (
                <div className="mx-2 mb-1 border-t border-line" />
              ) : (
                <button
                  type="button"
                  onClick={() => toggleGroup(g.label)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between rounded-btn px-3 pb-1 pt-0.5 text-label font-semibold uppercase text-ink-3 transition-colors hover:text-ink-2"
                >
                  <span>{g.label}</span>
                  <ChevronDown
                    size={14}
                    aria-hidden
                    className={`transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
                  />
                </button>
              )}
              {!isCollapsed && (
                <ul className="flex flex-col gap-1">
                  {g.items.map((it) => (
                    <li key={it.key}>
                      <NavRow item={it} compact={compact} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {/* Account */}
        <div>
          {compact ? (
            <div className="mx-2 mb-1 border-t border-line" />
          ) : (
            <p className="px-3 pb-1 text-label font-semibold uppercase text-ink-3">
              Account
            </p>
          )}
          <NavRow
            item={{ key: "profile", label: "My Profile", href: "/profile", phase: 0, icon: "layout-grid", group: "Account" }}
            compact={compact}
          />
        </div>
      </div>

      {/* user + logout */}
      <div className="mt-3 border-t border-line pt-3">
        <Link
          href="/profile"
          prefetch
          title={compact ? user.name : undefined}
          className={`flex min-h-10 items-center gap-3 rounded-btn py-2 transition-colors hover:bg-surface-2 ${
            compact ? "justify-center px-2" : "px-2"
          }`}
        >
          <Avatar size={compact ? 32 : 36} />
          {!compact && (
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <span className="truncate">{user.name}</span>
                <span className="flex-none rounded-full bg-primary-soft px-1.5 py-0.5 text-caption font-semibold uppercase tracking-wide text-primary-strong">
                  {roleLabel}
                </span>
              </p>
              <p className="truncate text-xs text-ink-3">{user.email}</p>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={logout}
          title={compact ? "Log out" : undefined}
          className={`mt-1 flex min-h-10 w-full items-center gap-3 rounded-btn py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink ${
            compact ? "justify-center px-2" : "px-2.5"
          }`}
        >
          <LogOut size={18} className="flex-none" />
          {!compact && <span>Log out</span>}
        </button>
      </div>
    </nav>
  );

  return (
    <div className="flex min-h-screen bg-canvas">
      {/* Skip link (WCAG 2.4.1): the first focusable element, so a keyboard/SR user can
          jump past the ~27-item rail straight to the page — the most-repeated interaction
          in the app. Off-screen until focused, then it drops in at the top-left. */}
      <a
        href="#main"
        className="sr-only rounded-btn bg-primary px-4 py-2 text-sm font-semibold text-on-accent shadow-pop focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[100]"
      >
        Skip to content
      </a>
      {/* desktop rail — flat white sidebar on a hairline border (§5.1) */}
      <aside
        className={`sticky top-0 hidden h-screen flex-none border-r border-line bg-surface transition-[width] duration-200 md:block ${
          compactRail ? "w-[76px]" : "w-[240px]"
        }`}
      >
        <Rail compact={compactRail} />
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface px-4 md:px-8">
          {/* mobile: hamburger + brand */}
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
            className="grid h-10 w-10 place-items-center rounded-btn text-ink hover:bg-surface-2 md:hidden"
          >
            <Menu size={20} />
          </button>
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <BrandLogo className="h-8 w-8" />
          </Link>

          {/* The always-visible metric strip: search · month · runway · theme · alerts · user.
              On a phone this cluster is what overflows the viewport (it needs ~320px next to
              the hamburger and brand), so the gap tightens and the month/theme drop out below
              their breakpoints. Search, runway (§9.4), alerts, profile and logout all stay. */}
          <div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-2 md:gap-3">
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label={`Search contacts, opportunities, invoices (${modLabel})`}
              title={`Search (${modLabel})`}
              className="flex h-10 items-center gap-2 rounded-full border border-line-strong bg-surface-2 px-3 text-sm text-ink-2 transition-colors hover:bg-surface hover:text-ink md:w-52"
            >
              <Search size={15} className="flex-none text-ink-3" />
              <span className="hidden truncate md:inline">Search…</span>
              <kbd className="ml-auto hidden flex-none rounded border border-line bg-surface px-1.5 py-0.5 font-mono text-[10px] font-semibold text-ink-3 md:inline">
                {modLabel}
              </kbd>
            </button>
            {/* Record CTA — Finance is an Admin section, so only Admin gets the quick-add. */}
            {user.role === "ADMIN" && <RecordButton />}
            <span className="hidden text-sm font-medium text-ink-2 lg:inline">{currentMonth}</span>
            {runwaySlot}
            {/* Theme falls back to the OS `prefers-color-scheme` when this is hidden, so a
                phone still gets the right mode — it just can't override it from the top bar. */}
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            {bellSlot}
            <Link href="/profile" title="Your profile" className="flex items-center gap-2 rounded-full py-1 md:pr-2">
              <Avatar size={34} />
              <span className="hidden max-w-36 truncate text-sm font-semibold text-ink xl:inline">
                {user.name}
              </span>
            </Link>
            {/* PRD §6: logout lives in the top bar (username · month · logout). */}
            <button
              type="button"
              onClick={logout}
              title="Log out"
              aria-label="Log out"
              className="grid h-10 w-10 place-items-center rounded-btn text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <LogOut size={18} />
            </button>
          </div>
        </header>

        {/* Full-width content: pages set their own max-width. Synamate-parity list pages
            (Contacts, Opportunities, Payments, …) go edge-to-edge; classic pages stay centred. */}
        <main
          id="main"
          tabIndex={-1}
          className="w-full flex-1 px-4 py-6 outline-none md:px-7 md:py-7"
        >
          {children}
        </main>
      </div>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="overlay-in glass-scrim absolute inset-0" onClick={() => setDrawer(false)} />
          <aside className="dialog-in absolute left-0 top-0 h-full w-[82%] max-w-xs bg-surface shadow-pop">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setDrawer(false)}
              className="absolute right-3 top-4 z-10 grid h-10 w-10 place-items-center rounded-btnd text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              <X size={20} />
            </button>
            <Rail compact={false} inDrawer />
          </aside>
        </div>
      )}

      {/* Global ⌘K command palette (BUILD_CHECKLIST.md §3) — one instance for the whole shell,
          so it's available from Contacts, Opportunities, Payments and everywhere else. Fed the
          user's own visible sections so ⌘K can navigate anywhere, not just to the 3 record types. */}
      <CommandPalette sections={items.map((it) => ({ label: it.label, href: it.href }))} />
    </div>
  );
}
