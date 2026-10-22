import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import LoginForm from "../login/LoginForm";

/**
 * The COACH entry point. See `/portal` and `/tutor` - same reasoning, different copy: one auth
 * path, one set of guards, a heading that tells a coach they are in the right place.
 */
// Just the page name: the root layout's `template` appends " · B2 Consultants".
export const metadata = { title: "Coach sign-in" };

export default async function CoachLoginPage() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (session) redirect("/");
  return <LoginForm variant="coach" />;
}
