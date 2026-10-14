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

  if (state.kind === "ambiguous") {
    return (
      <Card title={<CardTitle icon={<GraduationCap size={17} />}>Which student?</CardTitle>}>
        <p className="text-body text-ink-2">
          This contact already has {state.count} student records, so we will not guess which one this
          agreement binds. Open the right student and link it by hand rather than creating another.
        </p>
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
