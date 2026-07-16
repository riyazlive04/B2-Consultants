import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import ForgotPasswordForm from "./ForgotPasswordForm";

/**
 * Request a password-reset email. Public by necessity (the visitor has no session) —
 * mirrors /login's "already signed in?" check (validates the session, not just the
 * cookie) so a stale cookie can't loop, and so a signed-in person is bounced home
 * instead of being offered a reset they don't need.
 */
export default async function ForgotPasswordPage() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (session) redirect("/");
  return <ForgotPasswordForm />;
}
