"use client";

import * as React from "react";
import useSWR from "swr";
import { GitBranchIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, type Job } from "@/lib/api";
import { JobTypeIcon } from "@/components/crondeck/job-type";

const DEP_SCHEDULE = "@dependency";

export function isDependencyJob(schedule: string, dependsOn: string[]) {
  return dependsOn.length > 0 || schedule === DEP_SCHEDULE;
}

export function JobDependsPicker({
  jobId,
  value,
  schedule,
  onChange,
  onScheduleChange,
  error
}: {
  jobId?: string;
  value: string[];
  schedule: string;
  onChange: (ids: string[]) => void;
  onScheduleChange: (schedule: string) => void;
  error?: string;
}) {
  const { data } = useSWR<{ items: Job[] }>("/jobs?per_page=500&sort=name");
  const jobs = (data?.items ?? []).filter((j) => j.id !== jobId);
  const byId = React.useMemo(() => Object.fromEntries(jobs.map((j) => [j.id, j])), [jobs]);
  const available = jobs.filter((j) => !value.includes(j.id));

  const add = (id: string) => {
    if (!id || value.includes(id)) return;
    const next = [...value, id];
    onChange(next);
    if (next.length > 0 && schedule !== DEP_SCHEDULE) {
      onScheduleChange(DEP_SCHEDULE);
    }
  };

  const remove = (id: string) => {
    const next = value.filter((x) => x !== id);
    onChange(next);
    if (next.length === 0 && schedule === DEP_SCHEDULE) {
      onScheduleChange("*/5 * * * *");
    }
  };

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <GitBranchIcon className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
        <div className="min-w-0 space-y-1">
          <Label className="text-sm font-medium">Run after upstream jobs succeed</Label>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Downstream jobs use schedule <code className="font-mono">@dependency</code> and start automatically when every
            selected upstream job finishes successfully. Manual &quot;Run now&quot; still works anytime.
          </p>
        </div>
      </div>
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {value.map((id) => {
            const j = byId[id];
            return (
              <li key={id}>
                <Badge variant="secondary" className="gap-1 pe-1 font-normal">
                  {j ? j.name : id.slice(0, 8)}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-5"
                    aria-label="Remove upstream job"
                    onClick={() => remove(id)}>
                    <XIcon className="size-3" />
                  </Button>
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      <Select value="" onValueChange={add} disabled={available.length === 0}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={available.length ? "Add upstream job…" : "No other jobs yet"} />
        </SelectTrigger>
        <SelectContent>
          {available.map((j) => (
            <SelectItem key={j.id} value={j.id}>
              <span className="flex items-center gap-2">
                <JobTypeIcon type={j.type} className="size-7 rounded-lg" />
                {j.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  );
}
