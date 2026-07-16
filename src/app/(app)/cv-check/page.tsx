import { FileSearch } from "lucide-react";
import { PageHeader } from "@/components/ui/kit";
import { requireSection } from "@/lib/rbac";
import { listResumes, getResumeTemplate, getAiStatus } from "@/server/resume-metrics";
import { CvStudio } from "./_components/CvStudio";

export const dynamic = "force-dynamic";

/**
 * CV Studio (report §3.C). Three things in one place:
 *   • Builder — enter or import a CV into the founder's template, preview it live, and
 *     export a formatted PDF or an ATS-ready DOCX.
 *   • AI Review — score a CV against a target JD with Claude (keys-off → offline analyser).
 *   • Instant check — the original deterministic CV↔JD diagnostic (stores nothing).
 * Admins also get a Template & AI tab to set "how the resume should be" + the AI seam.
 */
export default async function CvCheckPage() {
  const session = await requireSection("cv-check");
  const isAdmin = session.role === "ADMIN";
  const [resumes, template, aiStatus] = await Promise.all([listResumes(), getResumeTemplate(), getAiStatus()]);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6">
      <PageHeader
        icon={<FileSearch size={20} />}
        title="CV Studio"
        subtitle="Build a CV in the B2 template, export it as PDF or an ATS-ready Word document, and review it against a job description — with Claude when it's switched on, or the offline analyser when it isn't. Uploaded files are read in-memory; saved CVs live in your workspace."
      />
      <CvStudio resumes={resumes} template={template} aiStatus={aiStatus} isAdmin={isAdmin} />
    </div>
  );
}
