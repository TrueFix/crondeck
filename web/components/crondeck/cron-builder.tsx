"use client";

import * as React from "react";
import { CalendarClockIcon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { describeCron, dateTime, relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { TimezonePicker } from "@/components/crondeck/timezone-picker";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

const presets: { label: string; expr: string }[] = [
  { label: "Every minute", expr: "* * * * *" },
  { label: "Every 5 min", expr: "*/5 * * * *" },
  { label: "Every 15 min", expr: "*/15 * * * *" },
  { label: "Hourly", expr: "0 * * * *" },
  { label: "Daily 00:00", expr: "0 0 * * *" },
  { label: "Daily 09:00", expr: "0 9 * * *" },
  { label: "Weekdays 09:00", expr: "0 9 * * MON-FRI" },
  { label: "Weekly (Sun)", expr: "0 0 * * 0" },
  { label: "Monthly", expr: "0 0 1 * *" },
  { label: "Every 30s", expr: "@every 30s" }
];

const fieldHelp = [
  { name: "minute", range: "0-59" },
  { name: "hour", range: "0-23" },
  { name: "day", range: "1-31" },
  { name: "month", range: "1-12" },
  { name: "weekday", range: "0-6" }
];

interface Preview {
  valid: boolean;
  error: string;
  next: string[];
}

export function CronBuilder({
  value,
  onChange,
  timezone,
  onTimezoneChange,
  error
}: {
  value: string;
  onChange: (v: string) => void;
  timezone: string;
  onTimezoneChange: (tz: string) => void;
  error?: string;
}) {
  useUIPreferences();
  const [preview, setPreview] = React.useState<Preview | null>(null);
  const [loading, setLoading] = React.useState(false);

  // Debounced server-side validation + next-run preview (exact same parser as the scheduler).
  React.useEffect(() => {
    if (!value.trim()) {
      setPreview(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      api<Preview>("/cron/preview", { method: "POST", body: { expr: value, timezone }, signal: ctrl.signal })
        .then(result => { if (!ctrl.signal.aborted) setPreview(result); })
        .catch(() => { if (!ctrl.signal.aborted) setPreview({valid:false,error:"Could not reach the server to validate this schedule.",next:[]}); })
        .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    }, 300);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [value, timezone]);

  const human = describeCron(value);
  const parts = value.trim().split(/\s+/);
  const isFieldExpr = !value.trim().startsWith("@") && (parts.length === 5 || parts.length === 6);
  const shownParts = parts.length === 6 ? parts.slice(1) : parts;

  return (
    <div className="space-y-5">
      <div className="space-y-2.5">
        <Label className="text-muted-foreground text-xs font-normal">Quick presets</Label>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.expr}
              type="button"
              onClick={() => onChange(p.expr)}
              className={cn(
                "h-8 rounded-full border px-3 text-xs font-medium transition-colors",
                value.trim() === p.expr
                  ? "bg-primary text-primary-foreground border-transparent"
                  : "hover:bg-accent bg-background/40"
              )}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[1fr_240px]">
        <div className="space-y-2">
          <Label htmlFor="schedule">Cron expression</Label>
          <Input
            id="schedule"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="*/5 * * * *"
            spellCheck={false}
            aria-invalid={!!error || preview?.valid === false}
            className="h-11 font-mono text-base tracking-wider"
          />
          {isFieldExpr && (
            <div className="grid grid-cols-5 gap-1.5 text-center">
              {fieldHelp.map((f, i) => (
                <div key={f.name} className="bg-muted/50 rounded-md px-1 py-1.5">
                  <div className="font-mono text-xs font-semibold">{shownParts[i] ?? "·"}</div>
                  <div className="text-muted-foreground text-[10px]">{f.name}</div>
                </div>
              ))}
            </div>
          )}
          <p className="text-muted-foreground text-xs">
            5 fields, 6 fields (leading seconds), or descriptors like <code>@hourly</code>,{" "}
            <code>@every 90s</code>.
          </p>
        </div>
        <div className="space-y-2">
          <Label>Timezone</Label>
          <TimezonePicker value={timezone} onChange={onTimezoneChange} />
        </div>
      </div>

      <div
        className={cn(
          "rounded-xl border p-4 transition-colors",
          preview?.valid === false || error ? "border-destructive/40 bg-destructive/5" : "bg-background/30"
        )}>
        <div className="flex items-start gap-3">
          {loading ? (
            <Spinner className="text-muted-foreground mt-0.5" />
          ) : preview?.valid === false || error ? (
            <AlertCircleIcon className="text-destructive mt-0.5 size-4 shrink-0" />
          ) : (
            <CheckCircle2Icon className="text-status-success mt-0.5 size-4 shrink-0" />
          )}
          <div className="min-w-0 flex-1 space-y-3">
            <div className="text-sm font-medium">
              {preview?.valid === false
                ? preview.error
                : error
                  ? error
                  : human || (value ? "Valid schedule" : "Enter a schedule")}
            </div>
            {preview?.valid && preview.next.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  <CalendarClockIcon className="size-3.5" /> Next runs ({timezone})
                </div>
                <ol className="grid gap-1 sm:grid-cols-2">
                  {preview.next.map((n, i) => (
                    <li key={n} className="flex items-center gap-2 font-mono text-xs">
                      <span className="text-muted-foreground w-4 tabular-nums">{i + 1}.</span>
                      <span>{dateTime(n, { dateStyle: "medium", timeStyle: "medium", timeZone: timezone })}</span>
                      <span className="text-muted-foreground font-sans">· {relativeTime(n)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
