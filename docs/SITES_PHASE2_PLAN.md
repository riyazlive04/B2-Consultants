# Sites — replacing the GHL-hosted marketing website

**Goal:** move `b2consultants.de` off Synamate (a GoHighLevel white-label) and onto this app, so the
B2 team can maintain the marketing pages — and create new ones — without a third-party page builder.

**Status:** Stage 1 data model shipped. Stages 2–6 outstanding. See [Progress](#progress).

---

## 1. Scope, and what stays put

| Property | Today | After |
|---|---|---|
| `b2consultants.de` — 5 pages | GHL | **This app** |
| `optin.b2consultants.de/lp` — opt-in funnel | GHL | **Stays on GHL** |

The opt-in funnel is the revenue page and is already producing leads. Leaving it alone removes the
single highest-risk item from the project. The new pages link *out* to it.

### Page inventory

Taken from the live site's own markup, not from the nav labels — the two disagree.

| Nav label | Actual target | Rebuild? |
|---|---|---|
| Training | `optin.b2consultants.de/lp` — **a different hostname** | No — stays on GHL |
| About Us | `/aboutus` | Yes |
| Career | `/career` | Yes |
| Contact | an anchor on the homepage, not a page | No — it is a section |
| — | `/` (home), `/privacy`, `/terms` | Yes |

**Five pages to rebuild.** Measured from the captured markup: **19 sections / 37 rows** total, and
**7 unique media assets**. Smaller than it looks.

### Decisions taken

| Question | Decision |
|---|---|
| Approach | **Option A — section-template editor.** Not a free-form GHL-style canvas |
| Fidelity | **Byte-identical clone** of the existing pages (owner's call, made with the maintainability trade-off stated) |
| Asset storage | **Supabase Storage** — same project as the database |
| Page authoring | The team must be able to create **new** pages later, not just edit these five |
| Domain cut-over | **Later.** Build and verify on `b2app.sirahagents.com` first |

---

## 2. Why not build this on `Funnel` / `FunnelStep`

Phase 2 of `SYNAMATE_CLONE_SPEC.md` already shipped `Funnel`, `FunnelStep`, `Form` and public
hosting at `/p/<slug>` and `/f/<slug>`. It is tempting to reuse it. Don't:

- A **funnel** is an ordered sequence — step 1 → 2 → 3, where `position` *is* the navigation model.
- A **website** is a set of pages reached from a shared nav in any order.

Modelling `b2consultants.de` as funnel steps means hand-maintaining the nav on every page and
renumbering to insert one. So `Funnel`/`FunnelStep` stays exactly as it is, for the thing it is
genuinely good at — the opt-in flow — and the website gets its own model.

The existing funnel builder also **cannot** reproduce the current site. Every block renders into a
fixed `max-w-2xl` centred column on `bg-app`, inheriting the dashboard's own design tokens. There is
no background colour, no full-bleed band, no nav bar, no logo. The violet header, the full-width
violet "About Me" band and the footer are not expressible in the current `Block` type.

---

## 3. What Synamate actually does (measured, not assumed)

Read off the live page on 2026-08-04:

| Layer | Implementation |
|---|---|
| Origin storage | Firebase Storage (`highlevel-backend.appspot.com`) + `assets.cdn.filesafe.space`, keyed per account: `/40rq2210I0idDREaOysb/media/{fileId}` |
| Delivery | `images.leadconnectorhq.com/image/f_webp/q_80/r_{width}/u_{origin}` — an on-the-fly transform CDN |

Every image is served **converted to WebP, quality 80, at five breakpoints** (320 / 640 / 768 / 900
/ 1200) as a responsive `srcset`.

**The transform layer is the part that matters.** The captured assets total **4.5 MB raw**, including
two PNGs at 1.7 MB and 1.9 MB. GHL visitors never download that. If we serve the originals, the
rebuilt site is *slower than the one it replaced* — a regression in the exact metric the site exists
for.

`next/image` does the same job (WebP, per-width variants, responsive `srcset`, cached), so pointing
`remotePatterns` at the Supabase bucket buys GHL's pipeline. Note the current renderer uses a raw
`<img>` with the lint rule suppressed — `src/components/sites/SiteBlocks.tsx`.

---

## 4. Infrastructure findings

Production runs on a Hostinger VPS behind **Caddy** (`Via: 1.1 Caddy`), serving
`b2app.sirahagents.com`.

- **No CDN.** No `cf-ray`, no `cf-cache-status` — the VPS answers every request itself.
  **Recommendation: put Cloudflare in front (free tier, proxy mode).** Half a day, no code change,
  and the difference between "as fast as GHL" and "noticeably worse".
- **Database is Supabase** — project `vyuzqkzujjbgccfjhjcr`, `ap-southeast-1`, transaction pooler on
  `:6543`. This settles the storage question: Supabase Storage, same project, one backup story.
- **`db.latencyMs` measured 681 ms** from the VPS (vs 4 ms against a local Postgres) — the app is
  talking cross-region to Singapore.

That last number makes caching **mandatory, not cleanup.** The existing public page route is
`force-dynamic` and writes a view count on every request (`src/app/p/[slug]/[step]/page.tsx`). Under
that latency, every visitor waits on a cross-region round trip before seeing anything, plus a write.
Tolerable for an authenticated dashboard; fatal for an ad-traffic landing page.

---

## 5. Cross-domain attribution — the thing that will silently break

A visitor lands on the new `b2consultants.de`, clicks **Watch Free Training**, and arrives at
`optin.b2consultants.de` — a different hostname, so nothing carries over.

Unless the outbound CTA forwards the inbound query string (`utm_*`, `fbclid`, `gclid`) plus a page
identifier, every opt-in arrives context-free — and you cannot answer *"did the rebuilt homepage
convert better or worse than the GHL one?"*, which is the entire question the rebuild must answer.

Small feature. Very easy to omit. It belongs in Stage 2.

---

## 6. Lead intake — how opt-ins reach the CRM

Already built: `src/app/api/leads/pabbly/route.ts`. Pabbly fans each opt-in out to Synamate **and**
to this app as a second action on the same workflow, so the two are independent.

The route **fails closed** — no `PABBLY_WEBHOOK_SECRET`, no capture (503). Verify this is set in
production; a 503 there means opt-in leads silently never arrive.

### Exercising it in dev

Pabbly is a cloud service and cannot reach `localhost`. Two options:

- `node --env-file=.env scripts/replay-pabbly.mjs` — replays a representative payload. No tunnel.
  Add `--id <fixed>` and run twice to exercise the `(source, externalRef)` de-dupe.
- For live deliveries: tunnel `:3000` and add a **third** action on the Pabbly workflow pointing at
  it. **Never repoint the existing production action** — that is the one carrying real opt-ins.

> **Guard:** the replay script refuses unless *both* the target URL and `DATABASE_URL` are local.
> A local app server is not evidence of a safe target — `.env` can point a local dev server at
> production Supabase, and at time of writing it does.

---

## 7. Data model (shipped)

Migration `20260804120000_sites_website_model`.

| Model | Purpose |
|---|---|
| `Site` | One hosted website = one domain. Theme, nav, tracking ids, favicon. `domain` is nullable — pages serve at `/s/<slug>` until DNS cuts over |
| `SiteSection` | Shared bands (`HEADER` / `FOOTER` / `REUSABLE`), stored once and referenced, so editing the footer is not editing five pages |
| `SitePage` | One page. `path` is the real public path (`/aboutus`), not a slugified fragment — the live URLs are being reproduced exactly |
| `SitePageRevision` | Immutable snapshot per save. The site takes paid traffic; a bad edit needs a one-click way back |
| `MediaAsset` | Media-library index. `storageKey` is the Supabase object path; **bytes never live in Postgres** |

`sections` is a JSON blob rather than section rows — matching the existing `FunnelStep.blocks`
precedent. The editor saves a whole page at once and revisions snapshot it, so rows would buy
nothing and cost a join on every public render.

---

## 8. Build stages

| # | Stage | Est. | State |
|---|---|---|---|
| 1 | `Site`/`Page`/`Section` model + migration + server actions + RBAC | 1.5 wk | **Done** |
| 2 | Section library matched to the live design + **CTA param forwarding** | 1.5 wk | **Done** |
| 3 | Editor: live preview, mobile toggle, section picker, autosave + revisions | 1.5–2 wk | **Done** |
| 4 | Supabase Storage + media library + `next/image` pipeline | 1 wk | **Done** — needs a key pasted |
| 5 | Cloudflare, cache headers, static generation, Meta Pixel / GA | 0.5 wk | **Code done**; Cloudflare is a DNS change on your side |
| 6 | Rebuild the 5 pages, screenshot-diff verification | 1 wk | **Home done**; 4 pages are shells awaiting copy; screenshot-diff needs a browser |
| | **Total** | **6.5–7.5 wk** | |

Domain cut-over is deliberately **not** a stage. Once the site is verified on a temp hostname it
becomes a DNS change plus a Caddy block, made whenever you choose.

---

## Progress

### Done

- **Live site captured** — all 5 pages plus 7 media assets, as the byte-identical rebuild source.
- **Pabbly wired for dev/local** — verified: first delivery `created: true`; redelivery returns
  `deduped: "externalRef"` with `created: false`; the guard refuses non-local targets.
- **Stage 1 complete** — 5 models + migration; `src/lib/site-types.ts` (theme, nav, section/block
  shapes, normalisers); `src/server/sites-actions.ts` (site, page, revision and shared-section
  writes, all `sites.manage`-gated); new `sites.manage` capability; `sites` section entry.
  Typecheck clean, 893 tests pass.

### `sites.manage` — and why Forms and Funnels moved onto it

`funnels-actions.ts` and `forms-actions.ts` were gating deletes on **`pipeline.configure`**, a key
about reassigning leads and editing telecaller targets. The two powers are unrelated:

- `pipeline.configure` is **internal** — move a lead, delete an outcome.
- `sites.manage` is **outward-facing** — publishing changes what the public and every ad click sees.

Someone trusted to move a lead between telecallers has not thereby been trusted to edit the
homepage; and whoever writes the copy should not need the power to delete leads to do it. Both files
now use `sites.manage`.

The `sites` nav entry ships **`hidden: true`** — the model and actions exist, the `/sites` screen
does not (Stage 3). `hidden` also sets `enabled: false`, so `requireSection("sites")` refuses the
route rather than half-serving it. Drop the flag in the change that adds the screen.

### Two pre-existing problems found

1. **`migrate dev` wants to wipe the local database.** On 2026-07-03 a migration failed, was fixed
   and re-applied, leaving a rolled-back row (`applied_steps_count 0`) beside the successful one for
   `20260704000000_student_accounts`. Prisma reads the stale checksum as tampering and demands a
   reset. Workaround in use: `migrate diff` + `migrate deploy`, which is what production does anyway.
   Deleting the one dead row fixes it permanently.

2. **A live index was one `migrate dev` away from being silently dropped.** Migration
   `20260803090000_team_profile_termination` creates `team_profile_terminatedAt_idx`, but the
   `TeamProfile` model never declared it — so every diff wanted to `DROP` it. Fixed by adding the
   missing `@@index([terminatedAt])`. **This affects production too.**

- **Stage 2 complete** — `src/lib/site-links.ts` (attribution forwarding), `src/lib/site-templates.ts`
  (9 section templates), `src/components/sites/SitePageRenderer.tsx` (theme-driven renderer),
  `next.config.mjs` image pipeline. Typecheck clean, **919 tests pass**, build green.

### Stage 2 notes

**Attribution forwarding** (`site-links.ts`) carries `utm_*` plus the platform click ids
(`fbclid`, `gclid`, `ttclid`, `msclkid`) across to the GHL funnel, and stamps `b2_from` with the
originating page. An allow-list, not "forward everything": the query string also collects session
ids and preview flags that must not reach a third-party host. Params already on the href win —
an author who wrote `?utm_campaign=spring` meant it. Both CTA templates that point at
`optin.b2consultants.de` default to `forwardParams: true`, and **a test enforces that** — it is the
one default whose regression would be invisible until the numbers stopped making sense.

**The renderer** is deliberately not `SiteBlocks.tsx`. Section owns background and width, content is
capped inside it, and the theme arrives as CSS custom properties on a wrapper — Tailwind cannot
generate classes for per-site values edited at runtime. A block on a coloured band inherits white
text, so the violet "About Me" copy works without setting a colour on all eight paragraphs.

**Image pipeline** — `next.config.mjs` now carries `remotePatterns` for the Supabase bucket,
`formats: ["image/webp"]` and `deviceSizes` mirroring the five widths GHL actually emits. Without
the pattern entry `next/image` throws at request time rather than falling back.

- **Stage 3 complete** — `/sites` (list), `/sites/[id]` (pages, menu, brand, domain & tracking),
  `/sites/[id]/pages/[pageId]` (builder: live preview, desktop/mobile toggle, section picker,
  autosave, revision history), and the public route `/s/[slug]/[[...path]]`. The `sites` nav entry
  is now visible. Typecheck clean, 919 tests pass, build green, no new lint warnings.

### Stage 3 notes

**The preview uses the same `SitePageRenderer` the public route does.** A preview built from a
second implementation is a preview that drifts.

**Static rendering forced an architecture change to attribution forwarding.** Reading
`searchParams` in a page opts it out of static rendering entirely — which would reinstate the
~680 ms per-request latency this route exists to avoid. A statically rendered page has no request
to read a query string from, so Next hands it an empty `searchParams` and any server-side
forwarding silently produces nothing. So the HTML now ships the plain href plus a `data-forward`
marker, and `components/sites/ForwardParams.tsx` folds the query string in **in the browser** —
once on mount (so the href is honest if inspected) and again on click in the capture phase (which
is what actually guarantees attribution). Static *and* attributed, rather than one or the other.

**Autosave compares content, not a dirty flag.** The last-saved snapshot is held in a ref and
compared against current state, and the ref is stamped from the payload that was *sent*. A boolean
flag goes stale when a save lands while an edit is in flight, silently dropping that edit.

**Publish saves first.** Publishing the state on screen, not the state on the server — otherwise
hitting Publish mid-edit puts the *previous* version live.

**Verified end-to-end** against the local DB (not production): the page renders with its violet
band and `data-forward` markers; unpublishing either the page *or* the whole site returns 404;
unknown paths and unknown sites 404; `/sites` still redirects to login.

- **Stage 4 complete** — `lib/supabase-storage.ts`, `/api/media/upload`, `server/media-actions.ts`,
  `components/sites/MediaPicker.tsx`, `sharp` installed. Typecheck clean, **929 tests pass**, build
  green. **Inert until a service_role key is pasted** — see below.

### Stage 4 notes

**`sharp` was a missing prerequisite, not a nicety.** Next 14 requires it for production image
optimization when self-hosting, and it was not installed — so the `next/image` wiring from Stage 2
would have failed on the VPS. Checked the lockfile carries `@img/sharp-linuxmusl-x64`, so the
Alpine `npm ci` in the Dockerfile resolves the right binary.

**This introduces the first Supabase API key the app has ever held**, which contradicts what
`.env.supabase.example` used to say. That file now explains the exception rather than denying it.
The honest risk assessment:

- **Leaked env**: not materially worse. `DATABASE_URL` already grants full database access.
- **Leaked to a browser**: catastrophic. `service_role` is BYPASSRLS.

So `lib/supabase-storage.ts` is `server-only` and is the single place permitted to read the key.
Verified: the only `process.env.SUPABASE_*` reads in `src/` are that module and its test.

**Originals are stored unmodified.** `next/image` derives every delivered variant, exactly as GHL's
transform CDN does over its own origin. Re-encoding on upload would degrade the master to buy
nothing — and it would break the byte-identical rebuild.

**SVG is rejected on purpose.** It is a script-bearing document; serving one from our own origin on
a public bucket is a stored-XSS primitive. GHL allows it. That is not a reason to.

**Type is identified by content, never by filename or the browser's Content-Type** — both are
attacker-controlled. `buildStorageKey` is tested against traversal (`../../etc/passwd.png`), since
its output becomes a URL path.

**Deleting from the library leaves the bytes.** Image URLs live inside a JSON blob, so there is no
reference count to consult — removing the object would break any page still using it. `purgeMedia`
is the separate, deliberate destroy, and it refuses to delete the row unless the object went first
(a row without its bytes is an orphan nothing can find again).

**Verified:** unauthenticated upload → 307 to login; authenticated upload with no key → 503 with a
readable message, not a stack trace.

- **Stage 5 code complete** — `generateStaticParams`, `components/sites/SiteTracking.tsx`, and
  `docs/SITES_DOMAIN_AND_CDN.md`. Cloudflare and the domain attachment are infrastructure steps,
  documented there.

### Stage 5 notes — the caching bug this stage existed to find

The public route was emitting `Cache-Control: private, no-cache, no-store, max-age=0` — **provably
uncacheable**, on a real production build, cold *and* warm. With the database ~680 ms away, every
ad click was paying a full cross-region round trip. The `revalidate = 300` written in Stage 3 was
doing nothing.

Cause: Next cannot prerender a catch-all it has no params for, so it classified the route as
server-rendered on demand. `generateStaticParams` (querying published pages, returning `[]` if the
DB is unreachable so a build never fails on a blink) flipped it:

| | Route class | Header | Cache |
|---|---|---|---|
| Before | `ƒ` dynamic | `private, no-cache, no-store, max-age=0` | never |
| After | `●` static + ISR | `s-maxage=300, stale-while-revalidate` | `x-nextjs-cache: HIT` |

**Verified that a page published AFTER a build still caches** — `MISS` on first hit, `HIT` after,
cacheable header both times. The team can publish without a deploy.

**A correction carried into `SITES_DOMAIN_AND_CDN.md`:** an earlier note in this project said Caddy
would handle on-demand TLS for the new domain. It will not. Read off the running host: **Traefik**
owns :80/:443 and terminates TLS, and `Caddyfile` sets `auto_https off` precisely because of that.
Attaching `b2consultants.de` is a Traefik router-label change, not a Caddy site block.

**Tracking ids are validated** (`^[0-9]{6,20}$`, `^G-[A-Z0-9]{4,20}$`) because they are interpolated
into a script body. Unset renders nothing, rather than a script that inits with an empty id and
throws. Scripts are `afterInteractive` so they do not spend the speed the caching work just bought.

- **Stage 6 partial** — `scripts/rebuild-b2-site.mjs` creates the site, theme, nav, shared
  header/footer and all five pages. Idempotent (re-running updates in place, preserving revision
  history). Verified: all five render 200 with the correct brand values. **Two gaps below.**

### Stage 6 notes — and two corrections

**The design tokens were wrong, and now are not.** They are read out of the live site's own CSS
custom properties, not eyeballed:

| | I had said | Actually |
|---|---|---|
| Brand violet | `#4a3aff` (guess) | **`#4949ef`** (`--color-m2ti8lx2`) |
| Fonts | "renders in Inter" | **Montserrat** headings / **Raleway** body |
| Content width | 1140px | **1170px** |

The font claim was the worse error: `Inter` appears in the markup because it is GHL's *editor
chrome*, not the rendered site. `defaultTheme()` and the section templates now carry the real
values, and the renderer loads the named families from Google Fonts with `display=swap`.

**The CDN fallback did not degrade gracefully — it 500'd.** The rebuild script keeps Synamate's
image URLs when Supabase is unconfigured, and I described that as "the pages still render". They
did not: `next/image` treats an unconfigured host as a hard error. `next.config.mjs` now allows
`assets.cdn.filesafe.space` and `firebasestorage.googleapis.com`, clearly marked **MIGRATION ONLY
— delete after `--images` has run**. Leaving those entries is a standing dependency on the platform
being replaced.

**Cloudflare email obfuscation**: the live contact copy renders as `[email protected]` because
Cloudflare rewrites it. The rebuild restores the real `info@b2consultants.de` rather than
reproducing the artefact.

### Two gaps in Stage 6

1. **Only the homepage carries real copy.** Its text is lifted verbatim from the live markup.
   `/aboutus`, `/career`, `/privacy` and `/terms` are created as correctly-structured, on-brand
   **shells with placeholder text** — the copy is long-form and sits in the captured HTML, but
   extracting it cleanly needs a pass a person should review anyway. `/career` is the longest page
   (16 rows) and may carry an application form; if it does, build it in **Forms** so submissions
   land in the CRM instead of an inbox.
2. **Screenshot-diff verification has not been run.** It needs a headless browser (Playwright or
   `chromium-cli`); neither is installed, and adding one is a bigger dependency decision than this
   stage should make unilaterally. Until it runs, "byte-identical" is **asserted, not measured**.

### Open items
- [x] ~~Apply `20260804120000_sites_website_model` to production Supabase~~ — applied 2026-08-04,
      schema confirmed in sync.
- [ ] **Create the `site-media` bucket in Supabase as PUBLIC, and paste `SUPABASE_SERVICE_ROLE_KEY`**
      into `.env` and the production environment. Until then the media library returns a clear 503
      and image blocks fall back to pasting a URL.
- [ ] Verify `PABBLY_WEBHOOK_SECRET` is set in production.
- [ ] Decide on deleting the rolled-back migration row to restore `migrate dev`.
- [ ] Put Cloudflare in front of the VPS — steps in `docs/SITES_DOMAIN_AND_CDN.md`.
- [ ] Use the **existing** Meta Pixel id from the GHL pages, not a new one: a new id restarts Meta's
      learning phase and discards the conversion history the ad account optimises against.
