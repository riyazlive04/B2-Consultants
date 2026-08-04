import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import LoginForm from "../login/LoginForm";

/**
 * The TUTOR entry point. See `/portal` — same reasoning, different copy: one auth path, one set
 * of guards, a heading that tells a German Note tutor they are in the right place.
 */
export const metadata = { title: "Tutor sign-in · B2 Consultants" };

export default async function TutorLoginPage() {
  const session = await auth.api.getSession({ headers: await Promise.resolve(headers()) });
  if (session) redirect("/");
  return <LoginForm variant="tutor" />;
}
