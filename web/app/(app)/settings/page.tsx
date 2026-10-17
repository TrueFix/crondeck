"use client";

import * as React from "react";
import useSWR, { useSWRConfig } from "swr";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  DownloadIcon,
  UploadIcon,
  ServerIcon,
  ShieldIcon,
  PaletteIcon,
  DatabaseIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  SunIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/crondeck/page-header";
import { ConfirmDialog } from "@/components/crondeck/confirm-dialog";
import { APITokenSettings } from "@/components/crondeck/api-token-settings";
import { UserSettings } from "@/components/crondeck/user-settings";
import { NotificationSettingsCard } from "@/components/crondeck/notification-settings";
import { PerformancePreference } from "@/components/crondeck/performance-preference";
import { UIPreferenceSettings } from "@/components/crondeck/ui-preferences";
import { api, redirectToLogin, type Settings } from "@/lib/api";
import { dateTime, formatBytes, uptime } from "@/lib/format";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-muted-foreground font-mono text-[11px]">{hint}</div>}
      </div>
      <div className="min-w-0 text-end text-sm font-medium [overflow-wrap:anywhere]">{value}</div>
    </div>
  );
}

export default function SettingsPage() {
  useUIPreferences();
  const { data } = useSWR<Settings>("/settings");
  const { mutate } = useSWRConfig();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [confirmLogoutAll, setConfirmLogoutAll] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const backupRef = React.useRef<HTMLInputElement>(null);
  const [restoreFile, setRestoreFile] = React.useState<File | null>(null);
  React.useEffect(() => setMounted(true), []);

  const doExport = async () => {
    try {
      const body = await api<unknown>("/export");
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `crondeck-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      toast.success("Export downloaded", { description: "It contains secrets in plain text. Store it safely." });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const doImport = async (file: File) => {
    setImporting(true);
    try {
      const json = JSON.parse(await file.text());
      const res = await api<{ created: number; errors: string[] }>("/import", { method: "POST", body: json });
      if (res.errors.length) {
        toast.warning(`Imported ${res.created} jobs, ${res.errors.length} failed`, {
          description: res.errors.slice(0, 3).join("\n")
        });
      } else {
        toast.success(`Imported ${res.created} jobs`, { description: "Imported jobs keep their enabled state." });
      }
      mutate((k) => typeof k === "string" && (k.startsWith("/jobs") || k.startsWith("/stats")));
    } catch (e) {
      toast.error(e instanceof SyntaxError ? "That file isn’t valid JSON" : (e as Error).message);
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const restore = async () => {
    if (!restoreFile) return;
    try {
      const response = await fetch("/api/backup/restore", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "crondeck" },
        body: restoreFile
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Restore failed");
      redirectToLogin(false);
    } catch (error) {
      toast.error((error as Error).message);
      setRestoreFile(null);
    }
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader title="Settings" description="Server configuration, data portability and appearance." />
      <UIPreferenceSettings />
      <UserSettings />
      <APITokenSettings />
      <NotificationSettingsCard />

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ServerIcon className="size-4" /> Server
            </CardTitle>
            <CardDescription>Read-only. Change these with environment variables and restart.</CardDescription>
          </CardHeader>
          <CardContent>
            {!data ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <div className="divide-y">
                <Row label="Version" value={<Badge variant="secondary">v{data.version}</Badge>} />
                <Row label="Environment" value={<span className="capitalize">{data.environment}</span>} hint="APP_ENV" />
                <Row label="Uptime" value={uptime(data.uptime_sec)} />
                <Row label="Max concurrent runs" value={data.max_concurrent_runs} hint="MAX_CONCURRENT_RUNS" />
                <Row label="Run retention" value={`${data.run_retention_days} days`} hint="RUN_RETENTION_DAYS" />
                <Row label="Output capture limit" value={formatBytes(data.max_output_bytes)} hint="MAX_OUTPUT_BYTES" />
                <Row label="Default timezone" value={data.default_timezone} hint="TZ_DEFAULT" />
                <Row
                  label="Shell & script jobs"
                  value={
                    data.allow_shell ? (
                      <span className="text-status-success">Enabled</span>
                    ) : (
                      <span className="text-muted-foreground">Disabled</span>
                    )
                  }
                  hint="ALLOW_SHELL"
                />
                <Row label="Active runs" value={data.active_runs} />
                <Row label="Live dashboard connections" value={data.sse_clients} />
              </div>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4 lg:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldIcon className="size-4" /> Security
              </CardTitle>
              <CardDescription>Sessions are created by logging in with the ADMIN_KEY.</CardDescription>
            </CardHeader>
            <CardContent>
              {!data ? (
                <Skeleton className="h-28 w-full" />
              ) : (
                <div className="divide-y">
                  <Row label="Active sessions" value={data.active_sessions} />
                  <Row label="Session lifetime" value={`${data.session_ttl_hours} hours`} hint="SESSION_TTL_HOURS" />
                  {data.current_session && (
                    <>
                      <Row label="This session expires" value={dateTime(data.current_session.expires_at)} />
                      <Row label="Signed in from" value={<span className="font-mono text-xs">{data.current_session.ip}</span>} />
                    </>
                  )}
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button variant="destructive" onClick={() => setConfirmLogoutAll(true)}>
                <LogOutIcon /> Sign out everywhere
              </Button>
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DatabaseIcon className="size-4" /> Backup & restore
              </CardTitle>
              <CardDescription>
                A complete SQLite snapshot: jobs, credentials, run history, logs, audit history, and stored settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-muted-foreground text-xs [overflow-wrap:anywhere]">
              Database file: <span className="text-foreground font-mono">{data?.db_path ?? "…"}</span>
            </CardContent>
            <CardFooter className="flex-wrap gap-2">
              <Button asChild>
                <a href="/api/backup"><DownloadIcon /> Full backup</a>
              </Button>
              <Button variant="outline" onClick={() => backupRef.current?.click()}>
                <UploadIcon /> Restore backup
              </Button>
              <input ref={backupRef} type="file" accept=".db,.sqlite,.sqlite3" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && file.size > 256 * 1024 * 1024) toast.error("Backup exceeds the 256 MiB upload limit");
                else if (file) setRestoreFile(file);
                e.target.value = "";
              }} />
              <p className="text-muted-foreground w-full text-xs leading-relaxed">
                Restore replaces existing data. Pause jobs and wait for active runs/retries first. Sessions are
                revoked. Server environment (.env) and external script files are not included.
              </p>
            </CardFooter>
            <CardFooter className="flex-wrap gap-2 border-t pt-4">
              <p className="text-muted-foreground w-full text-xs">Portable jobs only (JSON, adds new jobs without replacing history)</p>
              <Button variant="outline" onClick={doExport}>
                <DownloadIcon /> Export jobs
              </Button>
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? <Spinner /> : <UploadIcon />} Import jobs
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0])}
              />
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PaletteIcon className="size-4" /> Appearance
              </CardTitle>
              <CardDescription>Stored in this browser only.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <div className="w-full"><PerformancePreference /></div>
              {mounted && (
                <ToggleGroup type="single" variant="outline" value={theme} onValueChange={(v) => v && setTheme(v)}>
                  <ToggleGroupItem value="light" className="gap-1.5 px-3">
                    <SunIcon /> Light
                  </ToggleGroupItem>
                  <ToggleGroupItem value="dark" className="gap-1.5 px-3">
                    <MoonIcon /> Dark
                  </ToggleGroupItem>
                  <ToggleGroupItem value="system" className="gap-1.5 px-3">
                    <MonitorIcon /> System
                  </ToggleGroupItem>
                </ToggleGroup>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={!!restoreFile}
        onOpenChange={(open) => !open && setRestoreFile(null)}
        title="Restore full backup?"
        description={`Replace this instance’s jobs, runs, logs, audit history and stored settings with “${restoreFile?.name}”? You will need to sign in again. The current ADMIN_KEY is retained.`}
        confirmLabel="Replace and restore"
        destructive
        onConfirm={restore}
      />
      <ConfirmDialog
        open={confirmLogoutAll}
        onOpenChange={setConfirmLogoutAll}
        title="Sign out everywhere?"
        description="All sessions, including this one, will be revoked. You’ll need the admin key to log in again."
        confirmLabel="Sign out all"
        destructive
        onConfirm={async () => {
          await api("/auth/logout-all", { method: "POST" });
          window.location.replace("/login/");
        }}
      />
    </div>
  );
}
