import "server-only";
import { captureException } from "@/lib/observability";
import {
  IMPROVEMENT_KIND_SHORT,
  IMPROVEMENT_SEVERITY_SHORT,
  type ImprovementKind,
  type ImprovementSeverity,
} from "@/lib/improvement";

/**
 * Forward an improvement report to SirahOS as a change request.
 *
 * Fire-and-forget: never throws, never rejects, logs a warning on failure.
 * Called from `afterResponse` so the reporter never waits on it.
 */

const TIMEOUT_MS = 10_000;

export type SirahosForwardPayload = {
  id: string;
  ref: string;
  kind: ImprovementKind;
  severity: ImprovementSeverity;
  title: string;
  description: string;
  expectedBehaviour: string | null;
  route: string;
  reporterName: string;
  reporterRole: string;
};

const KIND_LABEL: Record<ImprovementKind, string> = {
  NOT_WORKING: "Bug",
  WRONG_RESULT: "Wrong result",
  LOGIC_CHANGE: "Logic change",
  MISSING_STATE: "Missing state",
  NEW_FEATURE: "New feature",
  CONFUSING: "UI issue",
  ACCESS: "Access",
};

function buildTitle(kind: ImprovementKind, title: string): string {
  const label = KIND_LABEL[kind];
  return `[${label}] ${title}`.slice(0, 200);
}

function buildDescription(p: SirahosForwardPayload): string {
  const parts: string[] = [p.description];
  if (p.expectedBehaviour) {
    parts.push("", `Expected: ${p.expectedBehaviour}`);
  }
  parts.push(
    "",
    `Page: ${p.route}`,
    `Severity: ${IMPROVEMENT_SEVERITY_SHORT[p.severity]}`,
    `B2 Consultants report: ${p.ref}`,
  );
  return parts.join("\n").slice(0, 5000);
}

export async function forwardToSirahos(p: SirahosForwardPayload): Promise<void> {
  const url = process.env.SIRAHOS_URL;
  const projectId = process.env.SIRAHOS_PROJECT_ID;
  const secret = process.env.SIRAHOS_SECRET;

  if (!url || !projectId || !secret) return;

  try {
    const res = await fetch(`${url}/api/change-intake/${projectId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sirahos-Signature": secret,
      },
      body: JSON.stringify({
        title: buildTitle(p.kind, p.title),
        description: buildDescription(p),
        requestedBy: `${p.reporterName} (${p.reporterRole})`.slice(0, 120),
        reference: p.ref.slice(0, 200),
        source: "b2-consultants",
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok && res.status !== 200 && res.status !== 201) {
      console.warn(`[sirahos-forward] ${p.ref}: HTTP ${res.status}`);
    }
  } catch (err) {
    console.warn(`[sirahos-forward] ${p.ref}: failed`, err instanceof Error ? err.message : err);
    await captureException(err, { where: "sirahos-forward" }).catch(() => {});
  }
}
