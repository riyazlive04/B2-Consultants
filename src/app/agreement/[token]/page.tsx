import { headers } from "next/headers";
import { FileSignature } from "lucide-react";
import { clientIpFrom } from "@/lib/rate-limit";
import { AGREEMENT_PROVIDER } from "@/lib/agreement";
import { loadAgreementByToken, markAgreementViewed, maskPhone, type TokenFailure } from "@/server/agreement-core";
import type { AgreementData } from "@/lib/agreement";
import { SignCeremony } from "./_components/SignCeremony";

/**
 * The student's signing page. PUBLIC — the token is the only credential.
 *
 * The document itself is served as a PDF from `[token]/pdf`, rendered by the same component that
 * will produce the sealed copy, and framed here. There is deliberately no HTML rendition of the
 * clauses: a second rendering of a contract is a second contract.
 */

export const dynamic = "force-dynamic";

const REASONS: Record<TokenFailure, { title: string; body: string }> = {
  invalid: {
    title: "This link isn’t valid",
    body: "Check that you copied the whole link from your WhatsApp message.",
  },
  expired: {
    title: "This link has expired",
    body: "Signing links stay live for 14 days. Ask B2 Consultants to issue a new one.",
  },
  used: {
    title: "Already signed",
    body: "This agreement has been signed. Your countersigned copy was sent on WhatsApp.",
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

  if (!found.ok) {
    const r = REASONS[found.reason];
    return (
      <Shell>
        <div className="rounded-card border border-line bg-surface p-8 text-center shadow-card">
          <h1 className="font-display text-xl font-bold">{r.title}</h1>
          <p className="mt-2 text-sm text-muted">{r.body}</p>
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

  return (
    <Shell>
      <div className="space-y-5">
        <div className="rounded-card border border-line bg-surface px-5 py-4 shadow-card">
          <h1 className="font-display text-xl font-bold">Coaching &amp; Consulting Agreement</h1>
          <p className="mt-1 text-sm text-muted">
            Guided Mode · {found.row.documentNo} · for {data.student.fullName}
          </p>
          <p className="mt-2 text-xs text-muted">
            {AGREEMENT_PROVIDER.name} has already countersigned. Read the document below, then sign at the
            bottom of this page.
          </p>
        </div>

        <div className="overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <iframe
            src={`/agreement/${params.token}/pdf`}
            title={`Agreement ${found.row.documentNo}`}
            className="h-[70vh] min-h-[460px] w-full bg-surface-2"
          />
          <div className="border-t border-line px-4 py-2.5 text-center">
            <a
              href={`/agreement/${params.token}/pdf`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-medium text-primary hover:underline"
            >
              Trouble reading it here? Open the PDF in a new tab
            </a>
          </div>
        </div>

        <SignCeremony
          token={params.token}
          documentNo={found.row.documentNo}
          studentName={data.student.fullName}
          maskedPhone={maskPhone(data.student.phone)}
        />
      </div>
    </Shell>
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
