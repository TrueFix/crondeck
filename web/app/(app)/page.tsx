"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { ArrowRightIcon, PlusIcon, SparklesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/crondeck/page-header";
import { StatCards } from "@/components/crondeck/overview/stat-cards";
import { RunsChart } from "@/components/crondeck/overview/runs-chart";
import { RunHeatmap } from "@/components/crondeck/overview/heatmap";
import { UpcomingTimeline } from "@/components/crondeck/overview/upcoming-timeline";
import { TopJobs } from "@/components/crondeck/overview/top-jobs";
import { RunsTable } from "@/components/crondeck/runs-table";
import { LogViewer } from "@/components/crondeck/log-viewer";
import type { Overview, Page, Run } from "@/lib/api";
import { percent } from "@/lib/format";
import { MotionBlock } from "@/components/crondeck/motion-shell";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Burning the midnight oil";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

export default function OverviewPage() {
  const { data: overview } = useSWR<Overview>("/stats/overview");
  const { data: recent, isLoading } = useSWR<Page<Run>>("/runs?per_page=8");
  const [openRun, setOpenRun] = React.useState<string | null>(null);
  const [hello, setHello] = React.useState("Welcome");
  React.useEffect(() => setHello(greeting()), []);

  const empty = overview && overview.total_jobs === 0;

  return (
    <div className="space-y-4 lg:space-y-6">
      <MotionBlock>
      <PageHeader
        title="Control room"
        description={`${hello}. Your automation, at a glance.`}
        actions={
          <Button asChild>
            <Link href="/jobs/new/">
              <PlusIcon /> New job
            </Link>
          </Button>
        }
      />
      </MotionBlock>

        <MotionBlock delay={0.05}>
        <Card className="deck-masthead overflow-hidden">
          <CardContent className="relative flex flex-col items-start gap-4 py-3 sm:gap-6 sm:flex-row sm:items-center">
            <div className="deck-signal shrink-0" aria-label="24-hour success rate"
              style={{"--signal-progress": `${(overview?.success_rate_24h ?? 0) * 3.6}deg`} as React.CSSProperties}>
              <div>
                <span className="font-display text-2xl tabular-nums">{overview?.runs_24h ? percent(overview.success_rate_24h,0) : "—"}</span>
                <span className="text-muted-foreground text-[9px] tracking-[.16em] uppercase">Reliability</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="text-primary flex items-center gap-2 text-[10px] font-semibold tracking-[.22em] uppercase">
                <SparklesIcon className="size-3.5" /> CronDeck / Automation studio
              </div>
              <div className="font-display text-2xl tracking-tight sm:text-3xl">{empty ? "Make room for what’s next." : "Everything, in good time."}</div>
              <p className="text-muted-foreground text-sm">
                {empty ? "Give your repetitive work a rhythm. Start with a template or create your own job." :
                  `${overview?.enabled_jobs ?? 0} jobs on the clock · ${overview?.running_now ?? 0} running now · ${overview?.failed_24h ?? 0} failed runs today`}
              </p>
            </div>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button variant="outline" className="w-full sm:w-auto" asChild>
                <Link href={empty ? "/templates/" : "/runs/"}>{empty ? "Explore templates" : "Inspect activity"} <ArrowRightIcon /></Link>
              </Button>
            </div>
          </CardContent>
        </Card>
        </MotionBlock>

      <MotionBlock delay={0.08}>
      <StatCards data={overview} />
      </MotionBlock>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="lg:col-span-12 xl:col-span-8">
          <RunsChart />
        </div>
        <div className="lg:col-span-12 xl:col-span-4">
          <TopJobs />
        </div>
        <div className="lg:col-span-12">
          <UpcomingTimeline />
        </div>
        <div className="lg:col-span-12">
          <Card className="pb-0">
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
              <CardDescription>Click a run to inspect its output</CardDescription>
              <CardAction>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/runs/">
                    View all <ArrowRightIcon />
                  </Link>
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent className="px-0">
              <RunsTable runs={recent?.items} loading={isLoading} onOpen={(r) => setOpenRun(r.id)} />
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-12">
          <RunHeatmap />
        </div>
      </div>

      <LogViewer runId={openRun} onClose={() => setOpenRun(null)} />
    </div>
  );
}
