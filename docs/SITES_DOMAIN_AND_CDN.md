# Serving the marketing site: domain, TLS and CDN

Everything here is **infrastructure you run**, not code. The app side is done; these are the steps
that put `b2consultants.de` in front of it. Written against the actual production topology, which
was read off the running host rather than assumed.

---

## 1. The topology as it actually is

```
visitor ──▶ Traefik (owns :80/:443, terminates TLS, Let's Encrypt "mytlschallenge")
              └─▶ Caddy  (auto_https OFF, :8080, gzip/zstd, health checks)
                    └─▶ app:3000  (Next.js)
                          └─▶ Supabase Postgres, ap-southeast-1  (~680 ms away)
```

Two things follow from this that are easy to get wrong:

- **Caddy does not issue certificates here.** `Caddyfile` sets `auto_https off` because Traefik
  already owns 80/443 on this VPS. Adding a domain is a **Traefik router label**, not a Caddy site
  block. (An earlier note in this project said Caddy would handle on-demand TLS — that was wrong.)
- **There is no CDN today.** Verified: responses carry `Via: 1.1 Caddy` and no `cf-ray` /
  `cf-cache-status`. The VPS answers every request itself.

---

## 2. Cache behaviour — what changed, and why it matters here

The public site route was emitting:

```
Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate
```

which no CDN or browser will ever cache. With the database ~680 ms away, that meant **every ad
click paid a full cross-region round trip**.

Cause: Next cannot prerender a catch-all route it has no params for, so it classified the route as
server-rendered on demand. Adding `generateStaticParams` (querying published pages) flipped it.
Measured, before and after, on a real production build:

| | Route class | Header | Cache |
|---|---|---|---|
| Before | `ƒ` dynamic | `private, no-cache, no-store, max-age=0` | never |
| After | `●` static + ISR | `s-maxage=300, stale-while-revalidate` | `x-nextjs-cache: HIT` |

**A page published after the last build still caches** — it renders on demand on first hit
(`MISS`), populates the ISR cache, and serves `HIT` afterwards, with the same cacheable header.
So the team can publish without a deploy.

`revalidate` is only the backstop: saving and publishing call `revalidatePath`, so an edit is live
immediately.

---

## 3. Put Cloudflare in front

This is the single biggest remaining win, and it is a DNS change plus two toggles.

**Why:** Synamate serves your current pages from a global CDN. Without one, the rebuilt site is
answered by a single VPS — slower than what it replaces, for exactly the paid traffic it exists to
convert. Cloudflare's free tier also absorbs bot traffic that currently reaches the app directly.

1. Add the domain to Cloudflare; set its nameservers at the registrar.
2. Create an **A record → the VPS IP**, proxy status **Proxied** (orange cloud).
3. SSL/TLS mode: **Full (strict)**. Traefik already holds a valid Let's Encrypt certificate, so
   strict works and "Flexible" would be a downgrade — it leaves Cloudflare→origin unencrypted.
4. Leave "Always Online" and Auto Minify off. Minification rewrites HTML you are trying to keep
   byte-identical to the old site.
5. Confirm Cloudflare honours the origin: a `Cache-Control: s-maxage=300` response should come back
   with `cf-cache-status: HIT` on the second request.

> **Do not enable "Cache Everything" as a blanket page rule.** The dashboard and `/api/*` share this
> hostname today. Cloudflare's default is to cache static assets and respect `Cache-Control` for
> HTML, which is exactly the behaviour the app now emits — the app decides, per route, and the
> dashboard's own `no-store` keeps it uncached.

---

## 4. Attach `b2consultants.de`

Do this only when the rebuilt pages have been verified on the temporary hostname.

1. **Traefik** — add the hostname to the router rule in `docker-compose.traefik.yml`:

   ```yaml
   traefik.http.routers.b2app.rule: Host(`${APP_DOMAIN}`) || Host(`b2consultants.de`)
   ```

   The existing `tls.certresolver: mytlschallenge` covers the new name; Traefik requests the
   certificate on first request, so DNS must resolve here **before** you reload.

2. **App** — set the domain on the site record (Website → the site → Domain & tracking). This is
   what makes the app treat the hostname as its own; until it is set, links are judged "external".

3. **Rebuild**, so `generateStaticParams` prerenders the pages under the new host.

### Order matters

`optin.b2consultants.de` stays on GHL and is a **separate DNS record**. Moving the apex must not
disturb it. Confirm the opt-in subdomain still resolves to GHL after the apex change — it is the
page carrying live lead flow, and it is the one thing here that must not break.

---

## 5. Tracking

Meta Pixel and GA4 ids are set per site in **Website → Domain & tracking**, and injected on public
pages only. Both are validated against their id formats (`^[0-9]{6,20}$`, `^G-[A-Z0-9]{4,20}$`)
because the values are interpolated into a script body. Unset means no script at all, rather than
one that initialises with an empty id and throws.

Scripts load `afterInteractive`: these pages are cached and fast, and making a visitor wait on a
third-party script before the page is usable would spend the speed the caching work just bought.

**Use the same pixel id the GHL pages use.** A new id starts Meta's learning phase from zero and
discards the conversion history the ad account is currently optimising against.
