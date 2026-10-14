import { Image, View } from "@react-pdf/renderer";
import { PDF_LOGO_LOCKUP, PDF_LOGO_LOCKUP_RATIO, PDF_LOGO_MARK, PDF_LOGO_MARK_RATIO } from "./brand-asset";

/**
 * The B2 Consultants logo for @react-pdf documents - the real artwork, drawn from the
 * embedded raster in `brand-asset.ts`.
 *
 * This used to be a redraw: a rounded indigo box with a Times-Bold "B²" typed into it.
 * It was never the logo - the real mark is a square-cornered bracket, open at the foot,
 * in black, with CONSULTANTS set beneath it. A customer holding an invoice is the one
 * person who most needs the document to carry the actual brand.
 *
 * `size` is the HEIGHT. The artwork is landscape (1.385:1 for the mark), so the width is
 * derived from it rather than assumed square, which is what the old redraw could get away
 * with and this cannot.
 */

/**
 * The accent the document chrome is drawn in - headings, rules, callout borders.
 *
 * The brand blue, flat: #003C8C measures 10.4:1 on a white page, where the periwinkle it
 * replaces measured 4.6:1 and printed grey on a mono printer. An invoice is the most
 * officially-read thing this app produces, so it gets the trust colour, not a tint of it.
 *
 * The NAME is kept as an export so the two documents importing it keep compiling; it is a
 * misnomer now and `PDF_ACCENT` below is the one to use in new code.
 */
export const PDF_ACCENT = "#003C8C";

/** @deprecated Misnamed since the brand palette landed - use `PDF_ACCENT`. */
export const BRAND_INDIGO = PDF_ACCENT;

export function PdfBrandMark({ size = 38 }: { size?: number }) {
  return (
    <View style={{ height: size, width: size * PDF_LOGO_MARK_RATIO }}>
      <Image src={PDF_LOGO_MARK} style={{ height: size, width: size * PDF_LOGO_MARK_RATIO }} />
    </View>
  );
}

/** The complete lockup, CONSULTANTS included - for a document that leads with the logo alone. */
export function PdfBrandLockup({ size = 46 }: { size?: number }) {
  return (
    <View style={{ height: size, width: size * PDF_LOGO_LOCKUP_RATIO }}>
      <Image src={PDF_LOGO_LOCKUP} style={{ height: size, width: size * PDF_LOGO_LOCKUP_RATIO }} />
    </View>
  );
}
