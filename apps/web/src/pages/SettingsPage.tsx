import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  EMAIL_SENDER_STREAMS,
  fetchEmailSettings,
  updateEmailSettings,
  type EmailSenderStream,
  type EmailSettings,
} from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";
import { SettingsTabs } from "../components/SettingsTabs";

/** Labels + purpose for each sender stream (design handoff: 7 streams). */
const STREAM_META: Record<EmailSenderStream, { label: string; used: string }> = {
  invites: { label: "Invitations", used: "Staff & client invites" },
  hello: { label: "Welcome (clients)", used: "Client welcome email" },
  team: { label: "Welcome (staff)", used: "Staff welcome email" },
  noReply: { label: "Security (no-reply)", used: "Verification, password, role changes" },
  notifications: { label: "Notifications", used: "Documents, reminders, appointments, filings" },
  esign: { label: "E-signature", used: "Signature requests" },
  billing: { label: "Billing", used: "Invoices & receipts (also the billing footer address)" },
};

export default function SettingsPage() {
  const settings = useQuery({ queryKey: ["email-settings"], queryFn: () => fetchEmailSettings() });

  return (
    <div className="max-w-[760px] animate-fade-rise">
      <SettingsTabs />
      <PageHeader
        title="Email & Senders"
        eyebrow="SETTINGS"
        description="Transactional email identity — footer support address, sender addresses per stream, and brand options."
      />
      {settings.isPending && (
        <div className="space-y-4">
          <Skeleton className="h-48 w-full rounded-card" />
          <Skeleton className="h-64 w-full rounded-card" />
        </div>
      )}
      {settings.isError && (
        <Card>
          <ErrorState
            message="Could not load email settings."
            onRetry={() => void settings.refetch()}
          />
        </Card>
      )}
      {settings.data && <EmailSettingsForm initial={settings.data} />}
    </div>
  );
}

function EmailSettingsForm({ initial }: { initial: EmailSettings }) {
  const qc = useQueryClient();
  const [supportEmail, setSupportEmail] = useState(initial.supportEmail);
  const [fromName, setFromName] = useState(initial.fromName);
  const [buttonAccent, setButtonAccent] = useState<"navy" | "gold">(initial.buttonAccent);
  const [showBrandLockup, setShowBrandLockup] = useState(initial.showBrandLockup);
  const [senders, setSenders] = useState(initial.senders);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSupportEmail(initial.supportEmail);
    setFromName(initial.fromName);
    setButtonAccent(initial.buttonAccent);
    setShowBrandLockup(initial.showBrandLockup);
    setSenders(initial.senders);
  }, [initial]);

  const save = useMutation({
    mutationFn: () =>
      updateEmailSettings({ supportEmail, fromName, buttonAccent, showBrandLockup, senders }),
    onSuccess: (next) => {
      setError(null);
      setSaved(true);
      qc.setQueryData(["email-settings"], next);
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not save the settings."),
  });

  useEffect(() => {
    if (!saved) return;
    const t = window.setTimeout(() => setSaved(false), 2500);
    return () => window.clearTimeout(t);
  }, [saved]);

  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Email identity</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="block">
            <span className="text-[13px] font-semibold text-content">Support email</span>
            <p className="mt-0.5 text-[12px] text-content-muted">
              Shown in the footer of every non-billing email.
            </p>
            <input
              type="email"
              required
              value={supportEmail}
              onChange={(e) => setSupportEmail(e.target.value)}
              className="input mt-1.5 font-mono"
              placeholder="support@mcrctas.com"
            />
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-content">Sender display name</span>
            <input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              className="input mt-1.5"
              placeholder="MCRC Tax & Accounting"
            />
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-[13px] font-semibold text-content">Button accent</span>
              <select
                value={buttonAccent}
                onChange={(e) => setButtonAccent(e.target.value as "navy" | "gold")}
                className="input mt-1.5"
              >
                <option value="navy">Navy</option>
                <option value="gold">Gold</option>
              </select>
            </label>
            <label className="mt-6 flex items-center gap-2.5 text-[13.5px] text-content">
              <input
                type="checkbox"
                checked={showBrandLockup}
                onChange={(e) => setShowBrandLockup(e.target.checked)}
              />
              Show the MCRC brand lockup at the top of emails
            </label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sender addresses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[12.5px] text-content-secondary">
            Each email stream can send from its own address (it must be verified with your
            email provider). Leave blank to use the server default
            {initial.fallbackFromEmail ? (
              <>
                {" "}
                (<span className="font-mono">{initial.fallbackFromEmail}</span>)
              </>
            ) : null}
            .
          </p>
          {EMAIL_SENDER_STREAMS.map((stream) => (
            <label key={stream} className="grid items-center gap-2 md:grid-cols-[220px_1fr]">
              <span>
                <span className="block text-[13px] font-semibold text-content">
                  {STREAM_META[stream].label}
                </span>
                <span className="block text-[11.5px] text-content-muted">
                  {STREAM_META[stream].used}
                </span>
              </span>
              <input
                type="email"
                value={senders[stream]}
                onChange={(e) => setSenders((prev) => ({ ...prev, [stream]: e.target.value }))}
                className="input font-mono"
                placeholder={initial.fallbackFromEmail || "no-reply@mcrctas.com"}
              />
            </label>
          ))}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
          {error}
        </div>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save settings"}
        </Button>
        {saved && !save.isPending && (
          <span className="text-[12.5px] font-semibold text-success">Saved</span>
        )}
      </div>
    </form>
  );
}
