"use client";

import { TrendingDownIcon, TrendingUpIcon } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { MotionGrid, MotionGridItem } from "@/components/crondeck/motion-shell";
import type { Overview } from "@/lib/api";
import { compact, duration, percent } from "@/lib/format";

type Stat = {
  name: string;
  description: string;
  value: string;
  target?: string;
  ratio: number;
  color: string;
  delta?: { value: string; good: boolean } | null;
};

const SEGMENT_COUNT = 32;

function TickProgress({ ratio, color, label }: { ratio: number; color: string; label: string }) {
  const filled = Math.round(Math.max(0, Math.min(1, ratio)) * SEGMENT_COUNT);
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(ratio * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="flex min-w-0 items-center gap-px sm:gap-1">
      {Array.from({ length: SEGMENT_COUNT }).map((_, index) => (
        <span key={index} className="bg-muted-foreground/15 relative h-4 min-w-0 flex-1 rounded-full sm:h-5 sm:w-1">
          {index < filled && (
            <span
              className={cn(
                color,
                "absolute inset-0 rounded-full"
              )}
            />
          )}
        </span>
      ))}
    </div>
  );
}

function buildStats(o: Overview): Stat[] {
  const runDelta =
    o.prev_runs_24h > 0 ? ((o.runs_24h - o.prev_runs_24h) / o.prev_runs_24h) * 100 : null;
  const rateDelta = o.prev_runs_24h > 0 ? o.success_rate_24h - o.prev_success_rate_24h : null;
  return [
    {
      name: "Active jobs",
      description: "Enabled and scheduled",
      value: String(o.enabled_jobs),
      target: `${o.total_jobs} total`,
      ratio: o.total_jobs ? o.enabled_jobs / o.total_jobs : 0,
      color: "bg-chart-1"
    },
    {
      name: "Runs · 24h",
      description: `${compact(o.runs_7d)} in the last 7 days`,
      value: compact(o.runs_24h),
      ratio: o.runs_7d ? Math.min(1, (o.runs_24h * 7) / o.runs_7d / 2) : 0,
      color: "bg-chart-3",
      delta: runDelta === null ? null : { value: `${runDelta >= 0 ? "+" : ""}${runDelta.toFixed(0)}%`, good: true }
    },
    {
      name: "Success rate",
      description: `${percent(o.success_rate_7d)} over 7 days`,
      value: o.runs_24h ? percent(o.success_rate_24h) : "—",
      target: "24h",
      ratio: o.success_rate_24h / 100,
      color: o.success_rate_24h >= 95 ? "bg-status-success" : o.success_rate_24h >= 80 ? "bg-status-warning" : "bg-status-failed",
      delta:
        rateDelta === null
          ? null
          : { value: `${rateDelta >= 0 ? "+" : ""}${rateDelta.toFixed(1)} pts`, good: rateDelta >= 0 }
    },
    {
      name: "Failing now",
      description: `Avg run ${duration(o.avg_duration_ms_7d)} · ${o.failed_24h} failed runs today`,
      value: String(o.failing_jobs),
      target: o.failing_jobs === 1 ? "job" : "jobs",
      ratio: o.total_jobs ? o.failing_jobs / o.total_jobs : 0,
      color: "bg-status-failed"
    }
  ];
}

export function StatCards({ data }: { data?: Overview }) {
  if (!data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[164px] rounded-xl" />
        ))}
      </div>
    );
  }
  return (
    <MotionGrid className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:gap-6 xl:grid-cols-4">
      {buildStats(data).map((item) => (
        <MotionGridItem key={item.name}>
        <Card className="h-full">
          <CardHeader>
            <CardTitle>{item.name}</CardTitle>
            <CardDescription className="truncate">{item.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col justify-end gap-3">
            <div className="flex items-baseline gap-1.5">
              <span className="font-display text-2xl tabular-nums lg:text-3xl">{item.value}</span>
              {item.target && <span className="text-muted-foreground text-sm">{item.target}</span>}
              {item.delta && (
                <span
                  className={cn(
                    "ms-auto inline-flex items-center gap-1 text-xs font-medium",
                    item.delta.good ? "text-status-success" : "text-status-failed"
                  )}>
                  {item.delta.good ? <TrendingUpIcon className="size-3.5" /> : <TrendingDownIcon className="size-3.5" />}
                  {item.delta.value}
                </span>
              )}
            </div>
            <TickProgress ratio={item.ratio} color={item.color} label={`${item.name} progress`} />
          </CardContent>
        </Card>
        </MotionGridItem>
      ))}
    </MotionGrid>
  );
}
