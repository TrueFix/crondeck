"use client";

import * as React from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { ALL_HTTP_STATUS_PRESETS, HTTP_STATUS_GROUPS, presetLabel } from "@/lib/http-status-codes";

export function HttpStatusPicker({
  value,
  onChange,
  id,
  className
}: {
  value: number[];
  onChange: (codes: number[]) => void;
  id?: string;
  className?: string;
}) {
  const selected = React.useMemo(() => new Set(value), [value]);
  const toggle = (code: number) => {
    const next = new Set(selected);
    if (next.has(code)) next.delete(code);
    else next.add(code);
    onChange([...next].sort((a, b) => a - b));
  };

  const summary =
    value.length === 0
      ? "Any 2xx (default)"
      : value.length <= 3
        ? value.map((c) => `${c} ${presetLabel(c)}`).join(", ")
        : `${value.length} codes selected`;

  return (
    <div className={cn("space-y-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            className="h-10 w-full justify-between font-normal">
            <span className="truncate text-left">{summary}</span>
            <ChevronDownIcon className="text-muted-foreground size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <div className="flex flex-wrap gap-2 border-b p-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => onChange([])}>
              Any 2xx
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onChange([200])}>
              200 only
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onChange([200, 201, 204])}>
              200 / 201 / 204
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto p-2">
            {HTTP_STATUS_GROUPS.map((group) => (
              <div key={group.title} className="mb-2">
                <p className="text-muted-foreground px-2 py-1 text-[10px] font-semibold tracking-wide uppercase">
                  {group.title}
                </p>
                <ul className="space-y-0.5">
                  {group.codes.map((item) => (
                    <li key={item.code}>
                      <label className="hover:bg-muted/60 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5">
                        <Checkbox checked={selected.has(item.code)} onCheckedChange={() => toggle(item.code)} />
                        <span className="font-mono text-xs font-semibold tabular-nums">{item.code}</span>
                        <span className="text-sm">{item.label}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((code) => (
            <Badge key={code} variant="secondary" className="gap-1 font-mono tabular-nums">
              {code}
              <button
                type="button"
                className="hover:bg-foreground/10 rounded-sm p-0.5"
                aria-label={`Remove ${code}`}
                onClick={() => toggle(code)}>
                <XIcon className="size-3 opacity-60" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Label className="text-muted-foreground text-xs font-normal">
        Leave empty to accept any status from 200–299. Pick explicit codes for redirects or idempotent 404 checks.
      </Label>
    </div>
  );
}

/** Hidden export for tests / docs */
export { ALL_HTTP_STATUS_PRESETS };
