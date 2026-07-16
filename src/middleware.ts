import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

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
//  - /f/*             Phase 2: publicly-hosted native forms (submit → idempotent lead-intake)
//  - /p/*             Phase 2: publicly-hosted funnel / landing pages
//  - /i/*             Phase 3: public invoice / estimate view + PDF (addressed by publicToken)
//  - /forgot-password, /reset-password  password-reset flow — no session exists yet by definition
// NOTE: the test is exact-match-or-followed-by-"/", so "/f", "/p" and "/i" never match app routes
// like /funnel, /finance, /people, /pipeline, /profile, /invite (invite is its own prefix anyway).
const PUBLIC_PREFIXES = [
  "/book", "/invite", "/agreement",
  "/api/leads", "/api/wati", "/api/resend", "/api/twilio", "/api/cron",
  "/f", "/p", "/i",
  "/forgot-password", "/reset-password",
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isLogin = pathname === "/login";
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (isPublic) return NextResponse.next();

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
