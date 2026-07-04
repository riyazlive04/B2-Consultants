import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * Fast redirect for unauthenticated visitors. This only checks cookie presence -
 * real session + role checks happen server-side in layouts/pages (requireSession /
 * requireSection), so nothing leaks even if a cookie is forged.
 */
// Public paths that must stay reachable without a session:
//  - /book            the prospect-facing booking page (Wave-1, replaces Synamate's form)
//  - /api/leads/*     the Meta / FlexiFunnels lead-capture webhooks
const PUBLIC_PREFIXES = ["/book", "/api/leads"];

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
