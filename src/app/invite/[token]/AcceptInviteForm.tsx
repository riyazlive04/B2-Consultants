"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { acceptInvite } from "@/server/invite-actions";
import { Field, FormError, SubmitButton, TextInput } from "@/components/ui/form";

export function AcceptInviteForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (form) => {
        setError(null);
        const res = await acceptInvite(form);
        if (!res.ok) return setError(res.error);
        // acceptInvite signed us in, so go straight to the dashboard.
        router.push("/");
        router.refresh();
      }}
      className="space-y-4"
    >
      <input type="hidden" name="token" value={token} />
      <Field label="Choose a password" hint="At least 8 characters">
        <TextInput type="password" name="password" required minLength={8} autoComplete="new-password" autoFocus />
      </Field>
      <Field label="Confirm password">
        <TextInput type="password" name="confirm" required minLength={8} autoComplete="new-password" />
      </Field>
      <SubmitButton>Set password & sign in</SubmitButton>
      <FormError message={error} />
    </form>
  );
}
