"use client";

import * as React from "react";
import { PlusIcon, Trash2Icon, LockIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Row = { id: number; key: string; value: string };

let seq = 0;
const toRows = (obj?: Record<string, string>): Row[] =>
  Object.entries(obj ?? {}).map(([key, value]) => ({ id: ++seq, key, value }));

/** Editable list of name/value pairs (HTTP headers, env vars). Masked secrets stay masked. */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "NAME",
  valuePlaceholder = "value",
  mask,
  addLabel = "Add"
}: {
  value?: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  mask?: string;
  addLabel?: string;
}) {
  const [rows, setRows] = React.useState<Row[]>(() => toRows(value));

  const emit = (next: Row[]) => {
    setRows(next);
    const obj: Record<string, string> = {};
    for (const r of next) if (r.key.trim()) obj[r.key.trim()] = r.value;
    onChange(obj);
  };

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const masked = !!mask && r.value === mask;
        return (
          <div key={r.id} className="flex items-center gap-2">
            <Input
              value={r.key}
              placeholder={keyPlaceholder}
              className="w-2/5 font-mono text-xs"
              onChange={(e) => emit(rows.map((x) => (x.id === r.id ? { ...x, key: e.target.value } : x)))}
            />
            <div className="relative flex-1">
              <Input
                value={r.value}
                placeholder={valuePlaceholder}
                className="font-mono text-xs"
                type={masked ? "password" : "text"}
                onFocus={(e) => masked && e.currentTarget.select()}
                onChange={(e) => emit(rows.map((x) => (x.id === r.id ? { ...x, value: e.target.value } : x)))}
              />
              {masked && (
                <LockIcon
                  className="text-muted-foreground absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2"
                  aria-label="Secret value is hidden; type to replace it"
                />
              )}
            </div>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Remove"
              onClick={() => emit(rows.filter((x) => x.id !== r.id))}>
              <Trash2Icon />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="bg-background/40"
        onClick={() => setRows([...rows, { id: ++seq, key: "", value: "" }])}>
        <PlusIcon /> {addLabel}
      </Button>
      {mask && rows.some((r) => r.value === mask) && (
        <p className="text-muted-foreground text-xs">
          Values that look like secrets are hidden. Leave them unchanged to keep the stored value.
        </p>
      )}
    </div>
  );
}
