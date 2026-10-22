"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { MERGE_FIELD_GROUPS } from "@/lib/agreement-merge";
import { customToken, type DocCustomField } from "@/lib/agreement-doc";
import { PLACEHOLDER_HELP } from "@/lib/docx-blocks";

/**
 * The merge-field reference, as something the founder can copy out of rather than retype.
 *
 * It lives beside the editor because this is where the tokens get used, and because a mistyped
 * token is the one authoring mistake that blocks sending (see `documentReadiness`) - the cheapest
 * fix is to make typing one unnecessary.
 */
export function MergeTokens({
  custom = [],
  showPlaceholders = true,
}: {
  /**
   * The founder's own declarations, so they are copyable from the SAME list as the built-in
   * tokens. Listed here as well as in the panel that defines them because this is the list
   * somebody reads while writing a sentence, and a token you have to retype is a token you
   * eventually mistype - which is the one authoring mistake that blocks sending.
   */
  custom?: DocCustomField[];
  showPlaceholders?: boolean;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = async (token: string) => {
    const text = `{{${token}}}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(token);
      window.setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      // Clipboard access is denied in some browsers until the page is interacted with, and on
      // http origins. The token is written beside the button, so there is nothing to recover.
    }
  };

  /** A row still being typed has no name yet - it belongs in the editor, not in a reference. */
  const named = custom.filter((c) => c.token.trim().length > 0);

  return (
    <div className="space-y-4">
      <div>
        <h3 className="font-display text-sm font-bold">Merge fields</h3>
        <p className="mt-1 text-xs text-muted">
          Type these anywhere in your Word document. They are replaced with this agreement&apos;s own
          values when the PDF is made - so one template serves every student.
        </p>
      </div>

      {/* First, because they are the ones this founder invented and will go looking for. */}
      {named.length > 0 && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">Your own fields</p>
          <ul className="space-y-1">
            {named.map((field) => (
              <li key={field.token} className="flex items-center justify-between gap-2 text-xs">
                <code className="truncate font-mono text-ink-2">{`{{${customToken(field)}}}`}</code>
                <span className="flex items-center gap-1.5">
                  <span className="hidden text-muted sm:inline">{field.label}</span>
                  <button
                    type="button"
                    onClick={() => copy(customToken(field))}
                    className="rounded-field p-1 text-muted transition-colors hover:bg-surface-2 hover:text-primary"
                    aria-label={`Copy ${customToken(field)}`}
                  >
                    {copied === customToken(field) ? (
                      <Check size={13} className="text-ok" />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {MERGE_FIELD_GROUPS.map((group) => (
        <div key={group.group}>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted">{group.group}</p>
          <ul className="space-y-1">
            {group.tokens.map((t) => (
              <li key={t.token} className="flex items-center justify-between gap-2 text-xs">
                <code className="truncate font-mono text-ink-2">{`{{${t.token}}}`}</code>
                <span className="flex items-center gap-1.5">
                  <span className="hidden text-muted sm:inline">{t.label}</span>
                  <button
                    type="button"
                    onClick={() => copy(t.token)}
                    className="rounded-field p-1 text-muted transition-colors hover:bg-surface-2 hover:text-primary"
                    aria-label={`Copy ${t.token}`}
                  >
                    {copied === t.token ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}

      {showPlaceholders && (
        <div className="rounded-field border border-line bg-surface-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Signature placeholders</p>
          <p className="mt-1 text-xs text-muted">
            Write these in Word where each party should sign, and they become signature zones on upload.
            You can also add and move them here afterwards.
          </p>
          <ul className="mt-2 space-y-1">
            {PLACEHOLDER_HELP.map((line) => (
              <li key={line} className="font-mono text-[11px] text-ink-2">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
