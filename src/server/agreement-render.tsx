import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { AgreementGuidedV3 } from "@/documents/agreement-guided-v3";
import { AgreementGuidedV4, type AgreementDocProps, type CertificateEvent } from "@/documents/agreement-guided-v4";
import { AgreementUploadDocxV1, uploadDocTitle } from "@/documents/agreement-upload-docx-v1";
import { sha256Hex, toOwnedBytes } from "@/lib/agreement-token";
import type { StoredDevice } from "@/lib/device";
import {
  AGREEMENT_TEMPLATE_VERSION,
  canonicalPayload,
  type AgreementData,
} from "@/lib/agreement";
import {
  docBodyHashInput,
  UPLOAD_TEMPLATE_VERSIONS,
  type DocBody,
  type SignerValues,
} from "@/lib/agreement-doc";
import { fillFields } from "@/lib/agreement-fill";
import { mergeBlocks } from "@/lib/agreement-merge";
import { stampAgreementPdf } from "./agreement-pdf-overlay";

/**
 * The ONLY place data becomes bytes. Preview and sealed artifact call the same function, so
 * "what the student read" and "what got signed" cannot drift apart.
 *
 * Node runtime only - @react-pdf/renderer is externalized in next.config.mjs.
 */

/**
 * SHA-256 of the canonical (terms + template version + uploaded body). Deterministic; printed on
 * every page.
 *
 * `body` is optional and MUST stay optional: `canonicalPayload` drops the key when it is absent,
 * so a GUIDED agreement hashes exactly as it did before uploaded documents existed and every
 * already-signed PDF keeps the hash printed on its pages. See the regression guard in
 * `lib/__tests__/agreement-doc.test.ts`.
 */
export function contentHash(
  data: AgreementData,
  templateVersion = AGREEMENT_TEMPLATE_VERSION,
  body?: DocBody | null,
): string {
  return sha256Hex(canonicalPayload(data, templateVersion, body ? docBodyHashInput(body) : undefined));
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
  /**
   * The uploaded document, for an agreement whose `documentKind` is not GUIDED. Required for the
   * upload-* template versions and ignored by the guided ones.
   *
   * `sourceBytes` is only needed by the PDF path - the DOCX path renders from `body.blocks` - so
   * callers rendering a Word agreement may leave it out and skip pulling a bytea.
   */
  body?: (DocBody & { sourceBytes?: Uint8Array | null }) | null;
  /**
   * What the STUDENT typed or ticked in their own boxes (`Agreement.signerFieldValues`). Produced
   * at signing, so it is absent on every preview - which is why an unanswered checkbox renders as
   * an empty square rather than an unticked one.
   */
  signerValues?: SignerValues | null;
  /**
   * The co-signer, when the document has one. A guardian signs BEFORE the student (see the note on
   * `SIGNER_ROLES`), so by the time the sealing render happens their ink is already on record.
   */
  guardian?: {
    name: string;
    signaturePng?: Uint8Array | null;
    signedAt?: Date | null;
    values?: SignerValues | null;
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
   * rendering the v3 clause set for as long as it is enforceable, even though every new guided
   * agreement is drawn up under v4 - and an agreement signed on an uploaded document must go on
   * rendering through the renderer it was signed under.
   *
   * Adding a version means adding a file and a branch, never editing one that is in use.
   */
  if (templateVersion === UPLOAD_TEMPLATE_VERSIONS.DOCX) return renderUploadedDocx(input, templateVersion);
  if (templateVersion === UPLOAD_TEMPLATE_VERSIONS.PDF) return renderUploadedPdf(input, templateVersion);

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
 * Every GUIDED clause set this codebase can still render, by the version string stored on the row.
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

// ───────────────────────────── Uploaded documents ─────────────────────────────

function requireBody(input: RenderInput, templateVersion: string) {
  if (!input.body) {
    throw new Error(
      `Template "${templateVersion}" renders an uploaded document, but no body was loaded for ${input.documentNo}.`,
    );
  }
  return input.body;
}

/**
 * The two halves every uploaded render needs: the fields resolved to what they print, and the
 * document's own title.
 *
 * `asOf` is the issue date once there is one, else today - so a draft preview is dated today and
 * a sealed copy is dated when it was actually countersigned, and `{{document.date}}` means the
 * same thing in both.
 */
function prepare(input: RenderInput, body: DocBody) {
  const filled = fillFields({
    fields: body.fields,
    data: input.data,
    ctx: {
      documentNo: input.documentNo,
      asOf: input.founderSignedAt ?? new Date(),
      // A CREATOR text box may hold `{{custom.*}}` just as the prose may, so the declarations
      // have to reach `fillFields` too - not only `mergeBlocks` below.
      custom: body.options?.custom,
    },
    signers: {
      CREATOR: {
        ink: pngDataUrl(input.founderSignaturePng),
        signedAt: input.founderSignedAt ?? null,
      },
      STUDENT: {
        ink: pngDataUrl(input.studentSignaturePng),
        signedAt: input.signedAt ?? null,
        values: input.signerValues ?? null,
      },
      ...(input.guardian
        ? {
            GUARDIAN: {
              ink: pngDataUrl(input.guardian.signaturePng),
              signedAt: input.guardian.signedAt ?? null,
              name: input.guardian.name,
              values: input.guardian.values ?? null,
            },
          }
        : {}),
    },
  });
  return { filled };
}

async function renderUploadedDocx(input: RenderInput, templateVersion: string): Promise<Buffer> {
  const body = requireBody(input, templateVersion);
  const blocks = body.blocks ?? [];
  const { filled } = prepare(input, body);
  const title = uploadDocTitle(blocks, body.sourceName.replace(/\.docx$/i, ""));

  return renderToBuffer(
    <AgreementUploadDocxV1
      documentNo={input.documentNo}
      dataSha256={contentHash(input.data, templateVersion, body)}
      templateVersion={templateVersion}
      title={title}
      studentName={input.data.student.fullName}
      // Tokens are resolved HERE, on the way in, so the renderer never sees a `{{...}}`.
      blocks={mergeBlocks(blocks, input.data, {
        documentNo: input.documentNo,
        asOf: input.founderSignedAt ?? new Date(),
        custom: body.options?.custom,
      })}
      filled={filled}
      options={body.options ?? null}
      signedAt={input.signedAt ?? null}
      certificate={input.certificate ?? null}
    />,
  );
}

async function renderUploadedPdf(input: RenderInput, templateVersion: string): Promise<Buffer> {
  const body = requireBody(input, templateVersion);
  if (!body.sourceBytes || body.sourceBytes.length === 0) {
    throw new Error(`Agreement ${input.documentNo} is a PDF document but its stored file is missing.`);
  }
  const { filled } = prepare(input, body);

  return stampAgreementPdf({
    source: body.sourceBytes,
    documentNo: input.documentNo,
    dataSha256: contentHash(input.data, templateVersion, body),
    templateVersion,
    title: body.sourceName.replace(/\.pdf$/i, ""),
    studentName: input.data.student.fullName,
    filled,
    options: body.options ?? null,
    signedAt: input.signedAt ?? null,
    certificate: input.certificate ?? null,
  });
}
