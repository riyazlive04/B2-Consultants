import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import LoginForm from "../login/LoginForm";

/**
 * The STUDENT entry point.
 *
 * Same component, same auth path, same guards as `/login` - only the copy differs. A student
 * signing in here still lands on `/my-journey` exactly as they always did; what they get is a
 * page headed with their own name for it. `sendLoginCredentials` links a student here.
 *
 * Deliberately NOT a second auth implementation. One credential path means one place a
 * credential bug can live, and a login screen is not somewhere to have two of anything.
 */
// Just the page name: the root layout's `template` appends " · B2 Consultants".
export const metadata = { title: "Student portal" };

export default async function StudentPortalPage() {
  // Validate the session rather than trusting the cookie - a stale cookie (e.g. after a secret
  // rotation) would otherwise ping-pong /portal → / → /portal forever.
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (session) redirect("/");
  return <LoginForm variant="student" />;
}
