"use client";

import * as React from "react";
import { DatabaseZapIcon, Loader2Icon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { api, type SQLConfig, type SqlTestResult } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const DSN_PLACEHOLDER: Record<string, string> = {
  sqlite: "/data/app.db  ·  file:/data/app.db",
  postgres: "postgres://user:pass@host:5432/dbname?sslmode=disable"
};

export function SqlEditor({
  value,
  mask,
  jobId,
  onChange,
  error
}: {
  value: SQLConfig;
  mask?: string;
  jobId?: string;
  onChange: (next: SQLConfig) => void;
  error?: string;
}) {
  const [testing, setTesting] = React.useState(false);
  const [result, setResult] = React.useState<SqlTestResult | null>(null);
  const driver = value.driver ?? "sqlite";
  const dsnMasked = !!mask && value.dsn === mask;

  const set = (patch: Partial<SQLConfig>) => onChange({ ...value, ...patch });

  const runTest = async () => {
    if (!value.query?.trim()) {
      toast.error("Enter a query first");
      return;
    }
    setTesting(true);
    try {
      const res = await api<SqlTestResult>("/sql/preview", {
        method: "POST",
        body: {
          driver,
          dsn: value.dsn,
          query: value.query,
          max_rows: value.max_rows ?? 0,
          job_id: jobId
        }
      });
      setResult(res);
      if (res.error) toast.error("Test failed", { description: res.error });
      else toast.success(`Test ran in ${res.duration_ms}ms (rolled back)`);
    } catch (e) {
      toast.error((e as Error).message);
      setResult(null);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <div className="space-y-2">
          <Label>Database</Label>
          <Select value={driver} onValueChange={(v) => set({ driver: v as SQLConfig["driver"] })}>
            <SelectTrigger className="h-10 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="sqlite">SQLite</SelectItem>
              <SelectItem value="postgres">PostgreSQL</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="sql-dsn">Connection string</Label>
          <Input
            id="sql-dsn"
            value={value.dsn ?? ""}
            type={dsnMasked ? "password" : "text"}
            onFocus={(e) => dsnMasked && e.currentTarget.select()}
            onChange={(e) => set({ dsn: e.target.value })}
            placeholder={DSN_PLACEHOLDER[driver]}
            className="h-10 font-mono text-sm"
            aria-invalid={!!error}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-muted-foreground text-xs">
            {driver === "sqlite"
              ? "Path to the SQLite file on the CronDeck host."
              : "Standard PostgreSQL URL. Stored encrypted and masked after saving."}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="sql-query">SQL</Label>
        <div className="overflow-hidden rounded-xl border bg-black/80 dark:bg-black/40">
          <div className="flex items-center gap-1.5 border-b border-white/10 px-3 py-2">
            <span className="size-2.5 rounded-full bg-red-400/80" />
            <span className="size-2.5 rounded-full bg-amber-400/80" />
            <span className="size-2.5 rounded-full bg-emerald-400/80" />
            <span className="ms-2 font-mono text-[11px] text-white/50">{driver}</span>
          </div>
          <Textarea
            id="sql-query"
            value={value.query ?? ""}
            onChange={(e) => set({ query: e.target.value })}
            placeholder={"DELETE FROM sessions WHERE expires_at < now();\nSELECT count(*) AS active FROM sessions;"}
            spellCheck={false}
            aria-invalid={!!error}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                e.preventDefault();
                const el = e.currentTarget;
                const { selectionStart: s, selectionEnd: en, value: v } = el;
                const next = v.slice(0, s) + "  " + v.slice(en);
                set({ query: next });
                requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
              }
            }}
            className="min-h-48 rounded-none border-0 bg-transparent! font-mono text-sm leading-relaxed text-emerald-100 shadow-none focus-visible:ring-0"
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Runs every statement in order. SELECTs return rows; writes and DDL report rows affected. Separate statements
          with <code className="bg-muted rounded px-1">;</code>.
        </p>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Label htmlFor="sql-maxrows">Max rows captured</Label>
          <Input
            id="sql-maxrows"
            type="number"
            min={0}
            max={10000}
            value={value.max_rows ?? 500}
            onChange={(e) => set({ max_rows: Number(e.target.value) })}
            className="h-9 w-32"
          />
        </div>
        <Button type="button" variant="secondary" disabled={testing || !value.dsn?.trim()} onClick={runTest}>
          {testing ? <Loader2Icon className="size-4 animate-spin" /> : <DatabaseZapIcon className="size-4" />}
          {testing ? "Running…" : "Test run"}
        </Button>
      </div>

      {result && <SqlTestResultView result={result} />}
    </div>
  );
}

function SqlTestResultView({ result }: { result: SqlTestResult }) {
  return (
    <div className="bg-muted/30 space-y-3 rounded-xl border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Test result</div>
        {result.rolled_back && (
          <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
            <TriangleAlertIcon className="size-3.5" />
            Dry run — rolled back, nothing was saved
          </span>
        )}
      </div>

      {result.error && result.statements.length === 0 && (
        <p className="text-destructive text-sm">{result.error}</p>
      )}

      <div className="space-y-3">
        {result.statements.map((st, i) => (
          <div key={i} className="space-y-1.5">
            <div className="text-muted-foreground truncate font-mono text-[11px]">
              {result.statements.length > 1 ? `${i + 1}. ` : ""}
              {st.sql}
            </div>
            {st.error ? (
              <p className="text-destructive text-xs">{st.error}</p>
            ) : st.kind === "rows" ? (
              <div className="space-y-1">
                <div className="max-h-64 overflow-auto rounded-lg border">
                  <table className="w-full border-collapse font-mono text-[11px]">
                    <thead className="bg-muted/60 sticky top-0">
                      <tr>
                        {(st.columns ?? []).map((c) => (
                          <th key={c} className="border-b px-2 py-1 text-left font-semibold">
                            {c}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(st.rows ?? []).map((row, ri) => (
                        <tr key={ri} className={cn(ri % 2 === 1 && "bg-muted/20")}>
                          {row.map((cell, ci) => (
                            <td key={ci} className="border-b px-2 py-1 align-top break-all whitespace-pre-wrap">
                              {cell === "NULL" ? <span className="text-muted-foreground italic">NULL</span> : cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-muted-foreground text-xs">
                  {st.row_count} row{st.row_count === 1 ? "" : "s"}
                  {st.truncated && " (truncated)"}
                </p>
              </div>
            ) : (
              <p className="text-status-success text-xs">{st.rows_affected} row(s) affected</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
