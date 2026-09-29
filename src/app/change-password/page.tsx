import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import ChangePasswordForm from "./ChangePasswordForm";

/**
 * The forced password-change destination (Error Log O4). An admin who sets someone's password
 * flags them, and `requireSession` bounces them here before any app route renders.
 *
 * Session is fetched DIRECTLY here - not via `requireSession` - so this one authenticated page
 * does not trip the same guard that sends people to it, which would loop. A visitor with no
 * session is sent to sign in (they cannot change a password they are not holding).
 */
export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (!session) redirect("/login");
  return <ChangePasswordForm />;
}
