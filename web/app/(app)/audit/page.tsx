"use client";

import * as React from "react";
import Link from "next/link";
import useSWR from "swr";
import { ChevronLeft, ChevronRight, ScrollTextIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PageHeader } from "@/components/crondeck/page-header";
import { qs, type AuditEntry, type Page } from "@/lib/api";
import { dateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

const PER_PAGE = 50;
const ALL = "__all";

const tone = (action: string) => {
  if (action.includes("failed") || action.includes("rate_limited") || action.endsWith("delete")) return "text-status-failed bg-status-failed/10";
  if (action.startsWith("auth.")) return "text-chart-3 bg-chart-3/10";
  if (action.endsWith("run") || action.includes("bulk_run")) return "text-status-running bg-status-running/10";
  return "text-chart-1 bg-chart-1/10";
};

function metaSummary(meta: Record<string, unknown>) {
  const entries = Object.entries(meta ?? {}).filter(([k]) => k !== "user_agent");
  if (!entries.length) return "";
  return entries
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? `${v.length} items` : typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(" · ");
}

export default function AuditPage() {
  useUIPreferences();
  const [action, setAction] = React.useState(ALL);
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setPage(1), [action]);
  const { data, isLoading } = useSWR<Page<AuditEntry>>(
    "/audit" + qs({ action: action === ALL ? "" : action, page, per_page: PER_PAGE })
  );
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));

  return (
    <div className="space-y-4 lg:space-y-6">
      <PageHeader title="Audit log" description="Every login, change and manual action, newest first." />
      <Card className="py-0">
        <CardContent className="p-0">
          <div className="flex min-h-14 items-center gap-2 border-b px-(--card-spacing) py-3">
            <Select value={action} onValueChange={setAction}>
              <SelectTrigger size="sm" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All actions</SelectItem>
                <SelectItem value="auth.">Authentication</SelectItem>
                <SelectItem value="job.">Job changes</SelectItem>
                <SelectItem value="run.">Run actions</SelectItem>
                <SelectItem value="jobs.">Import / export</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-muted-foreground ms-auto text-sm">{total.toLocaleString()} entries</span>
          </div>
          {!isLoading && data?.items.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScrollTextIcon />
                </EmptyMedia>
                <EmptyTitle>No entries</EmptyTitle>
                <EmptyDescription>Activity will show up here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table className="[&_td:first-child]:ps-(--card-spacing) [&_td:last-child]:pe-(--card-spacing) [&_th:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing)">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">When</TableHead>
                  <TableHead className="w-44">Action</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead className="w-36">IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={4}>
                          <Skeleton className="h-6 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : data?.items.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="whitespace-nowrap" title={dateTime(a.created_at)}>
                          <div className="text-sm">{relativeTime(a.created_at)}</div>
                          <div className="text-muted-foreground text-xs">{dateTime(a.created_at)}</div>
                        </TableCell>
                        <TableCell>
                          <span className={cn("rounded-md px-2 py-1 font-mono text-xs font-medium", tone(a.action))}>
                            {a.action}
                          </span>
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-md truncate text-xs">
                          {a.target_id && a.action.startsWith("job.") && a.action !== "job.delete" ? (
                            <Link href={`/jobs/view/?id=${a.target_id}`} className="text-foreground hover:text-primary me-2 font-medium">
                              {(a.meta?.name as string) ?? a.target_id}
                            </Link>
                          ) : null}
                          {metaSummary(a.meta)}
                        </TableCell>
                        <TableCell className="text-muted-foreground font-mono text-xs">{a.ip || "—"}</TableCell>
                      </TableRow>
                    ))}
              </TableBody>
            </Table>
          )}
          <div className="flex items-center justify-end gap-2 border-t px-(--card-spacing) py-3">
            <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
              <ChevronLeft />
            </Button>
            <span className="text-muted-foreground px-2 text-xs tabular-nums">
              {page} / {pages}
            </span>
            <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
              <ChevronRight />
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
