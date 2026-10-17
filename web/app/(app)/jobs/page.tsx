"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  CopyIcon,
  MoreHorizontal,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  Trash2Icon,
  ListChecksIcon,
  XIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SearchInput } from "@/components/crondeck/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { PageHeader } from "@/components/crondeck/page-header";
import { JobTypeBadge } from "@/components/crondeck/job-type";
import { StatusOrb, statusMeta } from "@/components/crondeck/status";
import { ConfirmDialog } from "@/components/crondeck/confirm-dialog";
import { api, qs, type Job, type Page } from "@/lib/api";
import { dateTime, describeCron, relativeTime } from "@/lib/format";
import { useUIPreferences } from "@/hooks/use-ui-preferences";
import { MotionBlock } from "@/components/crondeck/motion-shell";

const PER_PAGE = 25;
const ALL = "__all";

export default function JobsPage() {
  useUIPreferences();
  const router = useRouter();
  const { mutate: globalMutate } = useSWRConfig();
  const [search, setSearch] = React.useState("");
  const [type, setType] = React.useState(ALL);
  const [status, setStatus] = React.useState(ALL);
  const [tag, setTag] = React.useState(ALL);
  const [enabled, setEnabled] = React.useState(ALL);
  const [sort, setSort] = React.useState("-created");
  const [page, setPage] = React.useState(1);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [confirm, setConfirm] = React.useState<{ ids: string[]; label: string } | null>(null);
  const q = search;

  const key =
    "/jobs" +
    qs({
      q,
      type: type === ALL ? "" : type,
      status: status === ALL ? "" : status,
      tag: tag === ALL ? "" : tag,
      enabled: enabled === ALL ? "" : enabled,
      sort,
      page,
      per_page: PER_PAGE
    });
  const { data, isLoading, mutate } = useSWR<Page<Job>>(key);
  const { data: tags } = useSWR<string[]>("/tags");

  React.useEffect(() => setPage(1), [q, type, status, tag, enabled, sort]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const filtersActive = !!q || type !== ALL || status !== ALL || tag !== ALL || enabled !== ALL;
  const allSelected = items.length > 0 && items.every((j) => selected.has(j.id));

  const refresh = () => {
    mutate();
    globalMutate((k) => typeof k === "string" && (k.startsWith("/stats") || k.startsWith("/tags")));
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const bulk = (action: "enable" | "disable" | "run" | "delete", ids: string[]) =>
    act(async () => {
      await api("/jobs/bulk", { method: "POST", body: { action, ids } });
      setSelected(new Set());
    }, `${ids.length} job${ids.length === 1 ? "" : "s"} ${action === "run" ? "started" : action + "d"}`);

  return (
    <div className="space-y-4 lg:space-y-6">
      <MotionBlock>
      <PageHeader
        title="Jobs"
        description={data ? `${total} job${total === 1 ? "" : "s"}${filtersActive ? total === 1 ? " matches your filters" : " match your filters" : ""}` : "Loading…"}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/templates/">Templates</Link>
            </Button>
            <Button asChild>
              <Link href="/jobs/new/">
                <PlusIcon /> New job
              </Link>
            </Button>
          </>
        }
      />
      </MotionBlock>

      <MotionBlock delay={0.05}>
      <Card className="py-0">
        <CardContent className="flex flex-col p-0">
          <div className="flex min-h-14 flex-wrap items-center gap-2 border-b px-(--card-spacing) py-3">
            {selected.size > 0 ? (
              <>
                <span className="px-1 text-sm font-medium">{selected.size} selected</span>
                <Button variant="outline" size="sm" onClick={() => bulk("run", [...selected])}>
                  <PlayIcon /> Run
                </Button>
                <Button variant="outline" size="sm" onClick={() => bulk("enable", [...selected])}>
                  <PlayIcon /> Enable
                </Button>
                <Button variant="outline" size="sm" onClick={() => bulk("disable", [...selected])}>
                  <PauseIcon /> Pause
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setConfirm({ ids: [...selected], label: `${selected.size} selected jobs` })}>
                  <Trash2Icon /> Delete
                </Button>
                <Button variant="outline" size="sm" className="ms-auto" onClick={() => setSelected(new Set())}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <SearchInput value={search} onChange={setSearch} />
                <FilterSelect value={type} onChange={setType} placeholder="Type" options={[["http", "HTTP"], ["shell", "Shell"], ["script", "Script"]]} />
                <FilterSelect
                  value={status}
                  onChange={setStatus}
                  placeholder="Last status"
                  options={[["success", "Success"], ["failed", "Failed"], ["timeout", "Timed out"], ["cancelled", "Cancelled"], ["skipped", "Skipped"], ["never", "Never run"]]}
                />
                <FilterSelect value={enabled} onChange={setEnabled} placeholder="State" options={[["true", "Enabled"], ["false", "Paused"]]} />
                {!!tags?.length && (
                  <FilterSelect value={tag} onChange={setTag} placeholder="Tag" options={tags.map((t) => [t, `#${t}`])} />
                )}
                {filtersActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearch("");
                      setType(ALL);
                      setStatus(ALL);
                      setTag(ALL);
                      setEnabled(ALL);
                    }}>
                    <XIcon /> Clear
                  </Button>
                )}
                <div className="ms-auto">
                  <Select value={sort} onValueChange={setSort}>
                    <SelectTrigger size="sm" className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="end">
                      <SelectItem value="-created">Newest first</SelectItem>
                      <SelectItem value="created">Oldest first</SelectItem>
                      <SelectItem value="name">Name A–Z</SelectItem>
                      <SelectItem value="-name">Name Z–A</SelectItem>
                      <SelectItem value="next_run">Next run</SelectItem>
                      <SelectItem value="last_run">Last run</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          {!isLoading && items.length === 0 ? (
            <Empty className="py-16">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ListChecksIcon />
                </EmptyMedia>
                <EmptyTitle>{filtersActive ? "No jobs match" : "No jobs yet"}</EmptyTitle>
                <EmptyDescription>
                  {filtersActive
                    ? "Try a different search or clear the filters."
                    : "Create your first scheduled job, or start from a ready-made template."}
                </EmptyDescription>
              </EmptyHeader>
              {!filtersActive && (
                <EmptyContent className="flex-row justify-center gap-2">
                  <Button variant="outline" asChild>
                    <Link href="/templates/">Browse templates</Link>
                  </Button>
                  <Button asChild>
                    <Link href="/jobs/new/">
                      <PlusIcon /> New job
                    </Link>
                  </Button>
                </EmptyContent>
              )}
            </Empty>
          ) : (
            <Table className="lg:min-w-[900px] [&_td:first-child]:ps-(--card-spacing) [&_td:last-child]:pe-(--card-spacing) [&_th:first-child]:ps-(--card-spacing) [&_th:last-child]:pe-(--card-spacing)">
              <TableHeader>
                <TableRow>
                  <TableHead className="hidden w-10 sm:table-cell">
                    <Checkbox
                      checked={allSelected || (selected.size > 0 && "indeterminate")}
                      onCheckedChange={(v) => setSelected(v ? new Set(items.map((j) => j.id)) : new Set())}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Job</TableHead>
                  <TableHead className="hidden w-24 lg:table-cell">Type</TableHead>
                  <TableHead className="hidden md:table-cell">Schedule</TableHead>
                  <TableHead className="hidden w-36 sm:table-cell">Next run</TableHead>
                  <TableHead className="hidden w-36 xl:table-cell">Last run</TableHead>
                  <TableHead className="w-20">Active</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !data
                  ? Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i}>
                        <TableCell colSpan={8}>
                          <Skeleton className="h-9 w-full" />
                        </TableCell>
                      </TableRow>
                    ))
                  : items.map((job) => {
                      const st = job.running > 0 ? "running" : !job.enabled ? "disabled" : (job.last_status ?? "never");
                      return (
                        <TableRow
                          key={job.id}
                          data-state={selected.has(job.id) ? "selected" : undefined}
                          className="cursor-pointer"
                          onClick={() => router.push(`/jobs/view/?id=${job.id}`)}>
                          <TableCell className="hidden sm:table-cell" onClick={(e) => e.stopPropagation()}>
                            <Checkbox
                              checked={selected.has(job.id)}
                              onCheckedChange={(v) => {
                                const next = new Set(selected);
                                if (v) next.add(job.id);
                                else next.delete(job.id);
                                setSelected(next);
                              }}
                              aria-label={`Select ${job.name}`}
                            />
                          </TableCell>
                          <TableCell className="max-w-80 lg:max-w-80">
                            <div className="flex items-center gap-3">
                              <StatusOrb status={st} />
                              <div className="min-w-0">
                                <div className="truncate font-medium">{job.name}</div>
                                <div className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
                                  {job.tags.map((t) => (
                                    <span key={t} className="bg-muted rounded px-1.5 py-px">
                                      #{t}
                                    </span>
                                  ))}
                                  {job.description && <span className="truncate">{job.description}</span>}
                                </div>
                                {/* Columns hidden on narrow screens stay available as a summary line. */}
                                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs md:hidden">
                                  <span className="font-mono">{job.schedule}</span>
                                  <span aria-hidden="true">·</span>
                                  <span className="uppercase">{job.type}</span>
                                  <span className="sm:hidden">
                                    <span aria-hidden="true" className="me-2">·</span>
                                    {job.next_run_at ? `next ${relativeTime(job.next_run_at)}` : "not scheduled"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell">
                            <JobTypeBadge type={job.type} />
                          </TableCell>
                          <TableCell className="hidden md:table-cell">
                            <div className="font-mono text-xs">{job.schedule}</div>
                            <div className="text-muted-foreground max-w-56 truncate text-xs">
                              {describeCron(job.schedule)}
                              {job.timezone !== "UTC" ? ` · ${job.timezone}` : ""}
                            </div>
                          </TableCell>
                          <TableCell className="hidden text-sm whitespace-nowrap sm:table-cell">
                            {job.next_run_at ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span>{relativeTime(job.next_run_at)}</span>
                                </TooltipTrigger>
                                <TooltipContent>{dateTime(job.next_run_at)}</TooltipContent>
                              </Tooltip>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-sm whitespace-nowrap">
                            {job.last_run_at ? (
                              <span className={statusMeta[job.last_status ?? "never"].text}>
                                {relativeTime(job.last_run_at)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Never</span>
                            )}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <Switch
                              checked={job.enabled}
                              aria-label={job.enabled ? "Pause job" : "Enable job"}
                              onCheckedChange={() =>
                                act(() => api(`/jobs/${job.id}/toggle`, { method: "POST" }), job.enabled ? "Job paused" : "Job enabled")
                              }
                            />
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()} className="text-end">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon-sm">
                                  <span className="sr-only">Open menu</span>
                                  <MoreHorizontal />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                                <DropdownMenuItem
                                  onSelect={() => act(() => api(`/jobs/${job.id}/run`, { method: "POST" }), `Started “${job.name}”`)}>
                                  <PlayIcon /> Run now
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                  <Link href={`/jobs/edit/?id=${job.id}`}>
                                    <PencilIcon /> Edit
                                  </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() =>
                                    act(() => api(`/jobs/${job.id}/duplicate`, { method: "POST" }), "Job duplicated (paused)")
                                  }>
                                  <CopyIcon /> Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  variant="destructive"
                                  onSelect={() => setConfirm({ ids: [job.id], label: `“${job.name}”` })}>
                                  <Trash2Icon /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-end gap-2 border-t px-(--card-spacing) py-3">
            <div className="text-muted-foreground flex-1 text-sm tabular-nums">
              {total === 0 ? "0" : `${(page - 1) * PER_PAGE + 1} – ${Math.min(page * PER_PAGE, total)}`} of {total} {total === 1 ? "job" : "jobs"}
            </div>
            <div className="flex items-center gap-1">
              <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
                <span className="sr-only">Previous page</span>
                <ChevronLeft />
              </Button>
              <span className="text-muted-foreground px-2 text-xs tabular-nums">
                {page} / {pages}
              </span>
              <Button variant="outline" size="icon-sm" onClick={() => setPage((p) => p + 1)} disabled={page >= pages}>
                <span className="sr-only">Next page</span>
                <ChevronRight />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      </MotionBlock>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Delete jobs?"
        description={`This permanently deletes ${confirm?.label} and all of their run history. Running runs are cancelled.`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => {
          if (!confirm) return;
          if (confirm.ids.length === 1) {
            await act(() => api(`/jobs/${confirm.ids[0]}`, { method: "DELETE" }), "Job deleted");
            setSelected((s) => {
              const n = new Set(s);
              n.delete(confirm.ids[0]);
              return n;
            });
          } else {
            await bulk("delete", confirm.ids);
          }
          setConfirm(null);
        }}
      />
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: [string, string][];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={placeholder} size="sm" className="w-auto min-w-28 data-[active=true]:border-primary/50" data-active={value !== ALL}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder === "Type" ? "All types" : placeholder === "Tag" ? "All tags" : placeholder === "Last status" ? "Any result" : "Any state"}</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
