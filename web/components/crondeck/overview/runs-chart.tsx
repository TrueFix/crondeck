"use client";

import { useState } from "react";
import useSWR from "swr";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import type { TimelineBucket } from "@/lib/api";
import { dateTime, shortTime } from "@/lib/format";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

const chartConfig = {
  success: { label: "Succeeded", color: "var(--status-success)" },
  failed: { label: "Failed", color: "var(--status-failed)" },
  other: { label: "Other", color: "var(--muted-foreground)" }
} satisfies ChartConfig;

type Range = "1h" | "24h" | "7d" | "30d";

function tickLabel(iso: string, range: Range) {
  if (range === "1h" || range === "24h") return shortTime(iso);
  if (range === "7d") return dateTime(iso, { weekday: "short", hour: "2-digit" });
  return dateTime(iso, { month: "short", day: "numeric" });
}

function RunsTooltip({
  active,
  payload,
  range
}: {
  active?: boolean;
  payload?: { payload: TimelineBucket }[];
  range: Range;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const total = row.success + row.failed + row.other;
  return (
    <div className="bg-foreground text-background min-w-48 rounded-lg p-3 shadow-md">
      <p className="mb-2 text-sm font-medium">
        {dateTime(row.t, {
          dateStyle: range === "1h" || range === "24h" ? undefined : "medium",
          timeStyle: "short"
        })}
      </p>
      <div className="space-y-1.5 text-sm">
        {(["success", "failed", "other"] as const).map((k) => (
          <div key={k} className="flex items-center justify-between gap-6">
            <span className="flex items-center gap-1.5 opacity-80">
              <span className="size-2 rounded-full" style={{ background: chartConfig[k].color }} />
              {chartConfig[k].label}
            </span>
            <span className="font-medium tabular-nums">{row[k]}</span>
          </div>
        ))}
        <div className="border-background/20 mt-2 flex items-center justify-between gap-6 border-t pt-2">
          <span className="opacity-70">Total</span>
          <span className="font-medium tabular-nums">{total}</span>
        </div>
      </div>
    </div>
  );
}

export function RunsChart() {
  useUIPreferences();
  const [range, setRange] = useState<Range>("24h");
  const { data } = useSWR<TimelineBucket[]>(`/stats/timeline?range=${range}`);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run activity</CardTitle>
        <CardDescription>Completed runs by outcome</CardDescription>
        <CardAction>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-muted-foreground hidden items-center gap-4 text-sm lg:flex">
              <span className="flex items-center gap-1.5">
                <span className="bg-status-success size-2 rounded-full" />
                Succeeded
              </span>
              <span className="flex items-center gap-1.5">
                <span className="bg-status-failed size-2 rounded-full" />
                Failed
              </span>
            </div>
            <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
              <TabsList className="h-auto flex-wrap">
                <TabsTrigger value="1h">1h</TabsTrigger>
                <TabsTrigger value="24h">24h</TabsTrigger>
                <TabsTrigger value="7d">7d</TabsTrigger>
                <TabsTrigger value="30d">30d</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-[220px] w-full rounded-lg sm:h-[300px]" />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[220px] w-full min-w-0 sm:h-[300px]">
            <BarChart accessibilityLayer data={data} barGap={2}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="t"
                tickLine={false}
                axisLine={false}
                tickMargin={10}
                minTickGap={24}
                tickFormatter={(v) => tickLabel(v, range)}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} width={36} allowDecimals={false} />
              <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.4 }} content={<RunsTooltip range={range} />} />
              <Bar isAnimationActive={false} dataKey="success" stackId="a" fill="var(--color-success)" radius={[0, 0, 4, 4]} maxBarSize={18} />
              <Bar isAnimationActive={false} dataKey="failed" stackId="a" fill="var(--color-failed)" maxBarSize={18} />
              <Bar isAnimationActive={false} dataKey="other" stackId="a" fill="var(--color-other)" radius={[4, 4, 0, 0]} maxBarSize={18} fillOpacity={0.35} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}
