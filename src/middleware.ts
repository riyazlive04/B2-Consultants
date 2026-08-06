import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { VISITOR_COOKIE } from "@/lib/ab";

/**
 * Fast redirect for unauthenticated visitors. This only checks cookie presence -
 * real session + role checks happen server-side in layouts/pages (requireSession /
 * requireSection), so nothing leaks even if a cookie is forged.
 */
// Public paths that must stay reachable without a session. Each machine-facing route below does
// its OWN authentication (shared secret, constant-time compared, fail-closed when unset) — they
// are "public" only in the sense that they carry no session cookie:
//  - /book            the prospect-facing booking page (Wave-1, replaces Synamate's form)
//  - /invite/*        redeem a single-use invite link. The token IS the credential; the page
//                     re-validates it server-side (unknown / already used / expired / suspended)
//  - /agreement/*     sign a coaching agreement. Same shape as /invite: the token IS the
//                     credential and is re-validated server-side on every call; signing also
//                     requires a one-time code sent to the student's WhatsApp number.
//                     NOTE THE SINGULAR. The founder's section is /agreements (plural) and stays
//                     behind the session — the test below is exact-match-or-followed-by-"/", so
//                     "/agreements" does not match the "/agreement" prefix.
//  - /api/leads/*     the Meta / FlexiFunnels lead-capture webhooks
//  - /api/wati/*      WATI delivery-status + inbound-reply webhook  (WATI_WEBHOOK_SECRET)
//  - /api/resend/*    Resend delivery-status + inbound-email webhook  (Svix-signed, RESEND_WEBHOOK_SECRET)
//  - /api/twilio/*    Twilio inbound-SMS + delivery-status webhook  (X-Twilio-Signature, TWILIO_AUTH_TOKEN)
//  - /api/cron/*      the scheduled reminder trigger, hit by an external cron (CRON_SECRET)
//  - /api/health      container liveness/readiness probe. Carries no data and no secret —
//                     it reports ok/degraded only, so it needs no session and leaks nothing.
//  - /f/*             Phase 2: publicly-hosted native forms (submit → idempotent lead-intake)
//  - /p/*             Phase 2: publicly-hosted funnel / landing pages
//  - /i/*             Phase 3: public invoice / estimate view + PDF (addressed by publicToken)
//  - /s/*             the marketing website (b2consultants.de). Doubly gated in the data layer:
//                     getPublicPage requires BOTH the site and the page to be `published`, so an
//                     unpublished draft is not reachable by guessing its path.
//  - /forgot-password, /reset-password  password-reset flow — no session exists yet by definition
// NOTE: the test is exact-match-or-followed-by-"/", so "/f", "/p", "/i" and "/s" never match app
// routes like /funnel, /finance, /people, /pipeline, /profile, /students, /sites (all longer than
// one letter, and /invite is its own prefix anyway).
const PUBLIC_PREFIXES = [
  "/book", "/invite", "/agreement",
  "/api/leads", "/api/wati", "/api/resend", "/api/twilio", "/api/cron", "/api/health",
  // Direct capture endpoints (landing pages posting straight to us, no relay). Same
  // fail-closed shared-secret contract as /api/leads — see server/intake-route.ts.
  // NOT /api/export: that one is session-gated, and a public export of 23,545 contacts
  // would be the single worst hole this list could open.
  "/api/intake",
  // Attachment upload for a public form's File Upload field. Unauthenticated by necessity — the
  // person sending their CV has no account — and defended instead by being bound to a published
  // form that actually has such a field, rate limited, magic-byte sniffed and size capped. See
  // the note at the top of the route; it is NOT a general uploader.
  "/api/form-upload",
  "/f", "/p", "/i", "/s",
  // Brand assets served from `public/media/` — the logo and hero stills the PUBLIC funnel and
  // marketing pages reference. Without this the pages themselves are reachable but every image
  // on them 307s to /login, so a cold visitor gets a page of broken images. Static files only:
  // `public/` is not code and holds nothing session-scoped.
  "/media",
  "/forgot-password", "/reset-password",
];

/**
 * The sign-in screens. All three render the same `LoginForm` with different copy — `/portal` for
 * students, `/tutor` for German Note tutors — and all three must be reachable WITHOUT a session,
 * or the entry points built for people who have not signed in yet would bounce them to the one
 * that says "Internal tool".
 */
const LOGIN_PATHS = new Set(["/login", "/portal", "/tutor"]);

/**
 * Stamp an anonymous visitor id on the funnel routes, so an A/B split can be STICKY.
 *
 * This is the only place it can happen. A Server Component may not set cookies, and the funnel
 * step is one — so if the id were minted where it is used, every request would mint a new one and
 * a visitor who reloaded would see the other arm of the test.
 *
 * The value is opaque and carries nothing: it is not an identity, it is a coin that stays the
 * same. `httpOnly` because no browser code needs it and it should not be readable by a pasted
 * third-party pixel; `lax` so it survives the click in from an ad without being sent on
 * cross-site subrequests; a year, because a test that forgets its visitors is not a test.
 *
 * It is written on the REQUEST as well as the response, so the very first page view is already
 * assigned rather than falling back to the control and then switching on the second impression.
 */
function withVisitorId(request: NextRequest): NextResponse {
  const existing = request.cookies.get(VISITOR_COOKIE)?.value;
  if (existing) return NextResponse.next();

  const id = crypto.randomUUID();
  request.cookies.set(VISITOR_COOKIE, id);
  const res = NextResponse.next({ request: { headers: request.headers } });
  res.cookies.set(VISITOR_COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = LOGIN_PATHS.has(pathname);
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) {
    // Only the funnel pages. Every other public route — the webhooks, the invoice links, the
    // booking page — has nothing to split-test, and setting a cookie on a machine-to-machine
    // webhook call would be noise in someone's logs at best.
    return pathname === "/p" || pathname.startsWith("/p/") ? withVisitorId(request) : NextResponse.next();
  }

  const cookie = getSessionCookie(request);
  if (!cookie && !isLogin) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  // NOTE: no cookie-presence bounce off /login here — a stale cookie would loop
  // (/login → / → /login …). The login page itself validates the session and
  // redirects home only when it is genuinely valid.
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
