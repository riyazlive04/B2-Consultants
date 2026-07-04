"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";

/**
 * Sticky top bar: current month · runway · notifications · logged-in user · logout.
 * `runwaySlot` / `bellSlot` are injected by the shell.
 */
export function TopBar({
  userName,
  userImage,
  currentMonth,
  runwaySlot,
  bellSlot,
}: {
  userName: string;
  userImage?: string | null;
  currentMonth: string;
  runwaySlot?: ReactNode;
  bellSlot?: ReactNode;
}) {
  const router = useRouter();

  const logout = async () => {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <header className="glass sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3 md:px-8">
      <Link
        href="/profile"
        className="flex min-w-0 items-center gap-2 rounded-full py-1 pl-1 pr-3 transition-colors hover:bg-surface-2"
        title="View your profile"
      >
        {userImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={userImage} alt="" className="h-7 w-7 flex-none rounded-full object-cover" />
        ) : (
          <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">
            {userName.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase()}
          </span>
        )}
        <span className="truncate text-sm font-semibold">{userName}</span>
      </Link>
      <div className="flex items-center gap-2 md:gap-3">
        <span className="hidden font-display text-sm font-semibold tracking-tight sm:inline">
          {currentMonth}
        </span>
        {runwaySlot}
        {bellSlot}
        <button
          type="button"
          onClick={logout}
          className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
        >
          <LogOut size={15} />
          <span className="hidden sm:inline">Log out</span>
        </button>
      </div>
    </header>
  );
}
