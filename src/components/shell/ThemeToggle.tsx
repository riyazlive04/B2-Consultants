"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { setThemePreference } from "@/server/theme-actions";

/**
 * Light/dark switch for the Daylight token set. The theme lives on <html data-theme>
 * (applied pre-paint by the root layout's inline script).
 *
 * TWO stores, on purpose (spec Part 2 §13: "dark and light per user"):
 *  - localStorage "b2_theme" is the PRE-PAINT cache. The root layout's inline script runs
 *    before React and before any DB read, so this is what stops dark mode flashing light.
 *  - User.themePreference is the DURABLE record. localStorage is per-BROWSER, so on its own
 *    it means two people sharing a machine overwrite each other, and your own choice doesn't
 *    follow you to another device. The DB is what makes the preference belong to the person.
 *
 * The write is fire-and-forget: a failed save must never block the UI from flipping. Worst
 * case the theme is right on this device and re-syncs next time it's toggled.
 */
export function ThemeToggle({ frosted = false }: { frosted?: boolean }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.getAttribute("data-theme") === "dark");
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    if (next) document.documentElement.setAttribute("data-theme", "dark");
    else document.documentElement.removeAttribute("data-theme");
    try {
      localStorage.setItem("b2_theme", next ? "dark" : "light");
    } catch {
      /* private mode / storage disabled — the DB write below still carries the choice */
    }
    // Explicit LIGHT rather than SYSTEM: the user just made a choice, and reverting them to
    // the OS setting would silently undo it the moment their OS disagreed.
    void setThemePreference(next ? "DARK" : "LIGHT").catch(() => {
      /* best-effort: the toggle already applied locally */
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`grid h-10 w-10 flex-none place-items-center rounded-btn border border-line text-ink-2 transition-colors hover:bg-surface-2 ${
        frosted ? "bg-[var(--bg-frost)]" : "bg-transparent"
      }`}
    >
      {dark ? <Sun size={17} strokeWidth={1.9} /> : <Moon size={17} strokeWidth={1.9} />}
    </button>
  );
}
