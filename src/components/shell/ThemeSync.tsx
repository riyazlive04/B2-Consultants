/**
 * Applies the signed-in user's saved theme (spec Part 2 §13: per user, not per browser).
 *
 * WHY A RAW SCRIPT RATHER THAN A useEffect: this has to win before first paint. A useEffect
 * runs after React hydrates, which is exactly late enough to show a visible flash of the
 * wrong theme on every navigation to a new device.
 *
 * The root layout's inline script has already applied the localStorage cache — that covers
 * the common case with zero flash. This only has to correct the case localStorage CANNOT
 * know about: a fresh browser, or a second person signing in on a shared machine, where the
 * cached value belongs to someone else. It reconciles the DB value into both <html> and the
 * cache, so the next load of that browser is already right.
 *
 * SYSTEM defers to the OS, which is why it reads prefers-color-scheme rather than assuming
 * light — "follow my machine" is a real choice, not an absence of one.
 */
export function ThemeSync({ preference }: { preference: "SYSTEM" | "LIGHT" | "DARK" }) {
  const script = `
try {
  var p = ${JSON.stringify(preference)};
  var dark = p === "DARK" || (p === "SYSTEM" && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  if (dark) document.documentElement.setAttribute("data-theme", "dark");
  else document.documentElement.removeAttribute("data-theme");
  localStorage.setItem("b2_theme", dark ? "dark" : "light");
} catch (e) {}
`.trim();
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
