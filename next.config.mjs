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
  /**
   * Marketing-site images (Supabase Storage).
   *
   * This IS the image pipeline. Synamate serves every asset through a transform CDN
   * (`images.leadconnectorhq.com/image/f_webp/q_80/r_{width}/…`) which converts to WebP and emits
   * five widths. The captured originals total 4.5 MB — two PNGs are 1.7 MB and 1.9 MB — so serving
   * them raw would make the rebuilt site SLOWER than the GHL one it replaces, on exactly the paid
   * traffic it exists for. `next/image` does the same job, but only for hosts listed here; an
   * unlisted host throws at request time rather than falling back.
   *
   * `deviceSizes` mirrors the breakpoints GHL actually emits, so the variants match what the live
   * site already proved works for this design.
   */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "vyuzqkzujjbgccfjhjcr.supabase.co", pathname: "/storage/v1/object/public/**" },
      // ── MIGRATION ONLY — remove once the assets live in Supabase ──
      // While the rebuilt pages still point at Synamate's origin, next/image must be allowed to
      // fetch from it. Without these entries an unconfigured host is a hard 500, not a fallback —
      // so omitting them does not "degrade gracefully", it takes the page down.
      // Delete both lines after `scripts/rebuild-b2-site.mjs --images` has run and the pages have
      // been re-pointed; leaving them is a standing dependency on the platform being replaced.
      { protocol: "https", hostname: "assets.cdn.filesafe.space" },
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
    ],
    deviceSizes: [320, 640, 768, 900, 1200, 1920],
    formats: ["image/webp"],
  },
  compress: true, // gzip RSC/HTML/JS from the Node server (belt-and-suspenders behind a proxy)
  poweredByHeader: false,
  reactStrictMode: true,
  // Type-checking (tsc) still gates the build; we don't want a stylistic ESLint
  // rule (e.g. unescaped apostrophes in copy) to block a production build.
  // Run `npm run lint` separately for lint feedback.
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    // Required in Next 14 for src/instrumentation.ts to run at all — without this the
    // file is silently ignored and the production env check never fires.
    instrumentationHook: true,
    // Tree-shake barrel imports so pages only pull what they use. lucide-react is
    // the big win: its barrel re-exports ~1,600 icons, which makes dev-mode
    // on-demand compilation crawl. This rewrites `{ X } from "lucide-react"` into
    // direct deep imports so each route compiles only the icons it actually uses.
    optimizePackageImports: ["papaparse", "lucide-react"],
    // CV-upload text extraction (/api/cv-extract) runs these CommonJS libs in the
    // Node runtime. Keep them as runtime require()s instead of bundling: pdf-parse
    // ships its own pdf.js and lazily reads test fixtures, and mammoth pulls a large
    // dependency tree — bundling either into the route is slow and brittle.
    // mammoth (uploaded .docx → HTML) and pdf-parse are CommonJS with large, lazily-read
    // dependency trees. pdf-lib joins them: it is only ever used server-side (stamping an
    // uploaded PDF), and bundling a megabyte of it into every route handler that touches
    // agreements is pure cost.
    serverComponentsExternalPackages: ["mammoth", "pdf-parse", "pdf-lib"],
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
    /**
     * ── ONE REFERRER POLICY PER PATH, NEVER TWO ─────────────────────────────────────────
     *
     * `referrer` is the one value here that must not be set twice. Next applies EVERY matching
     * rule and emits the headers in rule order; the Referrer Policy spec then says a browser
     * takes the LAST valid value in the list. So two matching rules means the answer depends on
     * array ordering in this file - which is exactly the kind of thing that survives a review
     * and then silently flips when somebody inserts a rule.
     *
     * The baseline is therefore a function of which policy the path should get, and the
     * token-addressed documents are EXCLUDED from the catch-all below rather than layered on
     * top of it. Same technique the `f|p` funnel rule already uses for `X-Frame-Options`, and
     * for the same reason: never let a browser see a conflict it has to resolve.
     */
    const baseline = (referrer = "strict-origin-when-cross-origin") => [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: referrer },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];
    return [
      {
        /**
         * ── THE TOKEN-ADDRESSED PUBLIC DOCUMENTS  (issue B5) ─────────────────────────────
         *
         * `/i/<token>` (invoice, estimate, receipt) and `/agreement/<token>` (a contract) are
         * reachable by anyone holding the URL, and the URL IS the credential. Two things the
         * shared baseline cannot give them:
         *
         *  · `noindex, nofollow, noarchive`. Nothing stops a customer pasting an invoice link
         *    into a tool that crawls it, or a crawler reaching it out of a mail archive - and a
         *    search result carrying somebody's invoice is a disclosure nobody can retract. The
         *    `robots.txt` generated by `src/app/robots.ts` names the public prefixes, which is a
         *    polite request to a well-behaved crawler; this is a header on the document itself.
         *
         *  · `Referrer-Policy: no-referrer`, tightened from `strict-origin-when-cross-origin`.
         *    These pages are opened out of a mail client and then navigated FROM - the PDF
         *    button, a link in the issuer block - and the one thing that must never travel in a
         *    `Referer` is the path, because the path contains the token. `strict-origin…` sends
         *    the origin and withholds the path cross-site, which is almost right; `no-referrer`
         *    is the only value that guarantees it same-site too, and these documents have
         *    same-site links.
         *
         * Framing: both also need DENY, so it is set here rather than inherited - see the
         * exclusion in the catch-all. The `/pdf` rule below still relaxes the agreement PDF to
         * SAMEORIGIN, because it is iframed on our own signing page, and that rule is narrower.
         */
        source: "/:kind(i|agreement)/:path((?!.*\\/pdf$).*)",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          ...baseline("no-referrer"),
        ],
      },
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
          // `no-referrer` for every PDF, not just the token-addressed ones (issue B5). A PDF
          // viewer can follow a link out of the document, and the two PDFs this app serves
          // publicly - the invoice and the agreement - both carry their token in the path. The
          // internal PDFs lose nothing by it: nothing navigates away from a downloaded file.
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          ...baseline("no-referrer"),
        ],
      },
      {
        // Public hosted forms (/f/*) and funnels (/p/*) are DESIGNED to be embedded on other sites
        // (issue 1.10 — the Forms UI ships an iframe snippet). They carry no auth and no destructive
        // action, so cross-site framing is the intended, low-risk behaviour: allow all ancestors and
        // omit X-Frame-Options (which has no "allow any" value). These paths are excluded from the
        // DENY catch-all below so a browser never sees a conflicting DENY.
        source: "/:kind(f|p)/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          ...baseline(),
        ],
      },
      {
        // `i/` and `agreement/` join the exclusion list (issue B5): they set their own
        // `no-referrer`, and a path matching both rules would emit two Referrer-Policy headers
        // whose winner depends on the order of this array. They set DENY framing themselves.
        source: "/((?!f/|p/|i/|agreement/|.*/pdf$).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          ...baseline(),
        ],
      },
    ];
  },
};

export default nextConfig;
