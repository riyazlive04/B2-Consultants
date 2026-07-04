import Link from "next/link";
import { GUIDES } from "@/lib/guide-content";
import { requireSection, sectionsFor } from "@/lib/rbac";

export const dynamic = "force-dynamic";

/** App Guide - short how-tos, filtered to the features this user can actually open. */
export default async function GuidePage() {
  const session = await requireSection("guide");
  const accessible = new Set(sectionsFor(session.role, session.overrides).map((s) => s.key));
  const visible = GUIDES.filter((g) => g.section === "general" || accessible.has(g.section));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="font-serif text-3xl font-semibold tracking-tight sm:text-4xl">App Guide</h1>
        <p className="mt-1 text-sm text-muted">
          How to use each feature, in thirty seconds. You only see guides for features you have
          access to.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {visible.map((g) => (
          <section key={g.title} className="flex flex-col rounded-card border border-line bg-surface p-5 shadow-card">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">
                <span aria-hidden className="mr-1.5">{g.icon}</span>
                {g.title}
              </h2>
              <Link
                href={g.href}
                className="whitespace-nowrap rounded-field border border-line px-3 py-1 text-sm font-medium text-accent hover:bg-surface-2"
              >
                Open →
              </Link>
            </div>
            <p className="mt-1 text-sm text-muted">{g.what}</p>
            <ol className="mt-3 flex-1 list-decimal space-y-1.5 pl-5 text-sm">
              {g.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            {g.tip && (
              <p className="mt-3 rounded-field bg-accent-soft px-3 py-2 text-xs text-accent">
                <strong>Tip:</strong> {g.tip}
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
