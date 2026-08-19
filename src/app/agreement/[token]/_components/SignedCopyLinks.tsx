import { Download, SquareArrowOutUpRight } from "lucide-react";

/**
 * The student's two routes to the contract they signed.
 *
 * `[token]/copy` has always served the sealed bytes, but nothing in the product ever pointed at it
 * - the only link lived inside the AGREEMENT_COPY WhatsApp message. That send is deliberately
 * fail-safe (`agreement-sign.ts`: it resolves an outcome, never throws), so whenever WATI is off or
 * the template is not yet approved the row lands SKIPPED and the message never arrives, leaving the
 * student with no way at all to obtain their own executed agreement. The token in their address bar
 * is the same credential the WhatsApp link would have carried, so the link belongs on both screens
 * that end the ceremony: straight after signing, and on any later return to the signing URL.
 *
 * Two anchors rather than one because "preview" and "download" are different needs: mobile browsers
 * will not render a PDF inside the page, and a signed contract is a document people file away.
 */
export function SignedCopyLinks({ token }: { token: string }) {
  const href = `/agreement/${token}/copy`;
  return (
    <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-10 items-center gap-1.5 rounded-btn bg-primary px-4 text-sm font-semibold text-on-accent transition-colors hover:bg-primary-strong"
      >
        <SquareArrowOutUpRight size={15} /> View your signed copy
      </a>
      {/* Same-origin, so the browser honours `download` and skips its built-in viewer. */}
      <a
        href={href}
        download
        className="inline-flex h-10 items-center gap-1.5 rounded-btn border border-line px-4 text-sm font-medium text-ink-2 transition-colors hover:border-primary hover:text-primary"
      >
        <Download size={15} /> Download PDF
      </a>
    </div>
  );
}
