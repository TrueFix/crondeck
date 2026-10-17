"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { toast } from "sonner";
import { CopyIcon, DownloadIcon, SquareIcon, ChevronsDownIcon, ExternalLinkIcon } from "lucide-react";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Run } from "@/lib/api";
import { dateTime, duration } from "@/lib/format";
import { StatusBadge } from "@/components/crondeck/status";
import { useRunEvents } from "@/components/crondeck/event-stream";
import { cn } from "@/lib/utils";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-background/40 rounded-lg border px-3 py-2">
      <div className="text-muted-foreground text-[11px] tracking-wide uppercase">{label}</div>
      <div className="truncate font-mono text-[13px]">{children}</div>
    </div>
  );
}

/** Slide-over with run metadata and the (live-streaming) output log. */
export function LogViewer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const preferences = useUIPreferences();
  const { data: run, error, mutate } = useSWR<Run>(runId ? `/runs/${runId}` : null, {
    keepPreviousData: false,
    refreshInterval: (data) => data?.status === "running" || data?.status === "queued" ? 500 : 0,
    dedupingInterval: 250
  });
  const subscribeRuns = useRunEvents();
  const [follow, setFollow] = React.useState(preferences.logFollow);
  const [view, setView] = React.useState("output");
  const scroller = React.useRef<HTMLPreElement>(null);

  const active = run?.status === "running" || run?.status === "queued";

  // Fetch authoritative bounded snapshots, so opening mid-run/reconnecting never loses or duplicates output.
  React.useEffect(() => {
    setFollow(preferences.logFollow);
    setView("output");
  }, [runId, preferences.logFollow]);

  React.useEffect(() => {
    if (!runId) return;
    return subscribeRuns((type, r) => {
      if (r.id === runId && type === "run.finished") mutate();
    });
  }, [runId, subscribeRuns, mutate]);

  const output = run?.output || "";
  const bodyStart = output.indexOf("\n\n");
  const text = view === "response" ? (bodyStart < 0 ? "" : output.slice(bodyStart + 2)) : output;

  React.useEffect(() => {
    if (follow && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [text, follow]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Output copied");
    } catch { toast.error("Clipboard unavailable. Use Download output to save the log."); }
  };
  const download = () => {
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${run?.job_name ?? "run"}-${runId}.log`.replace(/[^\w.-]+/g, "_");
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const cancel = async () => {
    try {
      await api(`/runs/${runId}/cancel`, { method: "POST" });
      toast.success("Cancellation requested");
      mutate();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Sheet open={!!runId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle className="flex items-center gap-3">
            <span className="truncate">{run?.job_name ?? "Run"}</span>
            {run && <StatusBadge status={run.status} />}
          </SheetTitle>
          <SheetDescription className="font-mono text-xs">{runId}</SheetDescription>
        </SheetHeader>

        {error ? (
          <div role="alert" className="space-y-3 p-6">
            <p>{error.status === 404 ? "This run was deleted or its history has expired." : "Could not load this run."}</p>
            <Button variant="outline" onClick={() => mutate()}>Retry</Button>
            <Button variant="ghost" onClick={onClose}>Close</Button>
          </div>
        ) : !run ? (
          <div className="space-y-3 p-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-96 w-full" />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-4 p-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Meta label="Started">
                <span title={dateTime(run.started_at)}>{dateTime(run.started_at, { timeStyle: "medium" })}</span>
              </Meta>
              <Meta label="Duration">{duration(run.duration_ms)}</Meta>
              <Meta label="Trigger">
                {run.trigger}
                {run.attempt > 1 ? ` #${run.attempt}` : ""}
              </Meta>
              <Meta label={run.http_status !== null ? "HTTP" : "Exit"}>
                {run.http_status ?? run.exit_code ?? "—"}
              </Meta>
            </div>
            {run.error && (
              <div className="border-destructive/30 bg-destructive/8 text-destructive rounded-lg border px-3 py-2 font-mono text-xs">
                {run.error}
              </div>
            )}

            <div className="flex items-center gap-2">
              {run.job_type === "http" ? (
                <Tabs value={view} onValueChange={setView}>
                  <TabsList aria-label="Run output view">
                    <TabsTrigger value="output">Output</TabsTrigger>
                    <TabsTrigger value="response">Response body</TabsTrigger>
                  </TabsList>
                </Tabs>
              ) : <span className="text-sm font-medium">Output</span>}
              {active && (
                <span className="text-status-running flex items-center gap-1.5 text-xs">
                  <span className="status-orb size-1.5" data-pulse="true" /> streaming
                </span>
              )}
              <div className="ms-auto flex items-center gap-1">
                <Button
                  size="icon-sm"
                  variant={follow ? "secondary" : "ghost"}
                  onClick={() => setFollow((f) => !f)}
                  aria-label="Follow output" aria-pressed={follow} title={follow ? "Following latest output" : "Jump to latest and follow"}>
                  <ChevronsDownIcon />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={copy} aria-label="Copy output" disabled={!text}>
                  <CopyIcon />
                </Button>
                <Button size="icon-sm" variant="ghost" onClick={download} aria-label="Download output" disabled={!text}>
                  <DownloadIcon />
                </Button>
              </div>
            </div>
            <pre
              ref={scroller}
              tabIndex={0}
              onWheel={(e) => { if (e.deltaY < 0) setFollow(false); }}
              onTouchMove={() => setFollow(false)}
              onKeyDown={(e) => { if (["ArrowUp", "PageUp", "Home"].includes(e.key)) setFollow(false); }}
              className={cn(
                "log-view min-h-0 flex-1 overflow-auto rounded-xl border bg-zinc-950 p-4 text-zinc-100",
                !text && "text-zinc-500"
              )}>
              {text || (active ? "Waiting for output…" : "(no output)")}
            </pre>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/jobs/view/?id=${run.job_id}`} onClick={onClose}>
                  <ExternalLinkIcon /> Open job
                </Link>
              </Button>
              {active && (
                <Button variant="destructive" size="sm" className="ms-auto" onClick={cancel}>
                  <SquareIcon className="fill-current" /> Cancel run
                </Button>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
