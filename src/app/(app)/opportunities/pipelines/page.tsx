import { requireSection } from "@/lib/rbac";
import { hasCapability } from "@/lib/capabilities";
import { listPipelines } from "@/server/opportunities-metrics";
import { PipelinesTable } from "../_components/PipelinesTable";

export const dynamic = "force-dynamic";

/**
 * Pipelines - the management list behind the board.
 *
 * Gated on the same section as the board (`opportunities`), but every mutation on it additionally
 * needs the `pipeline.configure` capability, which is checked inside each server action. So a
 * viewer without it sees the list read-only rather than being refused the page: knowing which
 * pipelines exist is not the same as being allowed to reshape them.
 */
export default async function PipelinesPage() {
  const session = await requireSection("opportunities");
  const canConfigure = hasCapability(session.role, session.capabilities, "pipeline.configure");
  const pipelines = await listPipelines();

  return <PipelinesTable rows={pipelines} canConfigure={canConfigure} />;
}
