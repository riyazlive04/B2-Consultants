"use client";

import { useState } from "react";
import { Mail, MessageSquare } from "lucide-react";
import { Card, Pill } from "@/components/ui/kit";
import { Field, TextInput, SubmitButton } from "@/components/ui/form";
import { Switch } from "@/components/ui/controls";
import { toast } from "@/components/ui/feedback";
import { saveEmailSettings, saveSmsSettings } from "@/server/messaging-actions";

type Settings = {
  email: { enabled: boolean; configured: boolean; envEnabled: boolean; paused: boolean; fromEmail: string; fromName: string };
  sms: { enabled: boolean; configured: boolean; envEnabled: boolean; paused: boolean; fromNumber: string };
};

function StatusChips({ s }: { s: { enabled: boolean; configured: boolean; envEnabled: boolean } }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      <Pill tone={s.enabled ? "good" : "neutral"}>{s.enabled ? "Live" : "Off"}</Pill>
      <Pill tone={s.configured ? "good" : "warn"}>{s.configured ? "Keys set" : "Keys missing"}</Pill>
      <Pill tone={s.envEnabled ? "good" : "neutral"}>ENV {s.envEnabled ? "on" : "off"}</Pill>
    </div>
  );
}

export default function ChannelSettings({ settings }: { settings: Settings }) {
  const [emailPaused, setEmailPaused] = useState(settings.email.paused);
  const [smsPaused, setSmsPaused] = useState(settings.sms.paused);

  async function saveEmail(fd: FormData) {
    if (emailPaused) fd.set("paused", "on");
    const res = await saveEmailSettings(fd);
    toast(res.ok ? "Email settings saved" : res.error, res.ok ? "success" : "error");
  }
  async function saveSms(fd: FormData) {
    if (smsPaused) fd.set("paused", "on");
    const res = await saveSmsSettings(fd);
    toast(res.ok ? "SMS settings saved" : res.error, res.ok ? "success" : "error");
  }

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      <Card title={<span className="flex items-center gap-2"><Mail size={16} className="text-primary" /> Email (Resend)</span>} subtitle="Set RESEND_API_KEY + EMAIL_ENABLED=true in .env to send for real">
        <div className="space-y-4">
          <StatusChips s={settings.email} />
          <form action={saveEmail} className="space-y-3">
            <Field label="From name"><TextInput name="fromName" defaultValue={settings.email.fromName} /></Field>
            <Field label="From email" hint="Must be on a Resend-verified domain"><TextInput name="fromEmail" kind="email" defaultValue={settings.email.fromEmail} placeholder="hello@b2consultants.com" /></Field>
            <label className="flex items-center justify-between text-sm font-medium text-ink">Pause sending<Switch checked={emailPaused} onChange={setEmailPaused} /></label>
            <div className="flex justify-end"><SubmitButton>Save email</SubmitButton></div>
          </form>
        </div>
      </Card>

      <Card title={<span className="flex items-center gap-2"><MessageSquare size={16} className="text-primary" /> SMS (Twilio)</span>} subtitle="Set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + SMS_ENABLED=true in .env">
        <div className="space-y-4">
          <StatusChips s={settings.sms} />
          <form action={saveSms} className="space-y-3">
            <Field label="From number" hint="Your Twilio sender, E.164 format"><TextInput name="fromNumber" kind="phone" defaultValue={settings.sms.fromNumber} placeholder="+1..." /></Field>
            <label className="flex items-center justify-between text-sm font-medium text-ink">Pause sending<Switch checked={smsPaused} onChange={setSmsPaused} /></label>
            <div className="flex justify-end"><SubmitButton>Save SMS</SubmitButton></div>
          </form>
        </div>
      </Card>
    </div>
  );
}
