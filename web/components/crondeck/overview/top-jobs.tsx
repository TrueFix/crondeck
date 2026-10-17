"use client";

import Link from "next/link";
import useSWR from "swr";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardAction } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import type { JobStat } from "@/lib/api";
import { duration, percent } from "@/lib/format";
import { JobTypeIcon } from "@/components/crondeck/job-type";
import { cn } from "@/lib/utils";

export function TopJobs() {
  const [by, setBy] = useState<"failures" | "duration">("failures");
  const { data } = useSWR<JobStat[]>(`/stats/top?by=${by}&limit=6`);
  const max = Math.max(1, ...(data ?? []).map((d) => (by === "failures" ? d.failures : d.avg_duration_ms)));

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{by === "failures" ? "Most failures" : "Slowest jobs"}</CardTitle>
        <CardDescription>Last 7 days</CardDescription>
        <CardAction>
          <Tabs value={by} onValueChange={(v) => setBy(v as typeof by)}>
            <TabsList>
              <TabsTrigger value="failures">Failures</TabsTrigger>
              <TabsTrigger value="duration">Duration</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!data ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : data.length === 0 || (by === "failures" && data.every((d) => d.failures === 0)) ? (
          <div className="text-muted-foreground flex h-40 flex-col items-center justify-center gap-1 text-center text-sm">
            <span className="text-2xl">✓</span>
            {by === "failures" ? "No failures this week." : "No runs yet."}
          </div>
        ) : (
          <ul className="space-y-3.5">
            {data
              .filter((d) => by !== "failures" || d.failures > 0)
              .map((d) => {
                const v = by === "failures" ? d.failures : d.avg_duration_ms;
                return (
                  <li key={d.job_id}>
                    <Link href={`/jobs/view/?id=${d.job_id}`} className="group flex items-center gap-3">
                      <JobTypeIcon type={d.job_type} className="size-8 rounded-lg" />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2 text-sm">
                          <span className="group-hover:text-primary truncate font-medium">{d.job_name}</span>
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            {by === "failures"
                              ? `${d.failures}/${d.runs} · ${percent(d.success_rate, 0)} ok`
                              : duration(d.avg_duration_ms)}
                          </span>
                        </div>
                        <div className="bg-muted-foreground/10 h-1.5 overflow-hidden rounded-full">
                          <div
                            className={cn("h-full rounded-full", by === "failures" ? "bg-status-failed" : "bg-chart-3")}
                            style={{ width: `${(v / max) * 100}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
