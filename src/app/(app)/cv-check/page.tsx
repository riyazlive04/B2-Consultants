import { requireSection } from "@/lib/rbac";
import { CvCheckClient } from "./_components/CvCheckClient";

export const dynamic = "force-dynamic";

/**
 * CV ↔ JD diagnostic (report §3.C) - internal coaching aid for Admin/Head.
 * Deterministic scoring in the browser; nothing is stored, nothing is rewritten.
 * Guardrail (report §6): diagnose and coach, never do-it-for-them.
 */
export default async function CvCheckPage() {
  await requireSection("cv-check");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">CV Diagnostic</h1>
        <p className="mt-1 text-sm text-muted">
          Paste a student’s CV and the target JD - get the match score, missing keywords and weak
          bullets. A coaching aid: it names what’s broken, the student fixes it. Nothing is saved.
        </p>
      </div>
      <CvCheckClient />
    </div>
  );
}
