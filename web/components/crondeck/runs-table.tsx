"use client";

import type { ComponentType } from "react";
import Link from "next/link";
import { ZapIcon, RotateCwIcon, ClockIcon, GitBranchIcon } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Run } from "@/lib/api";
import { dateTime, duration, relativeTime } from "@/lib/format";
import { StatusBadge } from "@/components/crondeck/status";
import { JobTypeIcon } from "@/components/crondeck/job-type";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

const triggerIcon = {
  schedule: ClockIcon,
  manual: ZapIcon,
  retry: RotateCwIcon,
  chain: GitBranchIcon
} satisfies Record<Run["trigger"], ComponentType<{ className?: string }>>;

export function RunsTable({
  runs,
  loading,
  showJob = true,
  onOpen,
  empty = "No runs yet."
}: {
  runs?: Run[];
  loading?: boolean;
  showJob?: boolean;
  onOpen: (run: Run) => void;
  empty?: React.ReactNode;
}) {
  useUIPreferences();
  return (
    <Table className="[&_td:first-child]:ps-(--card-spacing) [&_td:last-child]:pe-(--card-spacing) [&_th:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing)">
      <TableHeader>
        <TableRow>
          <TableHead className="w-36">Status</TableHead>
          {showJob && <TableHead>Job</TableHead>}
          <TableHead>Started</TableHead>
          <TableHead className="hidden md:table-cell">Trigger</TableHead>
          <TableHead className="text-end">Duration</TableHead>
          <TableHead className="hidden lg:table-cell">Result</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && !runs ? (
          Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell colSpan={showJob ? 6 : 5}>
                <Skeleton className="h-6 w-full" />
              </TableCell>
            </TableRow>
          ))
        ) : runs && runs.length > 0 ? (
          runs.map((r) => {
            const TIcon = triggerIcon[r.trigger] ?? ClockIcon;
            return (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r)}>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                {showJob && (
                  <TableCell className="max-w-64">
                    <Link
                      href={`/jobs/view/?id=${r.job_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="hover:text-primary flex items-center gap-2 truncate font-medium">
                      {r.job_type && <JobTypeIcon type={r.job_type} className="size-6 rounded-md [&_svg]:size-3.5" />}
                      <span className="truncate">{r.job_name || "deleted job"}</span>
                    </Link>
                  </TableCell>
                )}
                <TableCell className="whitespace-nowrap">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>{relativeTime(r.started_at ?? r.created_at)}</span>
                    </TooltipTrigger>
                    <TooltipContent>{dateTime(r.started_at ?? r.created_at)}</TooltipContent>
                  </Tooltip>
                </TableCell>
                <TableCell className="text-muted-foreground hidden capitalize md:table-cell">
                  <span className="inline-flex items-center gap-1.5">
                    <TIcon className="size-3.5" />
                    {r.trigger}
                    {r.attempt > 1 && <span className="text-xs">#{r.attempt}</span>}
                  </span>
                </TableCell>
                <TableCell className="text-end font-mono text-xs tabular-nums">{duration(r.duration_ms)}</TableCell>
                <TableCell className="text-muted-foreground hidden max-w-72 truncate font-mono text-xs lg:table-cell">
                  {r.http_status !== null ? `HTTP ${r.http_status}` : r.exit_code !== null ? `exit ${r.exit_code}` : ""}
                  {r.error ? ` · ${r.error}` : ""}
                </TableCell>
              </TableRow>
            );
          })
        ) : (
          <TableRow>
            <TableCell colSpan={showJob ? 6 : 5} className="text-muted-foreground h-28 text-center">
              {empty}
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
