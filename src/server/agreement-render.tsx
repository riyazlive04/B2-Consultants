import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { AgreementGuidedV3 } from "@/documents/agreement-guided-v3";
import { AgreementGuidedV4, type AgreementDocProps, type CertificateEvent } from "@/documents/agreement-guided-v4";
import { sha256Hex, toOwnedBytes } from "@/lib/agreement-token";
import type { StoredDevice } from "@/lib/device";
import {
  AGREEMENT_TEMPLATE_VERSION,
  canonicalPayload,
  type AgreementData,
} from "@/lib/agreement";

/**
 * The ONLY place data becomes bytes. Preview and sealed artifact call the same function, so
 * "what the student read" and "what got signed" cannot drift apart.
 *
 * Node runtime only - @react-pdf/renderer is externalized in next.config.mjs.
 */

/** SHA-256 of the canonical (terms + template version). Deterministic; printed on every page. */
export function contentHash(data: AgreementData, templateVersion = AGREEMENT_TEMPLATE_VERSION): string {
  return sha256Hex(canonicalPayload(data, templateVersion));
}

/** react-pdf's <Image> takes a data URL; the database gives us raw PNG bytes. */
export function pngDataUrl(bytes: Uint8Array | Buffer | null | undefined): string | null {
  if (!bytes || bytes.length === 0) return null;
  return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
}


export type RenderInput = {
  documentNo: string;
  data: AgreementData;
  templateVersion?: string;
  founderSignaturePng?: Uint8Array | null;
  studentSignaturePng?: Uint8Array | null;
  founderSignedAt?: Date | null;
  signedAt?: Date | null;
  certificate?: {
    events: CertificateEvent[];
    signerIp?: string | null;
    signerUserAgent?: string | null;
    otpVerifiedAt?: Date | null;
    deliveredTo?: string | null;
    device?: StoredDevice | null;
  } | null;
};

/**
 * Render the agreement.
 *
 * The bytes are NOT reproducible: PDFKit stamps a creation date and a document id, so calling
 * this twice with identical input yields two different buffers. That is fine for preview and
 * fatal for verification - which is why `sealAgreementPdf` hashes once and the hash is stored,
 * and why nothing in this codebase ever re-renders to check a hash.
 */
export async function renderAgreementPdf(input: RenderInput): Promise<Buffer> {
  const templateVersion = input.templateVersion ?? AGREEMENT_TEMPLATE_VERSION;
  /**
   * Dispatch on the version stored on the ROW, never on the current one.
   *
   * This is the whole reason the version exists: a contract signed under guided-v3 must go on
   * rendering the v3 clause set for as long as it is enforceable, even though every new agreement
   * is drawn up under v4. The props are identical across versions (`AgreementDocProps`), so the
   * only thing that varies is which component - and the shape of the data, which stays
   * backward-compatible precisely so an old row can still be handed to its old renderer.
   *
   * Adding guided-v5 means adding a file and a line here, never editing v3 or v4 in place.
   */
  const Template = TEMPLATES[templateVersion];
  if (!Template) {
    throw new Error(
      `No renderer for template version "${templateVersion}". Signed agreements must render their own clause set.`,
    );
  }

  return renderToBuffer(
    <Template
      documentNo={input.documentNo}
      dataSha256={contentHash(input.data, templateVersion)}
      data={input.data}
      founderSignature={pngDataUrl(input.founderSignaturePng)}
      studentSignature={pngDataUrl(input.studentSignaturePng)}
      founderSignedAt={input.founderSignedAt ?? null}
      signedAt={input.signedAt ?? null}
      certificate={input.certificate ?? null}
    />,
  );
}

/**
 * Every clause set this codebase can still render, by the version string stored on the row.
 *
 * NOTHING may be removed from this map while an agreement in the table still carries that
 * version - dropping an entry does not deprecate a template, it makes a signed contract
 * undownloadable. The current one is `AGREEMENT_TEMPLATE_VERSION` (lib/agreement).
 */
const TEMPLATES: Record<string, (props: AgreementDocProps) => React.JSX.Element> = {
  "guided-v3": AgreementGuidedV3,
  "guided-v4": AgreementGuidedV4,
};

/** Render once, hash the exact bytes that will be stored. Called only from the signing path. */
export async function sealAgreementPdf(input: RenderInput) {
  const buf = await renderAgreementPdf(input);
  // Hash the Buffer; store standalone bytes - Prisma's `Bytes` will not take a pooled Buffer.
  return { bytes: toOwnedBytes(buf), sha256: sha256Hex(buf), size: buf.length };
}
