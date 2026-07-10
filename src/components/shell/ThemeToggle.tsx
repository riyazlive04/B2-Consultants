"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

/**
 * Light/dark switch for the Daylight token set. The theme lives on
 * <html data-theme> (applied pre-paint by the root layout's inline script)
 * and persists under "b2_theme" — the same contract as the design file.
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
      /* ignore */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={`grid h-9 w-9 flex-none place-items-center rounded-btn border border-line text-ink-2 transition-colors hover:bg-surface-2 ${
        frosted ? "bg-[var(--bg-frost)]" : "bg-transparent"
      }`}
    >
      {dark ? <Sun size={17} strokeWidth={1.9} /> : <Moon size={17} strokeWidth={1.9} />}
    </button>
  );
}
