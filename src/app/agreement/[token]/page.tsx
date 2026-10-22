import { headers } from "next/headers";
import { FileSignature } from "lucide-react";
import { clientIpFrom } from "@/lib/rate-limit";
import { AGREEMENT_PROVIDER } from "@/lib/agreement";
import { loadAgreementByToken, markAgreementViewed, maskPhone, type TokenFailure } from "@/server/agreement-core";
import { uploadedBodyFor } from "@/server/agreement-body";
import {
  coSignersBlocking,
  loadSignerByToken,
  type SignerTokenRow,
} from "@/server/agreement-signers";
import { signerInputFields } from "@/lib/agreement-doc";
import type { AgreementData } from "@/lib/agreement";
import { SignCeremony } from "./_components/SignCeremony";
import { SignedCopyLinks } from "./_components/SignedCopyLinks";

/**
 * The signing page. PUBLIC - the token is the only credential.
 *
 * ── ONE URL, TWO COUNTERPARTIES ─────────────────────────────────────────────────────────────
 * The same route serves the student and a co-signer (a parent or guardian), and which one the
 * visitor is comes from WHICH TABLE their token resolves in - `agreement.tokenHash` or
 * `agreement_signer.tokenHash`. Never from the URL, a query parameter or anything else the
 * visitor could change: that is what makes it impossible to open somebody else's part of the
 * ceremony by editing a link.
 *
 * The student's is tried first because it is the common case, and a token that resolves in
 * neither is simply "not valid" - the page must not become an oracle that tells the holder of a
 * wrong link which kind of signer they nearly were.
 *
 * The document itself is served as a PDF from `[token]/pdf`, rendered by the same component that
 * will produce the sealed copy, and framed here. There is deliberately no HTML rendition of the
 * clauses: a second rendering of a contract is a second contract.
 */

export const dynamic = "force-dynamic";

const REASONS: Record<TokenFailure, { title: string; body: string }> = {
  invalid: {
    title: "This link isn’t valid",
    body: "Check that you copied the whole link from your WhatsApp message or email.",
  },
  expired: {
    title: "This link has expired",
    body: "Signing links are time-limited. Ask B2 Consultants to issue a new one.",
  },
  used: {
    title: "Already signed",
    body: "This agreement has been signed. Your countersigned copy was sent to you - you can also open or download it here.",
  },
  declined: {
    title: "Agreement declined",
    body: "This agreement was declined. Contact B2 Consultants if that was a mistake.",
  },
  voided: {
    title: "Agreement withdrawn",
    body: "B2 Consultants withdrew this agreement. A revised one may be on its way.",
  },
};

export default async function SignAgreementPage({ params }: { params: { token: string } }) {
  const found = await loadAgreementByToken(params.token);

  // ── A co-signer's own link ──
  if (!found.ok) {
    const coSigner = await loadSignerByToken(params.token);
    if (coSigner.ok) return <CoSignerView token={params.token} row={coSigner.row} />;

    const r = REASONS[found.reason];
    return (
      <Shell>
        <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
          <h1 className="font-display text-xl font-bold">{r.title}</h1>
          <p className="mt-2 text-sm text-muted">{r.body}</p>
          {/* "used" is the ONLY failure that still has a document behind it, and it always does:
              signing seals `pdfBytes` in the same updateMany that sets `signedAt`, and a signed row
              can never be voided or declined (both guard on `signedAt: null`), so no extra lookup is
              needed to know the copy route will answer. */}
          {found.reason === "used" && <SignedCopyLinks token={params.token} />}
          <p className="mt-6 text-xs text-muted">
            {AGREEMENT_PROVIDER.email} · {AGREEMENT_PROVIDER.mobile}
          </p>
        </div>
      </Shell>
    );
  }

  const h = await Promise.resolve(headers());
  // First open flips SENT → VIEWED. The compare-and-set inside makes a refresh a no-op.
  await markAgreementViewed(found.row.id, { ip: clientIpFrom(h), userAgent: h.get("user-agent") });

  const data = found.row.data as unknown as AgreementData;

  /**
   * The student's own boxes, and whether anybody has to sign before them.
   *
   * Both come from the uploaded body, so a guided agreement has neither - which is why this is
   * conditional rather than always loaded: the guided clause set has its signature block typeset
   * into the document and nothing for the student to fill in.
   */
  const body = found.row.documentKind === "GUIDED" ? null : await uploadedBodyFor(found.row.id);
  const inputFields = body ? signerInputFields(body.fields, "STUDENT") : [];
  const blocking = body ? await coSignersBlocking(found.row.id, body.fields) : [];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="rounded-card border border-line bg-surface px-5 py-4 shadow-card">
          <h1 className="font-display text-xl font-bold">Coaching &amp; Consulting Agreement</h1>
          <p className="mt-1 text-sm text-muted">
            {found.row.documentNo} · for {data.student.fullName}
          </p>
          <p className="mt-2 text-xs text-muted">
            {AGREEMENT_PROVIDER.name} has already countersigned. Read the document below, then sign at the
            bottom of this page.
          </p>
        </div>

        <DocumentFrame token={params.token} documentNo={found.row.documentNo} />

        <SignCeremony
          token={params.token}
          documentNo={found.row.documentNo}
          studentName={data.student.fullName}
          maskedPhone={maskPhone(data.student.phone)}
          role="STUDENT"
          inputFields={inputFields}
          blocking={blocking}
        />
      </div>
    </Shell>
  );
}

/**
 * The co-signer's view of the same document.
 *
 * Deliberately NOT marked as viewed: `markAgreementViewed` records that the STUDENT opened their
 * link, which is a fact about the student and is reproduced on the certificate. A guardian reading
 * the document is their own event, and inventing one here would put a false line on the trail.
 */
async function CoSignerView({ token, row }: { token: string; row: SignerTokenRow }) {
  const data = row.agreement.data as unknown as AgreementData;
  const body = row.agreement.documentKind === "GUIDED" ? null : await uploadedBodyFor(row.agreementId);
  const inputFields = body ? signerInputFields(body.fields, "GUARDIAN") : [];

  return (
    <Shell>
      <div className="space-y-5">
        <div className="rounded-card border border-line bg-surface px-5 py-4 shadow-card">
          <h1 className="font-display text-xl font-bold">Please co-sign this agreement</h1>
          <p className="mt-1 text-sm text-muted">
            {row.agreement.documentNo} · {data.student.fullName}&apos;s coaching agreement
          </p>
          <p className="mt-2 text-xs text-muted">
            {row.name}, {AGREEMENT_PROVIDER.name} has already countersigned this agreement. Your signature
            is needed before {data.student.fullName.split(" ")[0]} can sign it.
          </p>
        </div>

        <DocumentFrame token={token} documentNo={row.agreement.documentNo} />

        <SignCeremony
          token={token}
          documentNo={row.agreement.documentNo}
          studentName={data.student.fullName}
          signerName={row.name}
          maskedPhone={maskPhone(row.phone)}
          role="GUARDIAN"
          inputFields={inputFields}
        />
      </div>
    </Shell>
  );
}

/**
 * The document, framed.
 *
 * The escape hatch below it is load-bearing, not a nicety: iOS and most Android browsers refuse
 * to render a PDF inside an iframe, so without it a signer on a phone gets a blank panel and
 * concludes the agreement is broken.
 */
function DocumentFrame({ token, documentNo }: { token: string; documentNo: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
      <iframe
        src={`/agreement/${token}/pdf`}
        title={`Agreement ${documentNo}`}
        className="h-[70vh] min-h-[460px] w-full bg-surface-2"
      />
      <div className="border-t border-line px-4 py-2.5 text-center">
        <a
          href={`/agreement/${token}/pdf`}
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-primary hover:underline"
        >
          Trouble reading it here? Open the PDF in a new tab
        </a>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-surface-2 px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-center gap-2 text-muted">
          <FileSignature size={18} />
          <span className="text-sm font-semibold tracking-wide">{AGREEMENT_PROVIDER.entity}</span>
        </div>
        {children}
        <p className="mt-8 text-center text-xs text-muted">
          {AGREEMENT_PROVIDER.address} · {AGREEMENT_PROVIDER.website}
        </p>
      </div>
    </main>
  );
}
