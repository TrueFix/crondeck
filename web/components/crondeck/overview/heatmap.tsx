"use client";

import * as React from "react";
import useSWR from "swr";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import type { HeatDay } from "@/lib/api";
import { cn } from "@/lib/utils";

const WEEKS = 53;
const DAY_LABELS = ["", "Mon", "", "Wed", "", "Fri", ""];

function level(total: number, max: number) {
  if (total === 0) return 0;
  const r = total / Math.max(1, max);
  if (r > 0.75) return 4;
  if (r > 0.5) return 3;
  if (r > 0.25) return 2;
  return 1;
}

const levelClass = [
  "bg-muted-foreground/10",
  "bg-chart-1/30",
  "bg-chart-1/55",
  "bg-chart-1/80",
  "bg-chart-1"
];

/** GitHub-style yearly heatmap of run volume; days with failures get a red ring. */
export function RunHeatmap() {
  const { data } = useSWR<HeatDay[]>("/stats/heatmap");

  const { cells, months, max, totalRuns, activeDays } = React.useMemo(() => {
    const byDate = new Map((data ?? []).map((d) => [d.date, d]));
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setUTCDate(start.getUTCDate() - (WEEKS - 1) * 7 - today.getUTCDay());
    const cells: { date: string; total: number; failed: number; future: boolean }[] = [];
    const months: { label: string; col: number }[] = [];
    let max = 0;
    let totalRuns = 0;
    let activeDays = 0;
    for (let i = 0; i < WEEKS * 7; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      const h = byDate.get(key);
      const total = h?.total ?? 0;
      max = Math.max(max, total);
      totalRuns += total;
      if (total) activeDays++;
      cells.push({ date: key, total, failed: h?.failed ?? 0, future: d > today });
      if (d.getUTCDate() <= 7 && i % 7 === 0) {
        months.push({ label: d.toLocaleDateString(undefined, { month: "short", timeZone: "UTC" }), col: i / 7 });
      }
    }
    return { cells, months, max, totalRuns, activeDays };
  }, [data]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Year in runs</CardTitle>
        <CardDescription>
          {data ? `${totalRuns.toLocaleString()} runs across ${activeDays} active days` : "Loading…"}
        </CardDescription>
        <CardAction className="text-muted-foreground hidden items-center gap-1.5 text-xs sm:flex">
          Less
          {levelClass.map((c) => (
            <span key={c} className={cn("size-2.5 rounded-[3px]", c)} />
          ))}
          More
        </CardAction>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-[120px] w-full rounded-lg" />
        ) : (
          <div className="overflow-x-auto pb-1">
            <div className="inline-grid min-w-max grid-cols-[auto_1fr] gap-x-2">
              <div />
              <div className="relative mb-1 h-4 text-[10px]" style={{ width: WEEKS * 14 }}>
                {months.map((m) => (
                  <span key={`${m.label}-${m.col}`} className="text-muted-foreground absolute" style={{ left: m.col * 14 }}>
                    {m.label}
                  </span>
                ))}
              </div>
              <div className="text-muted-foreground grid grid-rows-7 gap-[3px] text-[10px] leading-[11px]">
                {DAY_LABELS.map((l, i) => (
                  <span key={i}>{l}</span>
                ))}
              </div>
              <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
                {cells.map((c) =>
                  c.future ? (
                    <span key={c.date} className="size-[11px]" />
                  ) : (
                    <Tooltip key={c.date}>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            "size-[11px] rounded-[3px] transition-transform hover:scale-125",
                            levelClass[level(c.total, max)],
                            c.failed > 0 && "ring-status-failed/70 ring-1"
                          )}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <div className="font-medium">
                          {new Date(c.date + "T00:00:00Z").toLocaleDateString(undefined, { dateStyle: "medium", timeZone: "UTC" })}
                        </div>
                        <div>
                          {c.total} runs{c.failed ? ` · ${c.failed} failed` : ""}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
