"use client";

import { CheckIcon, CircleSlashIcon, ClockAlertIcon, LoaderIcon, MinusIcon, XIcon, HourglassIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/api";

export const statusMeta: Record<
  RunStatus | "never" | "disabled",
  { label: string; text: string; bg: string; icon: React.ComponentType<{ className?: string }> }
> = {
  success: { label: "Success", text: "text-status-success", bg: "bg-status-success/12", icon: CheckIcon },
  failed: { label: "Failed", text: "text-status-failed", bg: "bg-status-failed/12", icon: XIcon },
  timeout: { label: "Timed out", text: "text-status-warning", bg: "bg-status-warning/14", icon: ClockAlertIcon },
  running: { label: "Running", text: "text-status-running", bg: "bg-status-running/12", icon: LoaderIcon },
  queued: { label: "Queued", text: "text-status-running", bg: "bg-status-running/10", icon: HourglassIcon },
  cancelled: { label: "Cancelled", text: "text-status-idle", bg: "bg-muted", icon: CircleSlashIcon },
  skipped: { label: "Skipped", text: "text-status-idle", bg: "bg-muted", icon: MinusIcon },
  never: { label: "Never run", text: "text-status-idle", bg: "bg-muted", icon: MinusIcon },
  disabled: { label: "Paused", text: "text-status-idle", bg: "bg-muted", icon: MinusIcon }
};

export function StatusOrb({
  status,
  className,
  pulse
}: {
  status: keyof typeof statusMeta;
  className?: string;
  pulse?: boolean;
}) {
  const m = statusMeta[status];
  const isPulse = pulse ?? (status === "running" || status === "queued");
  return (
    <span
      aria-label={m.label}
      role="img"
      data-pulse={isPulse}
      className={cn("status-orb shrink-0", m.text, className)}
    />
  );
}

export function StatusBadge({ status, className }: { status: keyof typeof statusMeta; className?: string }) {
  const m = statusMeta[status];
  const Icon = m.icon;
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap ring-1 ring-current/15 ring-inset",
        m.text,
        m.bg,
        className
      )}>
      <Icon className={cn("size-3.5", status === "running" && "animate-spin")} />
      {m.label}
    </span>
  );
}
