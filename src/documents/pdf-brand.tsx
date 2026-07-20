import { Text, View } from "@react-pdf/renderer";

/**
 * The B2 Consultants logo mark for @react-pdf documents — the rounded indigo
 * frame with a serif "B²". Uses the built-in Times-Bold serif (nothing to
 * register) and the "²" glyph, which is WinAnsi-safe (unlike ✓ ₹ ◦ — see the
 * glyph note in agreement-guided-v3.tsx). Colour matches the app's
 * `--brand-indigo` token so print and screen read as one brand.
 */
export const BRAND_INDIGO = "#5b60c9";

export function PdfBrandMark({ size = 38 }: { size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderWidth: Math.max(1.4, size * 0.045),
        borderColor: BRAND_INDIGO,
        borderRadius: size * 0.2,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ fontFamily: "Times-Bold", fontSize: size * 0.5, color: BRAND_INDIGO }}>
        B²
      </Text>
    </View>
  );
}
