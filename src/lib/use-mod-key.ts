"use client";

import { useEffect, useState } from "react";

/**
 * The platform command-key label for keyboard hints: "⌘" on Apple hardware,
 * "Ctrl" everywhere else. Defaults to "Ctrl" on the server AND the first client
 * paint (this user base is Windows), so there is no hydration mismatch; it only
 * upgrades to "⌘" after mount, on an actual Mac. Use `modKey` for the raw glyph
 * and `modLabel` for the composed "Ctrl K" / "⌘K" hint.
 */
export function useModKey() {
  const [isApple, setIsApple] = useState(false);
  useEffect(() => {
    const nav = typeof navigator !== "undefined" ? navigator : null;
    if (nav && /Mac|iPhone|iPad|iPod/.test(nav.platform || nav.userAgent || "")) {
      setIsApple(true);
    }
  }, []);
  const modKey = isApple ? "⌘" : "Ctrl";
  return { modKey, isApple, modLabel: isApple ? "⌘K" : "Ctrl K" };
}
