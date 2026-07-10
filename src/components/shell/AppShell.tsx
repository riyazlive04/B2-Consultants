"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import {
  LogOut,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { ThemeToggle } from "./ThemeToggle";
import { FallbackIcon, SECTION_ICONS } from "./section-icons";
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

  // Seat names from the design file: USER seats are the telecallers.
  const roleLabel =
    { ADMIN: "Admin", HEAD: "Head coach", USER: "Telecaller", STUDENT: "Student", TUTOR: "Tutor" }[user.role] ??
    user.role;

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
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.image} alt="" className="flex-none rounded-full object-cover" style={{ height: size, width: size }} />
    ) : (
      <span
        className="grid flex-none place-items-center rounded-full bg-primary font-semibold text-white"
        style={{ height: size, width: size, fontSize: size * 0.34 }}
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
          <span className="grid h-10 w-10 flex-none place-items-center rounded-btn bg-primary text-sm font-bold text-white">
            B2
          </span>
          {!compact && (
            <span className="flex flex-col leading-tight">
              <span className="font-display text-sm font-bold text-ink">B2 Consultants</span>
              <span className="text-[11px] text-ink-3">Founder Dashboard</span>
            </span>
          )}
        </Link>
        {!inDrawer && !compact && (
          <button
            type="button"
            onClick={toggleCollapse}
            aria-label="Collapse sidebar"
            className="grid h-8 w-8 place-items-center rounded-field text-ink-3 hover:bg-surface-2 hover:text-ink"
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
          className="mb-2 grid h-9 w-full place-items-center rounded-field text-ink-3 hover:bg-surface-2 hover:text-ink"
        >
          <PanelLeftOpen size={17} />
        </button>
      )}

      {/* grouped nav */}
      <div className="no-scrollbar flex flex-1 flex-col gap-3 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.label}>
            {compact ? (
              <div className="mx-2 mb-1 border-t border-line" />
            ) : (
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
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
            <div className="mx-2 mb-1 border-t border-line" />
          ) : (
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-3">
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
          className={`flex items-center gap-3 rounded-btn py-2 transition-colors hover:bg-surface-2 ${
            compact ? "justify-center px-2" : "px-2"
          }`}
        >
          <Avatar size={compact ? 30 : 36} />
          {!compact && (
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
                <span className="truncate">{user.name}</span>
                <span className="flex-none rounded-full bg-primary-soft px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary-strong">
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
          className={`mt-1 flex w-full items-center gap-3 rounded-btn py-2 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink ${
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
      {/* desktop rail — flat white sidebar on a hairline border (§5.1) */}
      <aside
        className={`sticky top-0 hidden h-screen flex-none border-r border-line bg-surface transition-[width] duration-200 md:block ${
          collapsed ? "w-[76px]" : "w-[240px]"
        }`}
      >
        <Rail compact={collapsed} />
      </aside>

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface px-4 md:px-8">
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
            <span className="grid h-8 w-8 place-items-center rounded-field bg-primary text-xs font-bold text-white">B2</span>
          </Link>

          {/* the always-visible metric strip: month · runway · theme · alerts · user */}
          <div className="ml-auto flex items-center gap-2 md:gap-3">
            <span className="hidden text-sm font-medium text-ink-2 lg:inline">{currentMonth}</span>
            {runwaySlot}
            <ThemeToggle />
            {bellSlot}
            <Link href="/profile" title="Your profile" className="flex items-center gap-2 rounded-full py-1 md:pr-2">
              <Avatar size={34} />
              <span className="hidden max-w-36 truncate text-sm font-semibold text-ink xl:inline">
                {user.name}
              </span>
            </Link>
          </div>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
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
              className="absolute right-3 top-4 z-10 grid h-9 w-9 place-items-center rounded-field text-ink-2 hover:bg-surface-2 hover:text-ink"
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
