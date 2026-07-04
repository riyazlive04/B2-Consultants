/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone", // Docker on VPS
  // Allow out-of-band builds (e.g. verifying prod while a dev server holds .next).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  compress: true, // gzip RSC/HTML/JS from the Node server (belt-and-suspenders behind a proxy)
  poweredByHeader: false,
  reactStrictMode: true,
  // Type-checking (tsc) still gates the build; we don't want a stylistic ESLint
  // rule (e.g. unescaped apostrophes in copy) to block a production build.
  // Run `npm run lint` separately for lint feedback.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Tree-shake barrel imports so pages only pull what they use. lucide-react is
    // the big win: its barrel re-exports ~1,600 icons, which makes dev-mode
    // on-demand compilation crawl. This rewrites `{ X } from "lucide-react"` into
    // direct deep imports so each route compiles only the icons it actually uses.
    optimizePackageImports: ["papaparse", "lucide-react"],
  },
};

export default nextConfig;
