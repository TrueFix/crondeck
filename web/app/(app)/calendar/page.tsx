"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronLeftIcon, ChevronRightIcon, CalendarDaysIcon, InfoIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/crondeck/page-header";
import { JobTypeIcon, jobTypeDot } from "@/components/crondeck/job-type";
import type { JobType } from "@/lib/api";
import { compact, shortTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUIPreferences } from "@/hooks/use-ui-preferences";
import { displayTimezone } from "@/lib/ui-preferences";

interface DayJobs {
  job_id: string;
  job_name: string;
  job_type: JobType;
  count: number;
  first: string;
  last: string;
}
interface Day {
  date: string;
  total: number;
  partial: boolean;
  jobs: DayJobs[];
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function CalendarPage() {
  const preferences = useUIPreferences();
  const tz = displayTimezone();
  const weekdays = preferences.weekStart === "monday" ? [...WEEKDAYS.slice(1), WEEKDAYS[0]] : WEEKDAYS;
  const todayInZone = new Intl.DateTimeFormat("en-CA", {timeZone:tz,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
  const [cursor, setCursor] = React.useState(() => {
    const d = new Date(todayInZone + "T12:00:00");
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = todayInZone;
  const [selected, setSelected] = React.useState(today);

  // 6-week grid aligned to the preferred first day of the week.
  const gridStart = new Date(cursor);
  gridStart.setDate(1 - (cursor.getDay() - (preferences.weekStart === "monday" ? 1 : 0) + 7) % 7);
  // Only future days have scheduled activations; past cells are rendered dimmed without counts.
  const gridDates = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return ymd(d);
  });
  const firstFuture = gridDates.findIndex((d) => d >= today);
  const fetchFrom = firstFuture === -1 ? null : gridDates[firstFuture];
  const { data: upcoming } = useSWR<Day[]>(
    fetchFrom ? `/upcoming/days?date=${fetchFrom}&days=${42 - firstFuture}&tz=${encodeURIComponent(tz)}` : null
  );
  const byDate = new Map((upcoming ?? []).map((d) => [d.date, d]));
  const data: Day[] | undefined =
    fetchFrom && !upcoming
      ? undefined
      : gridDates.map((date) => byDate.get(date) ?? { date, total: 0, partial: false, jobs: [] });
  const max = Math.max(1, ...(data ?? []).map((d) => d.total));
  const sel = data?.find((d) => d.date === selected);

  const shift = (m: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + m, 1));

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader
        title="Calendar"
        description={`Scheduled activations for enabled jobs · ${tz}`}
        actions={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                const d = new Date(today + "T12:00:00");
                setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
                setSelected(today);
              }}>
              Today
            </Button>
            <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRightIcon />
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <Card className="lg:col-span-8">
          <CardHeader>
            <CardTitle className="font-display text-xl">
              {cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-muted-foreground mb-2 grid grid-cols-7 gap-1.5 text-center text-xs font-medium">
              {weekdays.map((d) => (
                <div key={d}>{d}</div>
              ))}
            </div>
            {!data ? (
              <Skeleton className="h-[480px] w-full rounded-lg" />
            ) : (
              <div className="grid grid-cols-7 gap-1.5">
                {data.map((d) => {
                  const date = new Date(d.date + "T00:00:00");
                  const inMonth = date.getMonth() === cursor.getMonth();
                  const isToday = d.date === today;
                  const isPast = d.date < today;
                  const intensity = d.total / max;
                  return (
                    <button
                      key={d.date}
                      onClick={() => setSelected(d.date)}
                      className={cn(
                        "group relative flex aspect-square min-h-16 flex-col rounded-xl border p-1.5 text-start transition-all sm:p-2",
                        inMonth ? "bg-background/30" : "opacity-40",
                        isPast && "opacity-50",
                        selected === d.date ? "border-primary/60 ring-primary/30 ring-2" : "hover:bg-accent/40"
                      )}>
                      {d.total > 0 && (
                        <span
                          className="bg-chart-1 pointer-events-none absolute inset-0 rounded-xl"
                          style={{ opacity: 0.06 + intensity * 0.22 }}
                        />
                      )}
                      <span
                        className={cn(
                          "relative flex size-6 items-center justify-center rounded-full text-xs font-medium",
                          isToday && "bg-primary text-primary-foreground"
                        )}>
                        {date.getDate()}
                      </span>
                      {d.total > 0 && (
                        <>
                          <span className="relative mt-auto hidden text-[11px] font-semibold tabular-nums sm:block">
                            {compact(d.total)}
                            {d.partial ? "+" : ""}
                            <span className="text-muted-foreground font-normal"> runs</span>
                          </span>
                          <span className="relative mt-1 flex flex-wrap gap-0.5">
                            {d.jobs.slice(0, 6).map((j) => (
                              <span key={j.job_id} className={cn("size-1.5 rounded-full", jobTypeDot[j.job_type])} />
                            ))}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDaysIcon className="size-4" />
              {new Date(selected + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            </CardTitle>
            <CardDescription>
              {selected < today
                ? "Past day — see Run history for what actually ran"
                : sel
                  ? `${sel.total.toLocaleString()}${sel.partial ? "+" : ""} activations across ${sel.jobs.length} jobs`
                  : "Pick a day"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {sel?.partial && (
              <div className="text-muted-foreground mb-3 flex items-start gap-2 rounded-lg border p-2.5 text-xs">
                <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
                A very high-frequency job makes counts on this day approximate.
              </div>
            )}
            {selected < today ? (
              <div className="py-10 text-center">
                <Button variant="outline" asChild>
                  <Link href="/runs/">Open run history</Link>
                </Button>
              </div>
            ) : !sel || sel.jobs.length === 0 ? (
              <p className="text-muted-foreground py-10 text-center text-sm">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-2">
                {sel.jobs.map((j) => (
                  <li key={j.job_id}>
                    <Link
                      href={`/jobs/view/?id=${j.job_id}`}
                      className="hover:bg-accent/40 flex items-center gap-3 rounded-xl border p-2.5 transition-colors">
                      <JobTypeIcon type={j.job_type} className="size-8 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{j.job_name}</div>
                        <div className="text-muted-foreground text-xs">
                          {j.count === 1 ? `at ${shortTime(j.first)}` : `${shortTime(j.first)} → ${shortTime(j.last)}`}
                        </div>
                      </div>
                      <span className="bg-muted rounded-full px-2 py-0.5 text-xs font-medium tabular-nums">
                        ×{compact(j.count)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
