"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircleQuestion } from "lucide-react";
import { submitAbsenceReason } from "@/server/absence-reason-actions";
import type { AbsenceQuestion } from "@/server/catch-up";
import { Btn } from "@/components/ui/controls";
import { FormError } from "@/components/ui/form";
import { toast } from "@/components/ui/feedback";
import { formatDate } from "@/lib/format";

/**
 * "YOUR COACH ASKED WHY YOU MISSED THIS."
 *
 * Shown only when a coach has actually asked - there is no standing "why were you away?" box
 * anywhere in the portal, which is the whole point of the founders' instruction to capture a
 * reason only when nudged. A box on every missed class is a form nobody fills in, and the
 * silence it produces is indistinguishable from not caring.
 *
 * Because it is rare, it is worth interrupting for: it sits near the top of the dashboard, says
 * who asked, and takes one sentence to answer. And it is answerable ONCE - a reason a student
 * can rewrite after their coach has read it, and possibly excused them on the strength of it,
 * is not evidence of anything.
 */
export function AbsenceQuestionCard({ questions }: { questions: AbsenceQuestion[] }) {
  if (questions.length === 0) return null;
  return (
    <div className="space-y-3">
      {questions.map((q) => (
        <OneQuestion key={q.sessionId} q={q} />
      ))}
    </div>
  );
}

function OneQuestion({ q }: { q: AbsenceQuestion }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await submitAbsenceReason({ sessionId: q.sessionId, reason });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(true);
    toast("Sent to your coach.", "success");
    router.refresh();
  };

  if (done) {
    return (
      <section className="rounded-card border border-good/30 bg-good-soft p-4">
        <p className="text-sm font-medium text-good">
          Thanks - your coach has your answer about {q.sessionTitle}.
        </p>
      </section>
    );
  }

  return (
    <section aria-live="polite" className="rounded-card border border-warn/30 bg-warn-soft p-5">
      <div className="flex flex-wrap items-start gap-3">
        <MessageCircleQuestion size={18} className="mt-0.5 text-warn" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[15px] font-semibold text-ink">
            {q.askedByName ? `${q.askedByName} asked` : "Your coach asked"} why you missed{" "}
            {q.sessionTitle}
          </p>
          <p className="text-caption text-muted">
            {q.batchName} · {formatDate(q.classDateYmd)}
          </p>

          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="min-w-[220px] flex-1">
              <span className="sr-only">Why you missed {q.sessionTitle}</span>
              <input
                type="text"
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && reason.trim().length >= 2) submit();
                }}
                placeholder="I was travelling for work that weekend"
                className="h-10 w-full rounded-field border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3"
              />
            </label>
            <Btn
              variant="primary"
              busy={busy}
              disabled={reason.trim().length < 2}
              onClick={submit}
            >
              Send
            </Btn>
          </div>
          <p className="mt-1.5 text-caption text-muted">
            One line is plenty. Your coach may excuse the absence, which takes it out of your
            attendance percentage.
          </p>
          <FormError message={error} />
        </div>
      </div>
    </section>
  );
}
