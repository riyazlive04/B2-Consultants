import { requireSection, requireAdmin } from "@/lib/rbac";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { getStageMessagesConfig } from "@/server/stage-messages";
import { getWatiRuntime } from "@/lib/wati";
import { STAGE_MESSAGE_STAGES, stageWhatsAppKind } from "@/lib/stage-messages";
import StageMessagesForm from "./_components/StageMessagesForm";

export const dynamic = "force-dynamic";

/** Automation → Stage messages. Founder-only: the email + WhatsApp each pipeline stage sends. */
export default async function StageMessagesPage() {
  await requireSection("automation");
  await requireAdmin();
  const [config, wati] = await Promise.all([getStageMessagesConfig(), getWatiRuntime()]);
  const boundTemplates = Object.fromEntries(
    STAGE_MESSAGE_STAGES.map((s) => [s, wati.settings.templates[stageWhatsAppKind(s)]?.name ?? null]),
  ) as Record<string, string | null>;

  return (
    <div className="w-full">
      <Breadcrumbs items={[{ label: "Automation", href: "/automation" }, { label: "Stage messages" }]} />
      <StageMessagesForm config={config} boundTemplates={boundTemplates} />
    </div>
  );
}
