"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  Wallet,
  Landmark,
  GitBranch,
  CalendarCheck,
  Users,
  GraduationCap,
  ClipboardList,
  Filter,
  FileSearch,
  Map,
  BookOpen,
  UserCircle,
  LayoutGrid,
  LogOut,
  Menu,
  Trophy,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  type LucideIcon,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";

export type NavItem = { key: string; label: string; href: string; phase: number };

const ICONS: Record<string, LucideIcon> = {
  finance: Wallet,
  cash: Landmark,
  pipeline: GitBranch,
  bookings: CalendarCheck,
  people: Users,
  students: GraduationCap,
  "daily-log": ClipboardList,
  arena: Trophy,
  "my-journey": Map,
  funnel: Filter,
  "cv-check": FileSearch,
  guide: BookOpen,
};

// Information architecture: 9+ flat sections grouped into scannable areas.
const GROUP_DEFS: { label: string; keys: string[] }[] = [
  { label: "Money", keys: ["finance", "cash", "pipeline", "bookings"] },
  { label: "People", keys: ["people", "students", "daily-log", "arena", "my-journey"] },
  { label: "Insights", keys: ["funnel", "cv-check"] },
  { label: "Workspace", keys: ["guide"] },
];

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
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  // restore collapsed preference
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("b2-nav-collapsed") === "1");
    } catch {
      /* ignore */
    }
  }, []);

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

  // Role identity: the accent hue already shifts per role (globals.css data-role themes);
  // this labelled chip anchors what the colour means.
  const roleLabel =
    { ADMIN: "Admin", HEAD: "Head", USER: "Member", STUDENT: "Student" }[user.role] ?? user.role;

  // Build groups from the role-filtered items; anything unmatched still shows.
  const used = new Set<string>();
  const groups = GROUP_DEFS.map((g) => ({
    label: g.label,
    items: g.keys.map((k) => items.find((i) => i.key === k)).filter(Boolean) as NavItem[],
  })).filter((g) => g.items.length);
  groups.forEach((g) => g.items.forEach((i) => used.add(i.key)));
  const leftovers = items.filter((i) => !used.has(i.key));
  if (leftovers.length) groups.push({ label: "More", items: leftovers });

  const Avatar = ({ size = 36 }: { size?: number }) =>
    user.image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.image} alt="" className="flex-none rounded-full object-cover" style={{ height: size, width: size }} />
    ) : (
      <span
        className="grid flex-none place-items-center rounded-full bg-accent font-semibold text-white"
        style={{ height: size, width: size, fontSize: size * 0.34 }}
      >
        {initials}
      </span>
    );

  const NavRow = ({ item, compact }: { item: NavItem; compact: boolean }) => {
    const active = isActive(item.href);
    const Icon = ICONS[item.key] ?? LayoutGrid;
    return (
      <Link
        href={item.href}
        prefetch
        title={compact ? item.label : undefined}
        className={`rail-item group flex items-center gap-3 rounded-field text-sm ${
          compact ? "justify-center px-2 py-2.5" : "px-3 py-2.5"
        } ${active ? "is-active" : ""}`}
      >
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
          <span className="rail-brand grid h-10 w-10 flex-none place-items-center rounded-2xl text-sm font-bold backdrop-blur">
            B2
          </span>
          {!compact && (
            <span className="flex flex-col leading-tight">
              <span className="text-sm font-semibold text-white">B2 Consultants</span>
              <span className="rail-eyebrow text-[11px]">Founder Dashboard</span>
            </span>
          )}
        </Link>
        {!inDrawer && !compact && (
          <button
            type="button"
            onClick={toggleCollapse}
            aria-label="Collapse sidebar"
            className="rail-soft grid h-8 w-8 place-items-center rounded-field"
          >
            <PanelLeftClose size={17} />
          </button>
        )}
      </div>

      {!inDrawer && compact && (
        <button
          type="button"
          onClick={toggleCollapse}
          aria-label="Expand sidebar"
          className="rail-soft mb-2 grid h-9 w-full place-items-center rounded-field"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      {/* grouped nav */}
      <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.label}>
            {compact ? (
              <div className="rail-divider mx-2 mb-1 border-t" />
            ) : (
              <p className="rail-eyebrow px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
                {g.label}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {g.items.map((it) => (
                <li key={it.key}>
                  <NavRow item={it} compact={compact} />
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Account */}
        <div>
          {compact ? (
            <div className="rail-divider mx-2 mb-1 border-t" />
          ) : (
            <p className="rail-eyebrow px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
              Account
            </p>
          )}
          <NavRow item={{ key: "profile", label: "My Profile", href: "/profile", phase: 0 }} compact={compact} />
        </div>
      </div>

      {/* user + logout */}
      <div className="rail-divider mt-3 border-t pt-3">
        <Link
          href="/profile"
          prefetch
          title={compact ? user.name : undefined}
          className={`rail-soft flex items-center gap-3 rounded-field py-2 ${
            compact ? "justify-center px-2" : "px-2"
          }`}
        >
          <Avatar size={compact ? 30 : 36} />
          {!compact && (
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                <span className="truncate">{user.name}</span>
                <span className="rail-chip flex-none rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide">
                  {roleLabel}
                </span>
              </p>
              <p className="rail-eyebrow truncate text-xs">{user.email}</p>
            </div>
          )}
        </Link>
        <button
          type="button"
          onClick={logout}
          title={compact ? "Log out" : undefined}
          className={`rail-soft mt-1 flex w-full items-center gap-3 rounded-field py-2 text-sm ${
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
      {/* desktop rail — floating violet dock */}
      <aside
        className={`sticky top-0 hidden h-screen flex-none p-3 transition-[width] duration-200 md:block ${
          collapsed ? "w-[92px]" : "w-[272px]"
        }`}
      >
        <div className="rail-violet h-full overflow-hidden rounded-[28px]">
          <Rail compact={collapsed} />
        </div>
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line px-4 md:px-8">
          {/* mobile: hamburger + brand */}
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
            className="grid h-9 w-9 place-items-center rounded-field text-ink hover:bg-surface-2 md:hidden"
          >
            <Menu size={20} />
          </button>
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-accent text-xs font-bold text-white">B2</span>
          </Link>

          {/* search pill — signature top-bar element */}
          <label className="ml-1 hidden items-center gap-2 rounded-full border border-line bg-surface-2 px-3.5 py-2 text-sm text-muted transition-colors focus-within:border-accent md:flex md:w-72">
            <Search size={16} className="flex-none" />
            <input
              type="search"
              placeholder="Search dashboard…"
              className="w-full bg-transparent text-ink placeholder:text-muted focus:outline-none"
            />
          </label>

          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <span className="hidden rounded-full bg-accent-soft px-3 py-1.5 font-display text-xs font-semibold tracking-tight text-accent lg:inline">
              {currentMonth}
            </span>
            {runwaySlot}
            {bellSlot}
            <Link href="/profile" title="Your profile" className="rounded-full transition-transform hover:scale-105">
              <Avatar size={34} />
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="overlay-in glass-scrim absolute inset-0" onClick={() => setDrawer(false)} />
          <aside className="dialog-in rail-violet absolute left-0 top-0 h-full w-[82%] max-w-xs rounded-r-[28px] shadow-pop">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setDrawer(false)}
              className="rail-soft absolute right-3 top-4 z-10 grid h-9 w-9 place-items-center rounded-field"
            >
              <X size={20} />
            </button>
            <Rail compact={false} inDrawer />
          </aside>
        </div>
      )}
    </div>
  );
}
