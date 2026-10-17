"use client";

import Link from "next/link";
import { useState } from "react";
import { ActivityIcon, SquareIcon } from "lucide-react";
import useSWR from "swr";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { useEventStream } from "@/components/crondeck/event-stream";
import { StatusOrb } from "@/components/crondeck/status";
import { api, type Page, type Run } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

/** Header pill showing how many runs are executing right now (live via SSE). */
export function LiveRuns() {
  useUIPreferences();
  const { activeRuns, finishedRuns, connected } = useEventStream();
  const [open, setOpen] = useState(false);
  // Seed from the API so runs that started before this tab opened are visible too.
  const { data } = useSWR<Page<Run>>("/runs?status=running&per_page=500");
  const merged = new Map<string, Run>();
  data?.items.forEach((r) => merged.set(r.id, r));
  activeRuns.forEach((r, id) => merged.set(id, r));
  const runs = [...merged.values()].filter((r) => !finishedRuns.has(r.id) && (r.status === "running" || r.status === "queued"));
  const count = runs.length;

  const cancel = async (id: string) => {
    try {
      await api(`/runs/${id}/cancel`, { method: "POST" });
      toast.success("Cancellation requested");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 max-w-[9.5rem] shrink rounded-full border px-2 text-xs font-medium sm:max-w-none sm:px-3 max-sm:border-transparent max-sm:bg-transparent",
            count > 0 ? "text-status-running" : "text-muted-foreground"
          )}>
          <StatusOrb
            status={count > 0 ? "running" : connected ? "success" : "failed"}
            pulse={count > 0}
            className="size-2 shrink-0"
          />
          <span className="truncate">
            {count > 0 ? `${count} running` : connected ? "All quiet" : "Offline"}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <ActivityIcon className="text-muted-foreground size-4" />
          <span className="text-sm font-medium">Active runs</span>
        </div>
        {count === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-center text-sm">Nothing running right now.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-auto">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                <StatusOrb status={r.status} className="size-2" />
                <Link href={`/runs/?run=${r.id}`} onClick={() => setOpen(false)} className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.job_name || r.job_id}</div>
                  <div className="text-muted-foreground text-xs">
                    {r.status === "queued" ? "Queued" : "Started"} {relativeTime(r.started_at ?? r.created_at)}
                  </div>
                </Link>
                <Button size="icon-sm" variant="ghost" onClick={() => cancel(r.id)} aria-label="Cancel run">
                  <SquareIcon className="fill-current" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
