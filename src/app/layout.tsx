import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// "Daylight" type system (docs/DESIGN_SYSTEM.md §2):
// Jakarta = display (titles, headings, big figures) · Inter = body/UI ·
// JetBrains Mono = ledger figures, IDs and audit-trail entries.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  /**
   * ── Each page names itself in the tab (issue 28) ────────────────────────────────
   * Every page shared the title "B2 Consultants", so a person working across Finance, Cash
   * Health and Payments had three identical browser tabs and no way to tell them apart - and
   * browser history was a list of the same words.
   *
   * `template` lets a page export `title: "Finance"` and get "Finance · B2 Consultants";
   * `default` is what a page that exports nothing still gets, so nothing regresses.
   */
  title: {
    default: "B2 Consultants",
    template: "%s · B2 Consultants",
  },
  description: "Private internal dashboard for B2 Consultants",
  // No explicit `icons` entry: `src/app/icon.png` is picked up by the file convention and served
  // with a content hash, so the browser cannot keep showing the old redrawn mark from cache.
  // Naming a path here would pin a URL that the convention does not actually serve.
  robots: { index: false, follow: false },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F1F5FB",
};

// Applies the saved theme before first paint so dark mode never flashes light.
// Key "b2_theme" matches ThemeToggle; anything but "dark" falls back to light.
const themeInit = `try{if(localStorage.getItem("b2_theme")==="dark")document.documentElement.setAttribute("data-theme","dark")}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jakarta.variable} ${jetbrains.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
