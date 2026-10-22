/**
 * WinAnsi, the encoding of every PDF font this codebase draws with.
 *
 * Both PDF engines here are limited to it. `@react-pdf/renderer`'s built-in Helvetica/Times
 * silently draw a BLANK RECTANGLE for anything outside the encoding - which is why the guided
 * templates write "69,999 INR" rather than ₹, and draw their checkboxes as SVG. `pdf-lib` is
 * stricter and THROWS (`WinAnsiEncoding cannot encode "₹"`), so an uploaded PDF with one smart
 * quote in a text field would fail to stamp at all.
 *
 * Text written by the app is already safe. Text that came out of a Word file written by a human
 * is not: ₹, smart quotes, en-dashes, ✓ and ◦ are all a keypress away in Word. So everything on
 * its way into a PDF goes through here first.
 *
 * The mapping is a transliteration where one exists - a smart quote prints as a straight quote
 * and nobody notices - and a deletion where one does not. A missing character reads as a typo; a
 * blank box reads as a corrupt document, and a thrown exception means no document at all.
 */

/** Characters that ARE in WinAnsi beyond Latin-1 and must survive the strip below. */
const WIN_ANSI_EXTRAS = "ŒœŠšŽžŸƒˆ˜•…‰€™‹›†‡‰";

export function winAnsiSafe(text: string): string {
  return (
    text
      // Transliterations: these read identically in print.
      .replace(/[‘’‚‛]/g, "'")
      .replace(/[“”„‟]/g, '"')
      .replace(/[–—−]/g, "-")
      .replace(/[     ]/g, " ")
      .replace(/​/g, "")
      // Currency and marks a contract actually uses. "₹" becomes the word, as the master does.
      .replace(/₹/g, "INR ")
      .replace(/[✓✔☑]/g, "[x]")
      .replace(/[☐□]/g, "[ ]")
      .replace(/[◦⁃·]/g, "-")
      .replace(/[→⇒]/g, "->")
      // Everything else outside Latin-1 (plus the WinAnsi extras) goes.
      .replace(new RegExp(`[^\\u0000-\\u00ff${WIN_ANSI_EXTRAS}]`, "g"), "")
  );
}

/**
 * Same, but for `pdf-lib`'s `drawText`, which also cannot render a newline or a tab - it draws
 * them as a missing glyph rather than breaking the line. Callers that need more than one line
 * split on "\n" themselves and draw each.
 */
export function winAnsiLine(text: string): string {
  return winAnsiSafe(text).replace(/[\r\n\t]+/g, " ").trim();
}
