import { requireSection, requireAdmin } from "@/lib/rbac";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getStageMessagesConfig } from "@/server/stage-messages";
import { getWatiRuntime } from "@/lib/wati";
import { STAGE_MESSAGE_STAGES, stageWhatsAppKind } from "@/lib/stage-messages";
import StageMessagesForm from "./_components/StageMessagesForm";

export const dynamic = "force-dynamic";

/**
 * WhatsApp → Stage messages. Founder-only: the email + WhatsApp each pipeline stage sends.
 *
 * ── Why it lives here, and not where it was built ───────────────────────────────────────
 * This page was `/automation/stage-messages`, gated on the `automation` section. Automation was
 * removed from the product on 23/10/2026 at the founder's instruction - and taking this page with
 * it would have been a quiet mistake, because stage messages are NOT part of the workflow
 * builder. They are live: `runStageMessages()` fires on every `/api/cron/outreach` run, and
 * `lead-intake.ts` calls `announceReturningOptIn` from the same module. This page was their only
 * editor.
 *
 * So deleting it would have left a cron sending emails and WhatsApps to real prospects with no
 * way for anybody to read or change the wording. It is re-homed under WhatsApp instead, which is
 * the section that already owns outbound messaging, its templates and its opt-outs - and which is
 * Admin-only, as this has always been.
 *
 * The engine, the config reader and the writer are untouched; only the door moved.
 */
export default async function StageMessagesPage() {
  await requireSection("whatsapp");
  await requireAdmin();
  const [config, wati] = await Promise.all([getStageMessagesConfig(), getWatiRuntime()]);
  const boundTemplates = Object.fromEntries(
    STAGE_MESSAGE_STAGES.map((s) => [s, wati.settings.templates[stageWhatsAppKind(s)]?.name ?? null]),
  ) as Record<string, string | null>;

  return (
    <div className="w-full">
      <Breadcrumbs items={[{ label: "WhatsApp", href: "/whatsapp" }, { label: "Stage messages" }]} />
      <StageMessagesForm config={config} boundTemplates={boundTemplates} />
    </div>
  );
}
