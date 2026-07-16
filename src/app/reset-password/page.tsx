import ResetPasswordForm from "./ResetPasswordForm";

/**
 * Where the emailed reset link lands. Better Auth's own /api/auth/reset-password/:token
 * redirect (see the sendResetPassword callback in src/lib/auth.ts) forwards the
 * visitor here as /reset-password?token=<token> — a plain Server Component page can
 * read that straight off `searchParams`, no useSearchParams/Suspense dance needed.
 *
 * No session check here (unlike /login and /invite): the token, not a cookie, is the
 * credential, and better-auth's resetPassword endpoint doesn't care about session state.
 */
export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: { token?: string };
}) {
  return <ResetPasswordForm token={searchParams?.token ?? null} />;
}
