/** @type {import('next').NextConfig} */
const nextConfig = {
  // "standalone" produces the self-contained server.js the Docker image runs, but
  // plain `next start` (local, no Docker) doesn't support it — so the Dockerfile
  // opts in via NEXT_OUTPUT_STANDALONE=1 and local builds stay default.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  // File traces only serve the standalone bundle (Docker) and Vercel's function
  // packaging; on plain local Windows builds the trace collector is flaky (ENOENT
  // on *.nft.json) and the output is unused — skip it there.
  outputFileTracing: process.env.NEXT_OUTPUT_STANDALONE === "1" || !!process.env.VERCEL,
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
  // Security baseline. No embedding anywhere (incl. /book), no MIME sniffing,
  // no referrer leakage of internal URLs, no powerful browser APIs.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
