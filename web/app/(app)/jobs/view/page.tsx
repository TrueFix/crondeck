"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import {
  CalendarClockIcon,
  ChevronLeft,
  ChevronRight,
  CopyIcon,
  MoreHorizontal,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  TimerIcon,
  Trash2Icon,
  GaugeIcon,
  RotateCwIcon,
  LayersIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { JobTypeBadge, JobTypeIcon } from "@/components/crondeck/job-type";
import { StatusBadge, StatusOrb } from "@/components/crondeck/status";
import { RunsTable } from "@/components/crondeck/runs-table";
import { LogViewer } from "@/components/crondeck/log-viewer";
import { ConfirmDialog } from "@/components/crondeck/confirm-dialog";
import { NotFoundCard } from "@/components/crondeck/not-found-card";
import {
  api,
  type AuditEntry,
  type HttpConfig,
  type HttpStep,
  type JobDetail,
  type Page,
  type Run,
  type ScriptConfig,
  type ShellConfig,
  type SQLConfig
} from "@/lib/api";
import { dateTime, describeCron, duration, percent, relativeTime } from "@/lib/format";
import { describePath } from "@/lib/http-extract";
import { cn } from "@/lib/utils";
import { useUIPreferences } from "@/hooks/use-ui-preferences";
import { LoadError } from "@/components/crondeck/load-error";

const statusFill: Record<string, string> = {
  success: "var(--status-success)",
  failed: "var(--status-failed)",
  timeout: "var(--status-warning)",
  running: "var(--status-running)",
  queued: "var(--status-running)"
};

function Stat({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <Card className="lift gap-2 py-4">
      <CardContent className="space-y-1 px-4">
        <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <Icon className="size-3.5" /> {label}
        </div>
        <div className="font-display text-xl tabular-nums">{value}</div>
        {sub && <div className="text-muted-foreground truncate text-xs">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function JobViewInner() {
  useUIPreferences();
  const id = useSearchParams().get("id");
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const { data, error, mutate } = useSWR<JobDetail>(id ? `/jobs/${id}` : null, { keepPreviousData: false });
  const [tab, setTab] = React.useState("overview");
  const [runsPage, setRunsPage] = React.useState(1);
  const { data: runs, isLoading: runsLoading } = useSWR<Page<Run>>(
    id && tab === "runs" ? `/jobs/${id}/runs?page=${runsPage}&per_page=20` : null
  );
  const { data: activity } = useSWR<Page<AuditEntry>>(id && tab === "activity" ? `/audit?target=${id}&per_page=50` : null);
  const [openRun, setOpenRun] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState(false);
  React.useEffect(() => { setOpenRun(null); setRunsPage(1); setTab("overview"); }, [id]);

  if (!id || (error && (error as { status?: number }).status === 404)) return <NotFoundCard what="job" />;
  if (error && !data) return <LoadError onRetry={() => mutate()} />;
  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }

  const { job, next_runs, recent_runs } = data;
  const finished = recent_runs.filter((r) => ["success", "failed", "timeout"].includes(r.status));
  const okCount = finished.filter((r) => r.status === "success").length;
  const rate = finished.length ? (okCount / finished.length) * 100 : 0;
  const durations = finished.map((r) => r.duration_ms ?? 0);
  const avg = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : null;
  const st = job.running > 0 ? "running" : !job.enabled ? "disabled" : (job.last_status ?? "never");

  const refresh = () => {
    mutate();
    globalMutate((k) => typeof k === "string" && (k.startsWith("/jobs") || k.startsWith("/stats")));
  };
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const runNow = async () => {
    try {
      const run = await api<Run>(`/jobs/${job.id}/run`, { method: "POST" });
      toast.success("Run started", { action: { label: "View log", onClick: () => setOpenRun(run.id) } });
      setOpenRun(run.id);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const chartConfig = { duration: { label: "Duration", color: "var(--chart-1)" } } satisfies ChartConfig;

  return (
    <div className="space-y-4 lg:space-y-6">
      {/* Header */}
      <Card className="overflow-hidden">
        <CardContent className="flex flex-col gap-4 md:flex-row md:items-center">
          <JobTypeIcon type={job.type} className="size-14 rounded-2xl [&_svg]:size-6" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <StatusOrb status={st} />
              <h1 className="font-display truncate text-2xl tracking-tight">{job.name}</h1>
              <JobTypeBadge type={job.type} />
              {!job.enabled && <StatusBadge status="disabled" />}
            </div>
            {job.description && <p className="text-muted-foreground text-sm">{job.description}</p>}
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span className="flex items-center gap-1.5 font-mono">
                <CalendarClockIcon className="size-3.5" />
                {job.schedule}
              </span>
              <span>{describeCron(job.schedule)}</span>
              <span>{job.timezone}</span>
              {job.tags.map((t) => (
                <span key={t} className="bg-muted rounded px-1.5 py-px">
                  #{t}
                </span>
              ))}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button onClick={runNow}>
              <PlayIcon /> Run now
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                act(() => api(`/jobs/${job.id}/toggle`, { method: "POST" }), job.enabled ? "Job paused" : "Job enabled")
              }>
              {job.enabled ? (
                <>
                  <PauseIcon /> Pause
                </>
              ) : (
                <>
                  <PlayIcon /> Enable
                </>
              )}
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/jobs/edit/?id=${job.id}`}>
                <PencilIcon /> Edit
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={async () => {
                    try {
                      const copy = await api<{ id: string }>(`/jobs/${job.id}/duplicate`, { method: "POST" });
                      toast.success("Duplicated (paused)");
                      router.push(`/jobs/edit/?id=${copy.id}`);
                    } catch (e) {
                      toast.error((e as Error).message);
                    }
                  }}>
                  <CopyIcon /> Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                  <Trash2Icon /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={setTab} className="gap-4 lg:gap-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="config">Config</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 lg:space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
            <Stat
              icon={GaugeIcon}
              label="Success rate"
              value={finished.length ? percent(rate) : "—"}
              sub={`last ${finished.length} finished runs`}
            />
            <Stat icon={TimerIcon} label="Avg duration" value={duration(avg)} sub={`timeout ${duration(job.timeout_sec * 1000)}`} />
            <Stat
              icon={CalendarClockIcon}
              label="Next run"
              value={job.next_run_at ? relativeTime(job.next_run_at) : "—"}
              sub={job.next_run_at ? dateTime(job.next_run_at) : job.enabled ? "invalid schedule" : "paused"}
            />
            <Stat
              icon={RotateCwIcon}
              label="Last run"
              value={job.last_run_at ? relativeTime(job.last_run_at) : "Never"}
              sub={
                <span className="inline-flex items-center gap-1">
                  {job.max_retries ? `${job.max_retries} retries` : "no retries"} · {job.concurrency_policy}
                </span>
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle>Recent runs</CardTitle>
                <CardDescription>Duration of the last {recent_runs.length} runs, colored by outcome. Click a bar to open its log.</CardDescription>
              </CardHeader>
              <CardContent>
                {recent_runs.length === 0 ? (
                  <div className="text-muted-foreground flex h-[220px] flex-col items-center justify-center gap-3 text-sm">
                    No runs yet.
                    <Button size="sm" onClick={runNow}>
                      <PlayIcon /> Run it now
                    </Button>
                  </div>
                ) : (
                  <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full">
                    <BarChart data={recent_runs.map((r) => ({ ...r, d: r.duration_ms ?? 0 }))}>
                      <XAxis dataKey="id" hide />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={48}
                        tickFormatter={(v) => duration(v)}
                      />
                      <ChartTooltip
                        cursor={{ fill: "var(--muted)", opacity: 0.4 }}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const r = payload[0].payload as Run;
                          return (
                            <div className="bg-foreground text-background rounded-lg px-3 py-2 text-xs shadow-md">
                              <div className="font-medium capitalize">{r.status}</div>
                              <div>{dateTime(r.started_at ?? r.created_at)}</div>
                              <div>{duration(r.duration_ms)}</div>
                            </div>
                          );
                        }}
                      />
                      <Bar
                        isAnimationActive={false}
                        dataKey="d"
                        radius={4}
                        maxBarSize={22}
                        className="cursor-pointer"
                        onClick={(_data, index) => { const r = recent_runs[index]; if (r) setOpenRun(r.id); }}>
                        {recent_runs.map((r) => (
                          <Cell key={r.id} fill={statusFill[r.status] ?? "var(--muted-foreground)"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ChartContainer>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Upcoming</CardTitle>
                <CardDescription>Next activations in {job.timezone}</CardDescription>
              </CardHeader>
              <CardContent>
                {next_runs.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{job.enabled ? "No upcoming runs." : "Job is paused."}</p>
                ) : (
                  <ol className="relative space-y-4 border-s ps-5">
                    {next_runs.map((n, i) => (
                      <li key={n} className="relative">
                        <span
                          className={cn(
                            "absolute top-1 -start-[26.5px] size-3 rounded-full ring-4 ring-[color-mix(in_oklch,var(--card)_70%,transparent)]",
                            i === 0 ? "bg-primary" : "bg-muted-foreground/40"
                          )}
                        />
                        <div className="text-sm font-medium">{relativeTime(n)}</div>
                        <div className="text-muted-foreground font-mono text-xs">
                          {dateTime(n, { dateStyle: "medium", timeStyle: "medium", timeZone: job.timezone })}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="pb-0">
            <CardHeader>
              <CardTitle>Latest runs</CardTitle>
            </CardHeader>
            <CardContent className="px-0">
              <RunsTable
                runs={[...recent_runs].reverse().slice(0, 8)}
                showJob={false}
                onOpen={(r) => setOpenRun(r.id)}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card className="py-0">
            <CardContent className="p-0">
              <RunsTable runs={runs?.items} loading={runsLoading} showJob={false} onOpen={(r) => setOpenRun(r.id)} />
              {runs && runs.total > 20 && (
                <div className="flex items-center justify-end gap-2 border-t px-(--card-spacing) py-3">
                  <div className="text-muted-foreground flex-1 text-sm">{runs.total} runs</div>
                  <Button variant="outline" size="icon-sm" disabled={runsPage <= 1} onClick={() => setRunsPage((p) => p - 1)}>
                    <ChevronLeft />
                  </Button>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {runsPage} / {Math.ceil(runs.total / 20)}
                  </span>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    disabled={runsPage >= Math.ceil(runs.total / 20)}
                    onClick={() => setRunsPage((p) => p + 1)}>
                    <ChevronRight />
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config">
          <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
            <Card className="lg:col-span-8">
              <CardHeader>
                <CardTitle>What runs</CardTitle>
                <CardDescription>Secret-looking values are masked.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ConfigView job={data.job} />
              </CardContent>
            </Card>
            <Card className="lg:col-span-4">
              <CardHeader>
                <CardTitle>Execution policy</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="divide-y text-sm">
                  {[
                    ["Schedule", <span key="s" className="font-mono">{job.schedule}</span>],
                    ...(job.depends_on?.length
                      ? [
                          [
                            "Upstream jobs",
                            <span key="dep" className="flex flex-wrap justify-end gap-1">
                              {job.depends_on.map((id) => (
                                <Link key={id} href={`/jobs/view/?id=${id}`} className="text-primary text-xs underline-offset-2 hover:underline">
                                  {id.slice(0, 8)}…
                                </Link>
                              ))}
                            </span>
                          ] as const
                        ]
                      : []),
                    ["Timezone", job.timezone],
                    ["Timeout", duration(job.timeout_sec * 1000)],
                    ["Retries", job.max_retries ? `${job.max_retries} × (backoff ${job.retry_backoff_sec}s)` : "None"],
                    ["Concurrency", <span key="c" className="capitalize">{job.concurrency_policy}</span>],
                    ["Created", dateTime(job.created_at)],
                    ["Updated", dateTime(job.updated_at)],
                    ["ID", <span key="i" className="font-mono text-xs">{job.id}</span>]
                  ].map(([k, v]) => (
                    <div key={String(k)} className="flex items-center justify-between gap-4 py-2.5">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="truncate text-end">{v}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader>
              <CardTitle>Activity</CardTitle>
              <CardDescription>Changes and manual actions on this job</CardDescription>
            </CardHeader>
            <CardContent>
              {!activity ? (
                <Skeleton className="h-40 w-full" />
              ) : activity.items.length === 0 ? (
                <p className="text-muted-foreground text-sm">No activity recorded.</p>
              ) : (
                <ol className="relative space-y-5 border-s ps-5">
                  {activity.items.map((a) => (
                    <li key={a.id} className="relative">
                      <span className="bg-primary/70 absolute top-1.5 -start-[24.5px] size-2 rounded-full" />
                      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
                        <span className="font-mono text-xs font-medium">{a.action}</span>
                        <span className="text-muted-foreground text-xs">{relativeTime(a.created_at)}</span>
                      </div>
                      <div className="text-muted-foreground text-xs">
                        {dateTime(a.created_at)} · {a.ip || "system"}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <LogViewer runId={openRun} onClose={() => setOpenRun(null)} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete “${job.name}”?`}
        description="The job and its entire run history will be permanently removed."
        confirmLabel="Delete job"
        destructive
        onConfirm={async () => {
          try {
            await api(`/jobs/${job.id}`, { method: "DELETE" });
            toast.success("Job deleted");
            globalMutate((k) => typeof k === "string" && (k.startsWith("/jobs") || k.startsWith("/stats")));
            router.push("/jobs/");
          } catch (e) {
            toast.error((e as Error).message);
          }
        }}
      />
    </div>
  );
}

function Code({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <pre className={cn("log-view overflow-auto rounded-xl border bg-zinc-950/90 p-4 text-zinc-100", className)}>
      {children}
    </pre>
  );
}

function KV({ title, obj }: { title: string; obj?: Record<string, string> }) {
  if (!obj || Object.keys(obj).length === 0) return null;
  return (
    <div className="space-y-2">
      <div className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <LayersIcon className="size-3.5" /> {title}
      </div>
      <div className="divide-y rounded-lg border">
        {Object.entries(obj).map(([k, v]) => (
          <div key={k} className="flex gap-3 px-3 py-2 font-mono text-xs">
            <span className="text-primary shrink-0">{k}</span>
            <span className="text-muted-foreground truncate">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ConfigView({ job }: { job: JobDetail["job"] }) {
  if (job.type === "http") {
    const c = job.config as HttpConfig;
    const steps: HttpStep[] =
      c.steps?.length ? c.steps : [{ url: c.url ?? "", method: c.method, headers: c.headers, body: c.body, expected_status: c.expected_status, name: "Request" }];
    return (
      <>
        <div className="text-muted-foreground text-xs">
          {steps.length > 1 ? `${steps.length}-step flow` : "Single request"} · redirects{" "}
          {c.follow_redirects === false ? "not followed" : "followed"}
        </div>
        <div className="space-y-4">
          {steps.map((step, i) => (
            <div key={i} className="space-y-2 rounded-xl border p-3">
              {steps.length > 1 && (
                <div className="text-muted-foreground text-[10px] font-semibold tracking-wide uppercase">
                  {step.name?.trim() || `Step ${i + 1}`}
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="bg-primary/12 text-primary rounded-md px-2 py-0.5 font-mono text-xs font-bold">{step.method ?? "GET"}</span>
                <span className="truncate font-mono text-sm">{step.url}</span>
              </div>
              <KV title="Headers" obj={step.headers} />
              {step.body && (
                <div className="space-y-1">
                  {step.body_content_type && step.body_content_type !== "auto" && (
                    <div className="text-muted-foreground text-xs">
                      Body as: <span className="font-mono">{step.body_content_type}</span>
                    </div>
                  )}
                  <Code>{step.body}</Code>
                </div>
              )}
              <div className="text-muted-foreground text-xs">
                Expects {step.expected_status?.length ? step.expected_status.join(", ") : "any 2xx"}
                {step.extract && Object.keys(step.extract).length > 0 && (
                  <> · extracts {Object.entries(step.extract).map(([k, p]) => `${k} ← ${describePath(p)}`).join(", ")}</>
                )}
              </div>
            </div>
          ))}
        </div>
      </>
    );
  }
  if (job.type === "shell") {
    const c = job.config as ShellConfig;
    return (
      <>
        <Code className="text-emerald-200">$ {c.command}</Code>
        {c.workdir && <div className="text-muted-foreground text-xs">Working directory: <span className="font-mono">{c.workdir}</span></div>}
        <KV title="Environment" obj={c.env} />
      </>
    );
  }
  if (job.type === "sql") {
    const c = job.config as SQLConfig;
    return (
      <>
        <div className="text-muted-foreground text-xs">
          {c.driver === "postgres" ? "PostgreSQL" : "SQLite"}
          {c.max_rows ? <> · captures up to {c.max_rows} rows</> : null}
        </div>
        <Code className="max-h-[480px] text-emerald-100">{c.query}</Code>
      </>
    );
  }
  const c = job.config as ScriptConfig;
  return (
    <>
      <div className="text-muted-foreground text-xs">
        Interpreter: <span className="text-foreground font-mono">{c.interpreter}</span>
        {c.workdir && (
          <>
            {" "}· workdir <span className="font-mono">{c.workdir}</span>
          </>
        )}
      </div>
      <Code className="max-h-[480px] text-sky-100">{c.source}</Code>
      <KV title="Environment" obj={c.env} />
    </>
  );
}

export default function JobViewPage() {
  return (
    <React.Suspense>
      <JobViewInner />
    </React.Suspense>
  );
}
