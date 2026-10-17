"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { BellIcon, SendIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { api, type NotificationSettings } from "@/lib/api";

const MASK = "••••••••";

export function NotificationSettingsCard() {
  const { data, mutate, isLoading } = useSWR<NotificationSettings>("/settings/notifications");
  const [draft, setDraft] = React.useState<NotificationSettings | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await api<NotificationSettings>("/settings/notifications", {
        method: "PUT",
        body: draft
      });
      setDraft(saved);
      mutate(saved, false);
      toast.success("Notification settings saved");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      await api("/settings/notifications/test", { method: "POST" });
      toast.success("Test alert sent", { description: "Check webhooks and email if configured." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTesting(false);
    }
  };

  const setURL = (key: keyof Pick<NotificationSettings, "webhook_url" | "slack_webhook_url" | "discord_webhook_url">, value: string) => {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BellIcon className="size-4 opacity-70" aria-hidden />
          Failure notifications
        </CardTitle>
        <CardDescription>
          Alert when a job fails after all retries. Generic webhooks receive JSON; Slack and Discord use their incoming-webhook formats.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading || !draft ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Spinner className="size-4" /> Loading…
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="notify-enabled">Enabled</Label>
              <Switch
                id="notify-enabled"
                checked={draft.enabled}
                onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dedupe">Dedupe window (minutes)</Label>
              <Input
                id="dedupe"
                type="number"
                min={0}
                max={1440}
                value={draft.dedupe_minutes ?? 15}
                onChange={(e) => setDraft({ ...draft, dedupe_minutes: Number(e.target.value) })}
              />
              <p className="text-muted-foreground text-[11px]">Suppress repeat alerts for the same job within this window.</p>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <Label htmlFor="email-enabled">Email (SMTP)</Label>
              <Switch
                id="email-enabled"
                checked={draft.email_enabled}
                onCheckedChange={(email_enabled) => setDraft({ ...draft, email_enabled })}
              />
            </div>
            {draft.email_enabled && (
              <div className="space-y-3 rounded-lg border border-dashed p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-host">SMTP host</Label>
                    <Input id="smtp-host" value={draft.smtp_host ?? ""} onChange={(e) => setDraft({ ...draft, smtp_host: e.target.value })} placeholder="smtp.example.com" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-port">Port</Label>
                    <Input id="smtp-port" type="number" value={draft.smtp_port || 587} onChange={(e) => setDraft({ ...draft, smtp_port: Number(e.target.value) })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email-to">To (comma-separated)</Label>
                  <Input
                    id="email-to"
                    value={(draft.email_to ?? []).join(", ")}
                    onChange={(e) => setDraft({ ...draft, email_to: e.target.value.split(/[,;]/).map((s) => s.trim()).filter(Boolean) })}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="smtp-user">Username</Label>
                    <Input id="smtp-user" value={draft.smtp_username ?? ""} onChange={(e) => setDraft({ ...draft, smtp_username: e.target.value })} autoComplete="off" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="smtp-pass">Password</Label>
                    <Input
                      id="smtp-pass"
                      type="password"
                      value={draft.smtp_password === MASK ? "" : draft.smtp_password ?? ""}
                      onChange={(e) => setDraft({ ...draft, smtp_password: e.target.value })}
                      placeholder={draft.smtp_password === MASK ? "Saved — enter to replace" : ""}
                    />
                  </div>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="webhook-url">Generic webhook URL</Label>
              <Input
                id="webhook-url"
                type="url"
                autoComplete="off"
                placeholder="https://example.com/hooks/crondeck"
                value={draft.webhook_url === MASK || draft.webhook_url.endsWith("/…") ? "" : draft.webhook_url}
                onChange={(e) => setURL("webhook_url", e.target.value)}
                onFocus={() => {
                  if (draft.webhook_url.endsWith("/…") || draft.webhook_url === MASK) setURL("webhook_url", "");
                }}
              />
              {(draft.webhook_url.endsWith("/…") || draft.webhook_url === MASK) && (
                <p className="text-muted-foreground text-[11px]">A URL is saved — enter a new one to replace it.</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="slack-url">Slack incoming webhook</Label>
              <Input
                id="slack-url"
                type="url"
                autoComplete="off"
                placeholder="https://hooks.slack.com/services/…"
                value={draft.slack_webhook_url === MASK || draft.slack_webhook_url.endsWith("/…") ? "" : draft.slack_webhook_url}
                onChange={(e) => setURL("slack_webhook_url", e.target.value)}
                onFocus={() => {
                  if (draft.slack_webhook_url.endsWith("/…") || draft.slack_webhook_url === MASK)
                    setURL("slack_webhook_url", "");
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discord-url">Discord webhook</Label>
              <Input
                id="discord-url"
                type="url"
                autoComplete="off"
                placeholder="https://discord.com/api/webhooks/…"
                value={
                  draft.discord_webhook_url === MASK || draft.discord_webhook_url.endsWith("/…")
                    ? ""
                    : draft.discord_webhook_url
                }
                onChange={(e) => setURL("discord_webhook_url", e.target.value)}
                onFocus={() => {
                  if (draft.discord_webhook_url.endsWith("/…") || draft.discord_webhook_url === MASK)
                    setURL("discord_webhook_url", "");
                }}
              />
            </div>
          </>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap gap-2">
        <Button type="button" disabled={!draft || saving} onClick={save}>
          {saving ? <Spinner className="size-4" /> : "Save"}
        </Button>
        <Button type="button" variant="outline" disabled={!draft || testing} onClick={sendTest}>
          {testing ? <Spinner className="size-4" /> : <SendIcon className="size-4" aria-hidden />}
          Send test
        </Button>
      </CardFooter>
    </Card>
  );
}
