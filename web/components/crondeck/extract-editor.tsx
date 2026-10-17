"use client";

import * as React from "react";
import { CheckIcon, PlusIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";

import type { HttpExtractHint, HttpPreviewResult } from "@/lib/api";
import {
  composePath,
  dottedToField,
  evaluateExtractPath,
  parsePath,
  type ExtractSource
} from "@/lib/http-extract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Row = { id: number; name: string; source: ExtractSource; field: string; missing: string };

let seq = 0;

function toRows(extract?: Record<string, string>, missing?: Record<string, string>): Row[] {
  return Object.entries(extract ?? {}).map(([name, path]) => {
    const { source, field } = parsePath(path);
    return { id: ++seq, name, source, field, missing: missing?.[name] ?? "fail" };
  });
}

function truncate(v: string, n = 60): string {
  return v.length > n ? v.slice(0, n) + "…" : v;
}

const SOURCE_LABELS: Record<ExtractSource, string> = {
  json: "JSON field",
  header: "Header",
  raw: "Whole body"
};

const FIELD_PLACEHOLDER: Record<ExtractSource, string> = {
  json: "client_ip  ·  data.items[0].id",
  header: "x-request-id",
  raw: ""
};

/**
 * Editor for a step's extract rules. Each rule names a variable, chooses where
 * the value comes from (JSON field / header / whole body), shows the live
 * resolved value from the last test response, and decides what happens when the
 * value is missing.
 */
export function ExtractEditor({
  extract,
  extractMissing,
  onChange,
  preview
}: {
  extract?: Record<string, string>;
  extractMissing?: Record<string, string>;
  onChange: (extract: Record<string, string> | undefined, missing: Record<string, string> | undefined) => void;
  preview?: HttpPreviewResult | null;
}) {
  const [rows, setRows] = React.useState<Row[]>(() => toRows(extract, extractMissing));

  const emit = (next: Row[]) => {
    setRows(next);
    const ex: Record<string, string> = {};
    const miss: Record<string, string> = {};
    for (const r of next) {
      const name = r.name.trim();
      if (!name) continue;
      ex[name] = composePath({ source: r.source, field: r.field });
      if (r.missing && r.missing !== "fail") miss[name] = r.missing;
    }
    onChange(Object.keys(ex).length ? ex : undefined, Object.keys(miss).length ? miss : undefined);
  };

  const patch = (id: number, p: Partial<Row>) => emit(rows.map((r) => (r.id === id ? { ...r, ...p } : r)));

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <ExtractRow
          key={r.id}
          row={r}
          preview={preview}
          onChange={(p) => patch(r.id, p)}
          onRemove={() => emit(rows.filter((x) => x.id !== r.id))}
        />
      ))}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="bg-background/40"
        onClick={() => emit([...rows, { id: ++seq, name: "", source: "json", field: "", missing: "fail" }])}>
        <PlusIcon /> Add mapping
      </Button>
    </div>
  );
}

function ExtractRow({
  row,
  preview,
  onChange,
  onRemove
}: {
  row: Row;
  preview?: HttpPreviewResult | null;
  onChange: (p: Partial<Row>) => void;
  onRemove: () => void;
}) {
  const path = composePath({ source: row.source, field: row.field });

  const evaluation = React.useMemo(() => {
    if (row.source !== "raw" && !row.field.trim()) return null;
    if (!preview || preview.status <= 0) return null;
    return evaluateExtractPath(preview, path);
  }, [preview, path, row.source, row.field]);

  // Suggestions for the current source, with the prefix stripped to friendly form.
  const suggestions = React.useMemo<Suggestion[]>(() => {
    const hints = preview?.hints ?? [];
    if (row.source === "json") {
      return hints
        .filter((h) => h.path.toLowerCase().startsWith("body.json."))
        .map((h) => ({ display: dottedToField(h.path.slice("body.json.".length)), hint: h }));
    }
    if (row.source === "header") {
      return hints
        .filter((h) => h.path.toLowerCase().startsWith("headers."))
        .map((h) => ({ display: h.path.slice("headers.".length), hint: h }));
    }
    return [];
  }, [preview, row.source]);

  return (
    <div className="bg-background/40 space-y-2 rounded-lg border p-2.5">
      <div className="flex items-center gap-2">
        <Input
          value={row.name}
          placeholder="variable"
          className="w-36 font-mono text-xs"
          onChange={(e) => onChange({ name: e.target.value })}
        />
        <Select value={row.source} onValueChange={(v) => onChange({ source: v as ExtractSource })}>
          <SelectTrigger className="h-9 w-32 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SOURCE_LABELS) as ExtractSource[]).map((s) => (
              <SelectItem key={s} value={s} className="text-xs">
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {row.source === "raw" ? (
          <div className="text-muted-foreground flex-1 px-1 text-xs italic">entire response body</div>
        ) : (
          <FieldAutocomplete
            value={row.field}
            placeholder={FIELD_PLACEHOLDER[row.source]}
            suggestions={suggestions}
            onChange={(field) => onChange({ field })}
            onSelect={(s) => onChange({ field: s.display, name: row.name.trim() || s.hint.variable_suggestion || row.name })}
          />
        )}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove mapping" onClick={onRemove}>
          <Trash2Icon />
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pl-1">
        <div className="min-w-0 flex-1 text-xs">
          {evaluation === null ? (
            <span className="text-muted-foreground">Run a test request to preview the value.</span>
          ) : evaluation.found ? (
            <span className="text-status-success inline-flex max-w-full items-center gap-1">
              <CheckIcon className="size-3.5 shrink-0" />
              <span className="truncate font-mono">= {truncate(evaluation.value ?? "")}</span>
              {evaluation.uncertain && <span className="text-muted-foreground shrink-0">(truncated)</span>}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-500">
              <TriangleAlertIcon className="size-3.5 shrink-0" />
              Not found{evaluation.error ? ` (${evaluation.error})` : ""} →{" "}
              {row.missing === "empty"
                ? "uses empty string"
                : row.missing === "null"
                  ? 'uses "null"'
                  : "step fails"}
            </span>
          )}
        </div>
        <label className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
          If missing
          <Select value={row.missing} onValueChange={(missing) => onChange({ missing })}>
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fail" className="text-xs">Fail the step</SelectItem>
              <SelectItem value="empty" className="text-xs">Empty string</SelectItem>
              <SelectItem value="null" className="text-xs">Use &quot;null&quot;</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  );
}

type Suggestion = { display: string; hint: HttpExtractHint };

function FieldAutocomplete({
  value,
  placeholder,
  suggestions,
  onChange,
  onSelect
}: {
  value: string;
  placeholder?: string;
  suggestions: Suggestion[];
  onChange: (v: string) => void;
  onSelect: (s: Suggestion) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  const matches = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    const filtered = q
      ? suggestions.filter((s) => s.display.toLowerCase().startsWith(q) || s.display.toLowerCase().includes(q))
      : suggestions;
    return [...filtered]
      .sort((a, b) => {
        const ap = a.display.toLowerCase().startsWith(q) ? 0 : 1;
        const bp = b.display.toLowerCase().startsWith(q) ? 0 : 1;
        return ap - bp;
      })
      .slice(0, 20);
  }, [suggestions, value]);

  React.useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const choose = (s: Suggestion) => {
    onSelect(s);
    setOpen(false);
  };

  const showDropdown = open && matches.length > 0;

  return (
    <div ref={wrapRef} className="relative flex-1">
      <Input
        value={value}
        placeholder={placeholder}
        className="font-mono text-xs"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!showDropdown) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(matches[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {showDropdown && (
        <ul className="bg-popover absolute z-50 mt-1 max-h-56 w-full min-w-72 overflow-auto rounded-md border p-1 shadow-md">
          {matches.map((s, i) => (
            <li key={s.hint.path}>
              <button
                type="button"
                className={cn(
                  "hover:bg-accent flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left",
                  i === active && "bg-accent"
                )}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(s);
                }}>
                <span className="font-mono text-[11px]">{s.display}</span>
                {s.hint.preview_value && (
                  <span className="text-muted-foreground truncate font-mono text-[10px]">
                    = {truncate(s.hint.preview_value)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
