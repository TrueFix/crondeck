"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PageHeader } from "@/components/crondeck/page-header";
import { RunsTable } from "@/components/crondeck/runs-table";
import { LogViewer } from "@/components/crondeck/log-viewer";
import { StatusOrb, statusMeta } from "@/components/crondeck/status";
import { qs, type Job, type Page, type Run, type RunStatus } from "@/lib/api";

const PER_PAGE = 30;
const ALL = "__all";
const STATUSES: RunStatus[] = ["success", "failed", "timeout", "queued", "running", "cancelled", "skipped"];
const RANGES = { "1h": 3600e3, "24h": 24 * 3600e3, "7d": 7 * 24 * 3600e3, "30d": 30 * 24 * 3600e3 } as const;

function RunsInner() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? ALL;
  const trigger = params.get("trigger") ?? ALL;
  const jobId = params.get("job") ?? ALL;
  const range = params.get("range") ?? "all";
  const from = params.get("from") ?? "";
  const updateFilters = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === ALL || value === "all") sp.delete(key); else sp.set(key, value);
    }
    sp.delete("page");
    router.replace(`/runs/?${sp}`, {scroll:false});
  };
  const setStatus = (v: string) => updateFilters({status:v});
  const setTrigger = (v: string) => updateFilters({trigger:v});
  const setJobId = (v: string) => updateFilters({job:v});
  const setRange = (r: keyof typeof RANGES | "all") => {
    updateFilters({range:r, from:r === "all" ? "" : new Date(Date.now() - RANGES[r]).toISOString()});
  };
  const page = Math.max(1, Number(params.get("page")) || 1);
  const setPage = (fn: (n: number) => number) => {
    const sp = new URLSearchParams(params.toString()); sp.set("page", String(fn(page)));
    router.replace(`/runs/?${sp}`, {scroll:false});
  };
  const openRun = params.get("run");


  const key =
    "/runs" +
    qs({
      status: status === ALL ? "" : status,
      trigger: trigger === ALL ? "" : trigger,
      job_id: jobId === ALL ? "" : jobId,
      from,
      page,
      per_page: PER_PAGE
    });
  const { data, isLoading } = useSWR<Page<Run>>(key);
  const { data: jobs } = useSWR<Page<Job>>("/jobs?per_page=500&sort=name");

  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtered = status !== ALL || trigger !== ALL || jobId !== ALL || range !== "all";

  const setRunParam = (id: string | null) => {
    const sp = new URLSearchParams(params.toString());
    if (id) sp.set("run", id);
    else sp.delete("run");
    router.replace(`/runs/${sp.toString() ? `?${sp}` : ""}`, { scroll: false });
  };

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader title="Run history" description={`${total.toLocaleString()} run${total === 1 ? "" : "s"}${filtered ? " match" : " recorded"}`} />

      <Card className="py-0">
        <CardContent className="p-0">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-(--card-spacing) py-3">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={status === ALL ? "" : status}
              onValueChange={(v) => setStatus(v || ALL)}
              className="flex-wrap">
              {STATUSES.map((s) => (
                <ToggleGroupItem key={s} value={s} className="gap-1.5 px-2.5 text-xs">
                  <StatusOrb status={s} pulse={false} className="size-1.5" />
                  {statusMeta[s].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger size="sm" className="w-48">
                <SelectValue placeholder="Job" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All jobs</SelectItem>
                {jobs?.items.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any trigger</SelectItem>
                <SelectItem value="schedule">Schedule</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
                <SelectItem value="retry">Retry</SelectItem>
                <SelectItem value="chain">Chain</SelectItem>
              </SelectContent>
            </Select>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={range}
              onValueChange={(v) => setRange((v || "all") as keyof typeof RANGES | "all")}>
              {(["1h", "24h", "7d", "30d", "all"] as const).map((r) => (
                <ToggleGroupItem key={r} value={r} className="px-2.5 text-xs">
                  {r === "all" ? "All time" : r}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {filtered && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  updateFilters({status:ALL, trigger:ALL, job:ALL, range:"all", from:""});
                }}>
                <XIcon /> Clear
              </Button>
            )}
          </div>

          <RunsTable
            runs={data?.items}
            loading={isLoading}
            onOpen={(r) => setRunParam(r.id)}
            empty={filtered ? "No runs match these filters." : "No runs yet. They’ll appear here as soon as a job fires."}
          />

          <div className="flex items-center justify-end gap-2 border-t px-(--card-spacing) py-3">
            <div className="text-muted-foreground flex-1 text-sm tabular-nums">
              {total === 0 ? "0" : `${(page - 1) * PER_PAGE + 1} – ${Math.min(page * PER_PAGE, total)}`} of{" "}
              {total.toLocaleString()}
            </div>
            <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              <ChevronLeft />
            </Button>
            <span className="text-muted-foreground px-2 text-xs tabular-nums">
              {page} / {pages}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
              <ChevronRight />
            </Button>
          </div>
        </CardContent>
      </Card>

      <LogViewer runId={openRun} onClose={() => setRunParam(null)} />
    </div>
  );
}

export default function RunsPage() {
  return (
    <React.Suspense>
      <RunsInner />
    </React.Suspense>
  );
}
