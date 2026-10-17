"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { SaveIcon, XIcon, AlertTriangleIcon } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Spinner } from "@/components/ui/spinner";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import {
  api,
  ApiError,
  type ConcurrencyPolicy,
  type HttpConfig,
  type Job,
  type JobInput,
  type JobType,
  type Meta,
  type ScriptConfig,
  type ShellConfig,
  type SQLConfig
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { CronBuilder } from "@/components/crondeck/cron-builder";
import { KeyValueEditor } from "@/components/crondeck/key-value-editor";
import { jobTypeMeta } from "@/components/crondeck/job-type";
import { HttpFlowEditor } from "@/components/crondeck/http-flow-editor";
import { SqlEditor } from "@/components/crondeck/sql-editor";
import { JobDependsPicker, isDependencyJob } from "@/components/crondeck/job-depends-picker";

const defaultConfigs: Record<JobType, JobInput["config"]> = {
  http: { url: "", method: "GET" },
  shell: { command: "" },
  script: { interpreter: "bash", source: "#!/usr/bin/env bash\nset -euo pipefail\n\necho \"Hello from CronDeck\"\n" },
  sql: { driver: "sqlite", dsn: "", query: "SELECT 1;", max_rows: 500 }
};

export function emptyJob(defaultTz = "UTC"): JobInput {
  return {
    name: "",
    description: "",
    type: "http",
    schedule: "*/5 * * * *",
    timezone: defaultTz,
    config: { ...defaultConfigs.http },
    enabled: true,
    timeout_sec: 300,
    max_retries: 0,
    retry_backoff_sec: 30,
    concurrency_policy: "forbid",
    tags: [],
    depends_on: [],
    color: ""
  };
}

export function jobToInput(j: Job): JobInput {
  return {
    name: j.name,
    description: j.description,
    type: j.type,
    schedule: j.schedule,
    timezone: j.timezone,
    config: j.config,
    enabled: j.enabled,
    timeout_sec: j.timeout_sec,
    max_retries: j.max_retries,
    retry_backoff_sec: j.retry_backoff_sec,
    concurrency_policy: j.concurrency_policy,
    tags: j.tags,
    depends_on: j.depends_on ?? [],
    color: j.color
  };
}

const policies: { value: ConcurrencyPolicy; title: string; desc: string }[] = [
  { value: "forbid", title: "Forbid", desc: "Skip if the previous run is still going" },
  { value: "allow", title: "Allow", desc: "Run in parallel with earlier runs" },
  { value: "replace", title: "Replace", desc: "Cancel the old run, start a new one" }
];

function FieldError({ msg }: { msg?: string }) {
  if (!msg) return null;
  return <p className="text-destructive text-xs">{msg}</p>;
}

export function JobForm({ initial, jobId }: { initial: JobInput; jobId?: string }) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const { data: meta } = useSWR<Meta>("/meta");
  const [form, setForm] = React.useState<JobInput>(initial);
  const [tagsText, setTagsText] = React.useState(initial.tags.join(", "));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  // remember per-type config so switching type back and forth doesn't lose input
  const configCache = React.useRef<Partial<Record<JobType, JobInput["config"]>>>({ [initial.type]: initial.config });

  const set = <K extends keyof JobInput>(k: K, v: JobInput[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => {
      const { [k as string]: _omit, ...rest } = e;
      return rest;
    });
  };
  const setCfg = (patch: Record<string, unknown>) => {
    setForm((f) => ({ ...f, config: { ...f.config, ...patch } as JobInput["config"] }));
    setErrors((e) => {
      const { config: _omit, ...rest } = e;
      return rest;
    });
  };
  const switchType = (t: JobType) => {
    if (t === form.type) return;
    configCache.current[form.type] = form.config;
    set("type", t);
    setForm((f) => ({ ...f, type: t, config: configCache.current[t] ?? { ...defaultConfigs[t] } }));
  };

  const shellBlocked = meta && !meta.allow_shell && (form.type === "shell" || form.type === "script");
  const sqlBlocked = meta && !meta.allow_sql && form.type === "sql";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrors({});
    const tags = tagsText
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    let config = form.config;
    if (form.type === "http") {
      const c = form.config as HttpConfig;
      if (c.steps?.length) {
        config = {
          follow_redirects: c.follow_redirects,
          steps: c.steps,
          url: c.steps[0]?.url,
          method: c.steps[0]?.method
        };
      } else {
        config = {
          url: c.url,
          method: c.method,
          headers: c.headers,
          body: c.body,
          body_content_type: c.body_content_type && c.body_content_type !== "auto" ? c.body_content_type : undefined,
          expected_status: c.expected_status?.length ? c.expected_status : undefined,
          follow_redirects: c.follow_redirects
        };
      }
    }
    const body = { ...form, tags, config };
    try {
      const saved = await api<Job>(jobId ? `/jobs/${jobId}` : "/jobs", {
        method: jobId ? "PUT" : "POST",
        body
      });
      toast.success(jobId ? "Job updated" : "Job created", { description: saved.name });
      mutate((k) => typeof k === "string" && (k.startsWith("/jobs") || k.startsWith("/stats")));
      router.push(`/jobs/view/?id=${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        setErrors(err.fields);
        toast.error("Please fix the highlighted fields");
      } else {
        toast.error((err as Error).message);
      }
      setSaving(false);
    }
  };

  const http = form.config as HttpConfig;
  const shell = form.config as ShellConfig;
  const script = form.config as ScriptConfig;
  const sql = form.config as SQLConfig;

  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-12 lg:gap-6">
      <div className="space-y-4 lg:col-span-8 lg:space-y-6">
        {/* Type */}
        <Card>
          <CardHeader>
            <CardTitle>What should run?</CardTitle>
            <CardDescription>Pick the kind of job. You can change it later.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {(Object.keys(jobTypeMeta) as JobType[]).map((t) => {
                const m = jobTypeMeta[t];
                const Icon = m.icon;
                const active = form.type === t;
                const disabled =
                  (meta && !meta.allow_shell && (t === "shell" || t === "script")) ||
                  (meta && !meta.allow_sql && t === "sql");
                return (
                  <button
                    key={t}
                    type="button"
                    disabled={!!disabled}
                    onClick={() => switchType(t)}
                    className={cn(
                      "lift group relative flex flex-col items-start gap-3 rounded-2xl border p-4 text-left transition-all",
                      active ? "border-primary/60 bg-primary/8 ring-primary/30 ring-2" : "bg-background/30 hover:bg-accent/40",
                      disabled && "pointer-events-none opacity-50"
                    )}>
                    <span className={cn("inline-flex size-10 items-center justify-center rounded-xl ring-1 ring-inset", m.tone)}>
                      <Icon className="size-5" />
                    </span>
                    <div>
                      <div className="font-medium">{m.label}</div>
                      <div className="text-muted-foreground text-xs">{m.description}</div>
                    </div>
                    {disabled && <Badge variant="secondary" className="absolute top-3 right-3">Disabled</Badge>}
                  </button>
                );
              })}
            </div>
            <FieldError msg={errors.type} />
          </CardContent>
        </Card>

        {/* Config */}
        <Card>
          <CardHeader>
            <CardTitle>{jobTypeMeta[form.type].label} configuration</CardTitle>
            <CardDescription>
              {form.type === "http"
                ? "Chain requests: pull values from the response, then reuse them as {{variables}} in later steps."
                : form.type === "shell"
                  ? "Executed with sh -c on the CronDeck host. Non-zero exit codes mark the run as failed."
                  : form.type === "sql"
                    ? "Connect to a database and run any SQL. Statements run in order; the last results are captured in the run log."
                    : "Written to a temp file and executed with the chosen interpreter."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {shellBlocked && (
              <div className="border-status-warning/40 bg-status-warning/10 text-status-warning flex items-center gap-2 rounded-lg border p-3 text-sm">
                <AlertTriangleIcon className="size-4" /> Shell and script jobs are disabled (ALLOW_SHELL=false).
              </div>
            )}
            {sqlBlocked && (
              <div className="border-status-warning/40 bg-status-warning/10 text-status-warning flex items-center gap-2 rounded-lg border p-3 text-sm">
                <AlertTriangleIcon className="size-4" /> SQL jobs are disabled (ALLOW_SQL=false).
              </div>
            )}
            {form.type === "http" && (
              <HttpFlowEditor
                value={http}
                mask={meta?.mask}
                onChange={(config) => set("config", config as JobInput["config"])}
              />
            )}

            {form.type === "shell" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="command">Command</Label>
                  <div className="overflow-hidden rounded-xl border bg-black/80 dark:bg-black/40">
                    <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
                      <span className="size-2.5 rounded-full bg-red-400/80" />
                      <span className="size-2.5 rounded-full bg-amber-400/80" />
                      <span className="size-2.5 rounded-full bg-emerald-400/80" />
                      <span className="ms-2 font-mono text-[11px] text-white/50">sh -c</span>
                    </div>
                    <Textarea
                      id="command"
                      value={shell.command ?? ""}
                      onChange={(e) => setCfg({ command: e.target.value })}
                      placeholder="pg_dump mydb > /backups/db.sql"
                      spellCheck={false}
                      aria-invalid={!!errors.config}
                      className="min-h-28 rounded-none border-0 bg-transparent! font-mono text-sm text-emerald-200 shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>
                <WorkdirEnv
                  key="shell"
                  workdir={shell.workdir}
                  env={shell.env}
                  mask={meta?.mask}
                  onWorkdir={(workdir) => setCfg({ workdir })}
                  onEnv={(env) => setCfg({ env })}
                />
              </>
            )}

            {form.type === "script" && (
              <>
                <div className="space-y-2">
                  <Label>Interpreter</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(meta?.interpreters ?? ["bash", "sh", "python3", "node"]).map((i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setCfg({ interpreter: i })}
                        className={cn(
                          "h-8 rounded-full border px-3 font-mono text-xs transition-colors",
                          script.interpreter === i ? "bg-primary text-primary-foreground border-transparent" : "hover:bg-accent bg-background/40"
                        )}>
                        {i}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="source">Source</Label>
                  <div className="overflow-hidden rounded-xl border bg-black/80 dark:bg-black/40">
                    <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
                      <span className="size-2.5 rounded-full bg-red-400/80" />
                      <span className="size-2.5 rounded-full bg-amber-400/80" />
                      <span className="size-2.5 rounded-full bg-emerald-400/80" />
                      <span className="ms-2 font-mono text-[11px] text-white/50">{script.interpreter}</span>
                    </div>
                    <Textarea
                      id="source"
                      value={script.source ?? ""}
                      onChange={(e) => setCfg({ source: e.target.value })}
                      spellCheck={false}
                      aria-invalid={!!errors.config}
                      onKeyDown={(e) => {
                        if (e.key === "Tab") {
                          e.preventDefault();
                          const el = e.currentTarget;
                          const { selectionStart: s, selectionEnd: en, value } = el;
                          const next = value.slice(0, s) + "  " + value.slice(en);
                          setCfg({ source: next });
                          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
                        }
                      }}
                      className="min-h-64 rounded-none border-0 bg-transparent! font-mono text-sm leading-relaxed text-sky-100 shadow-none focus-visible:ring-0"
                    />
                  </div>
                </div>
                <WorkdirEnv
                  key="script"
                  workdir={script.workdir}
                  env={script.env}
                  mask={meta?.mask}
                  onWorkdir={(workdir) => setCfg({ workdir })}
                  onEnv={(env) => setCfg({ env })}
                />
              </>
            )}

            {form.type === "sql" && (
              <SqlEditor
                value={sql}
                mask={meta?.mask}
                jobId={jobId}
                onChange={(config) => set("config", config as JobInput["config"])}
                error={errors.config}
              />
            )}
            <FieldError msg={errors.config} />
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHeader>
            <CardTitle>When should it run?</CardTitle>
            <CardDescription>Pick a preset or write any cron expression. We preview the next runs live.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <JobDependsPicker
              jobId={jobId}
              value={form.depends_on}
              schedule={form.schedule}
              onChange={(ids) => set("depends_on", ids)}
              onScheduleChange={(v) => set("schedule", v)}
              error={errors.depends_on}
            />
            {isDependencyJob(form.schedule, form.depends_on) ? (
              <p className="text-muted-foreground rounded-lg border border-dashed p-4 text-sm">
                This job is <strong>chain-triggered</strong> — it will not appear on the cron timeline until an upstream
                job succeeds. Schedule is set to <code className="font-mono">@dependency</code>.
              </p>
            ) : (
              <div className="border-t pt-6">
                <CronBuilder
                  value={form.schedule}
                  onChange={(v) => set("schedule", v)}
                  timezone={form.timezone}
                  onTimezoneChange={(tz) => set("timezone", tz)}
                  error={errors.schedule || errors.timezone}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Sidebar column */}
      <div className="space-y-4 lg:col-span-4 lg:space-y-6">
        <Card className="lg:sticky lg:top-[calc(var(--header-height)+1rem)]">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Nightly database backup"
                aria-invalid={!!errors.name}
                autoFocus={!jobId}
              />
              <FieldError msg={errors.name} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="What does this job do? Who owns it?"
                className="min-h-20"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tags">Tags</Label>
              <Input
                id="tags"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="backup, database"
                aria-invalid={!!errors.tags}
              />
              <FieldError msg={errors.tags} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <div className="text-sm font-medium">Enabled</div>
                <div className="text-muted-foreground text-xs">Paused jobs keep their history</div>
              </div>
              <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="timeout" className="text-xs">Timeout (s)</Label>
                <Input
                  id="timeout"
                  type="number"
                  min={1}
                  max={86400}
                  value={form.timeout_sec}
                  onChange={(e) => set("timeout_sec", Number(e.target.value))}
                  aria-invalid={!!errors.timeout_sec}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="retries" className="text-xs">Retries</Label>
                <Input
                  id="retries"
                  type="number"
                  min={0}
                  max={10}
                  value={form.max_retries}
                  onChange={(e) => set("max_retries", Number(e.target.value))}
                  aria-invalid={!!errors.max_retries}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="backoff" className="text-xs">Backoff (s)</Label>
                <Input
                  id="backoff"
                  type="number"
                  min={0}
                  max={3600}
                  value={form.retry_backoff_sec}
                  disabled={form.max_retries === 0}
                  onChange={(e) => set("retry_backoff_sec", Number(e.target.value))}
                  aria-invalid={!!errors.retry_backoff_sec}
                />
              </div>
            </div>
            <FieldError msg={errors.timeout_sec || errors.max_retries || errors.retry_backoff_sec} />

            <div className="space-y-2">
              <Label>If a run is still in progress</Label>
              <RadioGroup
                value={form.concurrency_policy}
                onValueChange={(v) => set("concurrency_policy", v as ConcurrencyPolicy)}
                className="gap-2">
                {policies.map((p) => (
                  <label
                    key={p.value}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      form.concurrency_policy === p.value ? "border-primary/50 bg-primary/6" : "hover:bg-accent/40"
                    )}>
                    <RadioGroupItem value={p.value} className="mt-0.5" />
                    <div>
                      <div className="text-sm font-medium">{p.title}</div>
                      <div className="text-muted-foreground text-xs">{p.desc}</div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </div>

            <div className="flex gap-2 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => router.back()}>
                <XIcon /> Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={saving || !!shellBlocked || !!sqlBlocked}>
                {saving ? <Spinner /> : <SaveIcon />} {jobId ? "Save" : "Create job"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </form>
  );
}

function WorkdirEnv({
  workdir,
  env,
  mask,
  onWorkdir,
  onEnv
}: {
  workdir?: string;
  env?: Record<string, string>;
  mask?: string;
  onWorkdir: (v: string) => void;
  onEnv: (v: Record<string, string>) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="space-y-2">
        <Label htmlFor="workdir">Working directory</Label>
        <Input
          id="workdir"
          value={workdir ?? ""}
          onChange={(e) => onWorkdir(e.target.value)}
          placeholder="(server default)"
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label>Environment variables</Label>
        <KeyValueEditor
          value={env}
          onChange={onEnv}
          keyPlaceholder="NAME"
          valuePlaceholder="value"
          mask={mask}
          addLabel="Add variable"
        />
      </div>
    </div>
  );
}
