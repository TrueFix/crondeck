import cronstrue from "cronstrue";
import { getPreferences, displayTimezone } from "@/lib/ui-preferences";

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  if (getPreferences().timestamps === "exact") return dateTime(iso);
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 365 * 24 * 3600e3],
    ["month", 30 * 24 * 3600e3],
    ["week", 7 * 24 * 3600e3],
    ["day", 24 * 3600e3],
    ["hour", 3600e3],
    ["minute", 60e3],
    ["second", 1e3]
  ];
  for (const [unit, ms] of units) {
    if (abs >= ms || unit === "second") {
      const v = Math.round(diff / ms);
      if (unit === "second" && Math.abs(v) < 5) return diff >= 0 ? "in a moment" : "just now";
      return rtf.format(v, unit);
    }
  }
  return "—";
}

export function dateTime(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    hourCycle: getPreferences().clock === "12" ? "h12" : "h23", timeZone: displayTimezone(),
    ...(opts ?? { dateStyle: "medium", timeStyle: "medium" })
  });
}

export function shortTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTime(iso, { hour: "2-digit", minute: "2-digit" });
}

export function duration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 2 : 1)}s`;
  const m = Math.floor(s / 60);
  const rs = Math.round(s % 60);
  if (m < 60) return `${m}m ${rs}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function percent(v: number, digits = 1): string {
  return `${(Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits)}%`;
}

export function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Human readable cron description; falls back gracefully on invalid input. */
export function describeCron(expr: string): string {
  const e = expr.trim();
  if (!e) return "";
  if (e.startsWith("@every ")) return `Every ${e.slice(7).trim()}`;
  if (e === "@dependency") return "After upstream jobs succeed";
  const descriptors: Record<string, string> = {
    "@yearly": "Once a year, at midnight on Jan 1",
    "@annually": "Once a year, at midnight on Jan 1",
    "@monthly": "Once a month, at midnight on the 1st",
    "@weekly": "Once a week, at midnight on Sunday",
    "@daily": "Every day at midnight",
    "@midnight": "Every day at midnight",
    "@hourly": "Every hour, on the hour"
  };
  if (descriptors[e]) return descriptors[e];
  try {
    return cronstrue.toString(e, { use24HourTimeFormat: getPreferences().clock === "24", verbose: false });
  } catch {
    return "";
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
