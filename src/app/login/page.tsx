import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import LoginForm from "./LoginForm";

/**
 * The "already signed in?" check must VALIDATE the session, not just see a
 * cookie: a stale/invalid cookie (e.g. after a BETTER_AUTH_SECRET rotation)
 * otherwise ping-pongs /login → / → /login forever. Middleware only handles
 * the no-cookie case; this is the one place a session cookie is verified
 * before leaving the login screen.
 */
export default async function LoginPage() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (session) redirect("/");
  return <LoginForm />;
}
