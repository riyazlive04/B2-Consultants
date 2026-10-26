"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GraduationCap, UserCheck } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { Card, CardTitle } from "@/components/ui/kit";
import { toast, askConfirm } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { enrolFromAgreement } from "@/server/agreement-enrol";
import type { EnrolmentState } from "@/lib/agreement-enrol";

/**
 * The step that used to be missing: a signed agreement, and nothing anywhere telling anyone to
 * turn the signatory into a student.
 *
 * It is a PROMPT, not an automatic consequence of signing - see server/agreement-enrol.ts for why.
 * The wording names the next two things that have to happen (programme level, portal login),
 * because enrolling is not the finish line and a card that implied it was would strand people
 * one screen earlier instead of two.
 *
 * Shown only once the agreement is signed. Before that there is nothing to enrol from.
 */
export function EnrolPrompt({
  agreementId,
  studentName,
  state,
}: {
  agreementId: string;
  studentName: string;
  state: EnrolmentState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  // Already done. A quiet confirmation with a way through, not a call to action - this card is
  // the only place the document names the person it created.
  if (state.kind === "enrolled") {
    return (
      <Card title={<CardTitle icon={<UserCheck size={17} />}>Enrolled</CardTitle>}>
        <p className="text-body text-ink-2">
          {studentName} has a student record
          {state.code ? (
            <>
              {" "}
              (<span className="font-medium text-ink">{state.code}</span>)
            </>
          ) : null}
          .{" "}
          <Link href={`/students/${state.studentId}`} className="font-medium text-primary hover:underline">
            Open it
          </Link>{" "}
          to set the programme level or create their portal login.
        </p>
      </Card>
    );
  }

  if (state.kind === "no-client") {
    return (
      <Card title={<CardTitle icon={<GraduationCap size={17} />}>Cannot enrol</CardTitle>}>
        <p className="text-body text-ink-2">
          This agreement was raised against no contact, so there is nobody to enrol. Clone it onto a
          contact to carry the terms over.
        </p>
      </Card>
    );
  }

  /**
   * ── MORE THAN ONE STUDENT UNDER THIS CONTACT  (issue C6) ────────────────────────────────
   *
   * The refusal to guess is right and stays. What was wrong is that it was a dead end: the card
   * said "open the right student and link it by hand", named none of them, linked to none of
   * them, and offered no way to do the linking it was asking for. So the one state that exists
   * precisely because a human has to decide was the one state with nothing to decide with.
   *
   * It now lists the candidates - each openable in a new tab so the decision can be checked
   * against the real record before it is made - and the choice posts an explicit
   * `adoptStudentId`, which the server re-verifies against this lead. Being told which student
   * is not the same as guessing.
   */
  if (state.kind === "ambiguous") {
    return (
      <Card title={<CardTitle icon={<GraduationCap size={17} />}>Which student?</CardTitle>}>
        <p className="text-body text-ink-2">
          This contact has {state.count} student records, so we will not guess which one this
          agreement binds - a contract names one person, and attaching it to the wrong record would
          carry their fee and instalment plan with it. Pick the right one.
        </p>
        <ul className="mt-3 divide-y divide-line rounded-card border border-line">
          {state.candidates.map((c, i) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <span className="min-w-0 flex-1 text-sm text-ink">
                {c.code ? (
                  <span className="font-medium">{c.code}</span>
                ) : (
                  <span className="text-muted">No student code · record {i + 1}</span>
                )}
              </span>
              {/* A new tab, deliberately: checking which record is the right one means reading
                  it, and losing this card to do that is how somebody picks from memory. */}
              <Link
                href={`/students/${c.id}`}
                target="_blank"
                rel="noreferrer"
                className="text-caption font-semibold text-primary hover:underline"
              >
                Open to check
              </Link>
              <Btn
                size="sm"
                variant="primary"
                busy={busy}
                onClick={async () => {
                  const ok = await askConfirm({
                    title: "Link this agreement to that student?",
                    body: `${studentName}'s signed agreement, its fee and any instalment plan will belong to ${c.code ?? "this record"}. Check it is the right person first - this is the link the rest of the app reads.`,
                    confirmLabel: "Link it",
                  });
                  if (!ok) return;
                  setBusy(true);
                  const res = await safeAction(() => enrolFromAgreement(agreementId, c.id));
                  setBusy(false);
                  if (!res.ok) return toast(res.error, "error");
                  toast("Linked to their student record");
                  if (res.data?.studentId) router.push(`/students/${res.data.studentId}`);
                }}
              >
                This one
              </Btn>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  async function enrol() {
    const ok = await askConfirm({
      title: `Enrol ${studentName}?`,
      body: "Creates their student record from this contact and links it to this agreement. You can set the programme level and create their portal login on the student next.",
      confirmLabel: "Enrol",
    });
    if (!ok) return;
    setBusy(true);
    const res = await safeAction(() => enrolFromAgreement(agreementId));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(res.data?.created ? `${studentName} is now a student` : "Linked to their existing student record");
    // Straight to the record, because the two things still outstanding both live there.
    if (res.data?.studentId) router.push(`/students/${res.data.studentId}`);
  }

  return (
    <Card
      title={<CardTitle icon={<GraduationCap size={17} />}>Enrol {studentName}</CardTitle>}
      actions={
        <Btn variant="primary" onClick={enrol} busy={busy} icon={<GraduationCap size={15} />}>
          Enrol as a student
        </Btn>
      }
    >
      <p className="text-body text-ink-2">
        This agreement is signed, but {studentName} has no student record yet - so they do not appear
        in Students and cannot be given a portal login. Enrolling carries their details across from
        the contact and links the two records.
      </p>
      <p className="mt-2 text-caption text-muted">
        The programme level and the portal login are both set on the student afterwards; enrolling
        does not assume either.
      </p>
    </Card>
  );
}
