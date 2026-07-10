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
  /**
   * @react-pdf/renderer (the agreement PDF renderer) needs careful handling, and every obvious
   * shortcut here has been tried and fails:
   *
   *  - It is ESM-only ("type": "module") and its layout engine, yoga-layout, loads WASM with a
   *    TOP-LEVEL AWAIT.
   *  - Next auto-externalises ESM packages on the server as an async `import()` external. Webpack
   *    turns that into top-level await *in the importing chunk*, and swcMinify then dies with
   *    "await isn't allowed in non-async function".
   *  - `serverComponentsExternalPackages` does the same thing, so it does not help.
   *  - Appending to `config.externals` does not help either: Next's own handler sits at index 0,
   *    matches first, and wins.
   *
   * So the entry is PREPENDED, and typed `commonjs`, which compiles to a plain require() at
   * runtime (Node 20.19+/22+ can require an ES module). Nothing async escapes into the bundle.
   */
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        { "@react-pdf/renderer": "commonjs @react-pdf/renderer" },
        ...(config.externals ?? []),
      ];
    } else {
      // The renderer must never reach the browser. Aliasing to false turns an accidental import
      // into a build-time empty module rather than a multi-megabyte client chunk.
      config.resolve.alias["@react-pdf/renderer"] = false;
    }
    return config;
  },
  // Security baseline. No embedding anywhere (incl. /book), no MIME sniffing,
  // no referrer leakage of internal URLs, no powerful browser APIs.
  async headers() {
    const baseline = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      {
        // The agreement PDF renders inside an <iframe> on our own review + signing pages.
        // `frame-ancestors 'none'` would block that even same-origin, so the PDF responses —
        // and only those — relax to 'self'. The signing PAGE itself stays DENY.
        //
        // Next applies every matching rule, and a browser seeing both DENY and SAMEORIGIN
        // resolves to DENY, so the catch-all below must explicitly exclude these paths rather
        // than merely being listed second.
        source: "/:path*/pdf",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          ...baseline,
        ],
      },
      {
        source: "/((?!.*/pdf$).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          ...baseline,
        ],
      },
    ];
  },
};

export default nextConfig;
