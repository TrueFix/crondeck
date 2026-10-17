import { GlobeIcon, SquareTerminalIcon, FileCode2Icon, DatabaseIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JobType } from "@/lib/api";

export const jobTypeMeta: Record<
  JobType,
  { label: string; description: string; icon: React.ComponentType<{ className?: string }>; tone: string }
> = {
  http: {
    label: "HTTP",
    description: "Call a URL / webhook",
    icon: GlobeIcon,
    tone: "text-chart-3 bg-chart-3/12 ring-chart-3/25"
  },
  shell: {
    label: "Shell",
    description: "Run a command on the host",
    icon: SquareTerminalIcon,
    tone: "text-chart-1 bg-chart-1/12 ring-chart-1/25"
  },
  script: {
    label: "Script",
    description: "Run inline bash / python / node",
    icon: FileCode2Icon,
    tone: "text-chart-4 bg-chart-4/12 ring-chart-4/25"
  },
  sql: {
    label: "SQL",
    description: "Run SQL on sqlite / postgres",
    icon: DatabaseIcon,
    tone: "text-chart-5 bg-chart-5/12 ring-chart-5/25"
  }
};

/** Solid dot color for timelines and calendar chips. */
export const jobTypeDot: Record<JobType, string> = {
  http: "bg-chart-3",
  shell: "bg-chart-1",
  script: "bg-chart-4",
  sql: "bg-chart-5"
};

export function JobTypeIcon({ type, className }: { type: JobType; className?: string }) {
  const m = jobTypeMeta[type] ?? jobTypeMeta.shell;
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
        m.tone,
        className
      )}>
      <Icon className="size-4.5" />
    </span>
  );
}

export function JobTypeBadge({ type }: { type: JobType }) {
  const m = jobTypeMeta[type] ?? jobTypeMeta.shell;
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-medium ring-1 ring-inset",
        m.tone
      )}>
      <Icon className="size-3.5" />
      {m.label}
    </span>
  );
}
