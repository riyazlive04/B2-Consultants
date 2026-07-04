"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, LogOut, Menu, X, UserCircle } from "lucide-react";
import { authClient } from "@/lib/auth-client";

export type NavItem = { key: string; label: string; href: string; phase: number };

/**
 * Top pill navigation (Crextio style): brand on the left, a horizontally
 * scrollable row of pill links, and the account/actions on the right. The active
 * link is a filled dark pill. Collapses to a hamburger drawer on mobile.
 */
export function TopNav({
  items,
  user,
  currentMonth,
  runwaySlot,
  bellSlot,
}: {
  items: NavItem[];
  user: { name: string; email: string; role: string; image?: string | null };
  currentMonth: string;
  runwaySlot?: ReactNode;
  bellSlot?: ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
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

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");

  const initials = user.name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const logout = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  // Horizontal-scroll affordance for the pill nav: show fade + chevrons when the
  // row overflows, so it's obvious there's more to scroll to.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setEdges({
      left: el.scrollLeft > 4,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    measure();
    const el = scrollRef.current;
    el?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      el?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [measure, items.length]);

  const nudge = (dir: 1 | -1) =>
    scrollRef.current?.scrollBy({ left: dir * 240, behavior: "smooth" });

  const Avatar = ({ size = 32 }: { size?: number }) =>
    user.image ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={user.image} alt="" className="flex-none rounded-full object-cover" style={{ height: size, width: size }} />
    ) : (
      <span
        className="grid flex-none place-items-center rounded-full bg-accent font-semibold text-white"
        style={{ height: size, width: size, fontSize: size * 0.36 }}
      >
        {initials}
      </span>
    );

  return (
    <header className="glass sticky top-0 z-30 border-b border-line">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:px-8">
        {/* brand */}
        <Link href="/" className="flex flex-none items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-accent text-sm font-bold text-white">
            B2
          </span>
          <span className="hidden text-sm font-semibold text-ink sm:block">B2 Consultants</span>
        </Link>

        {/* desktop pill nav with scroll affordance (fade + chevrons when overflowing) */}
        <div className="relative hidden min-w-0 flex-1 md:block">
          {edges.left && (
            <>
              <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-surface to-transparent" />
              <button
                type="button"
                onClick={() => nudge(-1)}
                aria-label="Scroll navigation left"
                className="absolute left-0 top-1/2 z-20 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-muted shadow-sm hover:text-ink"
              >
                <ChevronLeft size={16} />
              </button>
            </>
          )}

          <nav
            ref={scrollRef}
            className="no-scrollbar flex items-center gap-1 overflow-x-auto scroll-smooth px-0.5"
          >
            {items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    active ? "bg-ink text-white" : "text-muted hover:bg-surface-2 hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {edges.right && (
            <>
              <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-surface to-transparent" />
              <button
                type="button"
                onClick={() => nudge(1)}
                aria-label="Scroll navigation right"
                className="absolute right-0 top-1/2 z-20 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-muted shadow-sm hover:text-ink"
              >
                <ChevronRight size={16} />
              </button>
            </>
          )}
        </div>

        {/* right: actions */}
        <div className="ml-auto flex flex-none items-center gap-2 md:ml-0">
          <span className="hidden font-display text-sm font-semibold tracking-tight lg:inline">
            {currentMonth}
          </span>
          {runwaySlot}
          {bellSlot}
          <Link
            href="/profile"
            title="Your profile"
            className="hidden items-center gap-2 rounded-full py-1 pl-1 pr-2.5 transition-colors hover:bg-surface-2 md:flex"
          >
            <Avatar size={30} />
            <span className="hidden max-w-[8rem] truncate text-sm font-semibold lg:block">{user.name}</span>
          </Link>
          <button
            type="button"
            onClick={logout}
            title="Log out"
            className="hidden h-9 w-9 place-items-center rounded-full border border-line bg-surface text-muted hover:bg-surface-2 hover:text-ink md:grid"
          >
            <LogOut size={16} />
          </button>

          {/* mobile: avatar + hamburger */}
          <Link href="/profile" className="md:hidden">
            <Avatar size={32} />
          </Link>
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={open}
            onClick={() => setOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-surface-2 md:hidden"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="overlay-in absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="dialog-in absolute right-0 top-0 flex h-full w-[82%] max-w-xs flex-col bg-surface p-4 shadow-pop">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Menu</span>
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full text-ink hover:bg-surface-2"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-1 flex-col gap-1 overflow-y-auto">
              {items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    className={`rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                      active ? "bg-ink text-white" : "text-ink hover:bg-surface-2"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
              <Link
                href="/profile"
                className={`mt-1 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive("/profile") ? "bg-ink text-white" : "text-ink hover:bg-surface-2"
                }`}
              >
                <UserCircle size={17} /> My Profile
              </Link>
            </div>

            <div className="mt-4 border-t border-line pt-4">
              <Link href="/profile" className="flex items-center gap-3 rounded-2xl bg-surface-2 px-3 py-2.5">
                <Avatar size={38} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
                  <p className="truncate text-xs text-muted">{user.email}</p>
                </div>
              </Link>
              <button
                type="button"
                onClick={logout}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-medium hover:bg-surface-2"
              >
                <LogOut size={16} /> Log out
              </button>
            </div>
          </aside>
        </div>
      )}
    </header>
  );
}
