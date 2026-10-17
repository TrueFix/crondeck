"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { motion } from "framer-motion";
import { ArrowRightIcon, CalendarClockIcon } from "lucide-react";

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { JobType, Upcoming } from "@/lib/api";
import { dateTime, relativeTime, shortTime } from "@/lib/format";
import { useUIPreferences } from "@/hooks/use-ui-preferences";
import { JobTypeIcon, jobTypeDot } from "@/components/crondeck/job-type";
import { cn } from "@/lib/utils";
import { fadeUp, springSoft, staggerContainer, useMotionDisabled } from "@/lib/motion";
import { useIsMobile } from "@/hooks/use-mobile";

const HOURS = 24;
const PER_JOB = 500;
const MOBILE_LIST = 10;

function UpcomingMobileList({
  items,
  now
}: {
  items: { id: string; name: string; type: JobType; at: string }[];
  now: number;
}) {
  const reduced = useMotionDisabled();

  return (
    <motion.ul
      className="space-y-2"
      variants={staggerContainer(0.04, 0.02)}
      initial={reduced ? false : "hidden"}
      animate="show">
      {items.map((item) => (
        <motion.li key={`${item.id}-${item.at}`} variants={fadeUp} transition={reduced ? { duration: 0 } : springSoft}>
          <Link
            href={`/jobs/view/?id=${item.id}`}
            className="hover:bg-muted/60 flex items-center gap-3 rounded-2xl border border-border/50 bg-background/40 p-3 transition-colors active:scale-[0.99]">
            <JobTypeIcon type={item.type} className="size-10 rounded-2xl" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.name}</p>
              <p className="text-muted-foreground text-xs">
                {dateTime(item.at, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
              </p>
            </div>
            <span className="text-primary shrink-0 text-xs font-medium tabular-nums">{relativeTime(item.at, now)}</span>
          </Link>
        </motion.li>
      ))}
    </motion.ul>
  );
}

/** Horizontal glass timeline of every scheduled activation in the next 24h. */
export function UpcomingTimeline() {
  useUIPreferences();
  const isMobile = useIsMobile();
  const { data } = useSWR<Upcoming[]>(`/upcoming?hours=${HOURS}&per_job=${PER_JOB}`);
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  const lanes = React.useMemo(() => {
    const map = new Map<string, { name: string; type: JobType; times: number[] }>();
    for (const u of data ?? []) {
      if (!map.has(u.job_id)) map.set(u.job_id, { name: u.job_name, type: u.job_type, times: [] });
      map.get(u.job_id)!.times.push(new Date(u.at).getTime());
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => a.times[0] - b.times[0])
      .slice(0, 8);
  }, [data]);

  const mobileItems = React.useMemo(() => {
    if (!data?.length) return [];
    return [...data]
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      .slice(0, MOBILE_LIST)
      .map((u) => ({ id: u.job_id, name: u.job_name, type: u.job_type, at: u.at }));
  }, [data]);

  const next = data?.[0];
  const span = HOURS * 3600e3;
  const hourMarks = Array.from({ length: 7 }, (_, i) => now + (i * span) / 6);

  return (
    <Card>
      <CardHeader className="max-md:grid-cols-1 max-md:gap-3">
        <CardTitle className="flex items-center gap-2">
          <CalendarClockIcon className="text-primary size-4 shrink-0" />
          Next 24 hours
        </CardTitle>
        <CardDescription className="max-md:col-start-1">
          {next ? (
            <>
              Next up: <span className="text-foreground font-medium">{next.job_name}</span>{" "}
              <span className="text-primary font-medium">{relativeTime(next.at, now)}</span>
            </>
          ) : data ? (
            "Nothing scheduled"
          ) : (
            "Loading…"
          )}
        </CardDescription>
        <CardAction className="max-md:col-start-1 max-md:row-start-3 max-md:justify-self-stretch">
          <Button variant="outline" size="sm" className="max-md:w-full" asChild>
            <Link href="/calendar/">
              Calendar <ArrowRightIcon className="max-md:ms-auto" />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!data ? (
          <Skeleton className="h-48 w-full rounded-lg max-md:h-64" />
        ) : lanes.length === 0 ? (
          <div className="text-muted-foreground flex h-32 items-center justify-center text-sm">
            No enabled jobs fire in the next day.
          </div>
        ) : isMobile ? (
          <UpcomingMobileList items={mobileItems} now={now} />
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-41 shrink-0" />
              <div className="text-muted-foreground relative h-4 min-w-0 flex-1 text-[10px]">
                {hourMarks.map((t, i) => (
                  <span
                    key={i}
                    className={cn(
                      "absolute",
                      i === 0 ? "translate-x-0" : i === 6 ? "-translate-x-full" : "-translate-x-1/2"
                    )}
                    style={{ left: `${(i / 6) * 100}%` }}>
                    {i === 0 ? "now" : shortTime(new Date(t).toISOString())}
                  </span>
                ))}
              </div>
              <span className="w-12 shrink-0" />
            </div>
            {lanes.map((lane) => (
              <div key={lane.id} className="flex min-w-0 items-center gap-3">
                <Link
                  href={`/jobs/view/?id=${lane.id}`}
                  className="hover:text-primary flex w-41 shrink-0 items-center gap-2 truncate text-sm">
                  <JobTypeIcon type={lane.type} className="size-6 rounded-md [&_svg]:size-3.5" />
                  <span className="truncate">{lane.name}</span>
                </Link>
                <div className="bg-muted-foreground/8 relative h-7 min-w-0 flex-1 overflow-hidden rounded-full">
                  {hourMarks.slice(1, -1).map((_, i) => (
                    <span
                      key={i}
                      className="bg-border absolute top-1 bottom-1 w-px"
                      style={{ left: `${((i + 1) / 6) * 100}%` }}
                    />
                  ))}
                  {lane.times.length > 48 ? (
                    <span className={cn("absolute inset-y-2.5 start-0 end-0 rounded-full opacity-60", jobTypeDot[lane.type])} />
                  ) : (
                    lane.times.map((t) => {
                      const left = ((t - now) / span) * 100;
                      if (left < 0 || left > 100) return null;
                      return (
                        <Tooltip key={t}>
                          <TooltipTrigger asChild>
                            <span
                              className={cn(
                                "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-white/40 transition-transform hover:scale-150 dark:ring-black/30",
                                jobTypeDot[lane.type]
                              )}
                              style={{ left: `${left}%` }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>
                            {lane.name} · {dateTime(new Date(t).toISOString(), { weekday: "short", hour: "2-digit", minute: "2-digit" })}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })
                  )}
                </div>
                <span className="text-muted-foreground w-12 shrink-0 text-end text-xs tabular-nums">
                  ×{lane.times.length >= PER_JOB ? `${PER_JOB}+` : lane.times.length}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
