"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserCheck } from "lucide-react";
import { Btn } from "@/components/ui/controls";
import { askConfirm, toast } from "@/components/ui/feedback";
import { safeAction } from "@/lib/action-guard";
import { convertLeadToStudent } from "@/server/students-actions";

/**
 * THE ONE STEP THE WIZARD DOES ITSELF.
 *
 * Every other step on the journey has a screen that already does it well, and the wizard links
 * there. This one did not: turning a signed client into a Student meant finding them in Contacts
 * and using "Convert to student", a control nothing on the agreement or the journey mentioned.
 * It is the exact seam a signed client used to fall through - "after signing, account creation is
 * not working" was this, and nothing else.
 *
 * `convertLeadToStudent` is reused rather than reimplemented. It is already idempotent (it
 * returns the existing student if there is one), carries name, email, phone, industry and source
 * across, allocates the next code in the series, and stamps `Student.leadId` so the two records
 * stay joined. It creates NO enrolment, deliberately - the programme level is not known at
 * convert time - which is why the journey still shows a gap afterwards and sends you to set it.
 */
export function MakeStudentButton({ leadId, name }: { leadId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    const ok = await askConfirm({
      title: `Create a student record for ${name}?`,
      body: "They get the next free student number, and their contact details carry across. You will still need to set the programme level afterwards - the next step will say so.",
      confirmLabel: "Create the record",
    });
    if (!ok) return;

    setBusy(true);
    const res = await safeAction(() => convertLeadToStudent(leadId));
    setBusy(false);
    if (!res.ok) return toast(res.error, "error");
    toast(`${name} is now a student`);
    // Same wizard, now with the student half of the person resolved - so the next step it names
    // is the programme level rather than this.
    if (res.studentId) router.push(`/onboarding/new?lead=${leadId}&student=${res.studentId}`);
    else router.refresh();
  }

  return (
    <Btn variant="primary" icon={<UserCheck size={15} />} busy={busy} onClick={run}>
      Create the student record
    </Btn>
  );
}
