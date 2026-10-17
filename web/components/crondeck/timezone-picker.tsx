"use client";

import * as React from "react";
import { CheckIcon, ChevronsUpDownIcon, GlobeIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

function allTimezones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone");
    if (list?.length) return list.includes("UTC") ? list : ["UTC", ...list];
  } catch {
    /* ignore */
  }
  return ["UTC", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Kolkata", "Asia/Tokyo"];
}

function offsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

export function TimezonePicker({ value, onChange }: { value: string; onChange: (tz: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const zones = React.useMemo(() => allTimezones(), []);
  const local = React.useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" aria-expanded={open} className="bg-background/40 h-11 w-full justify-between font-normal">
          <span className="flex min-w-0 items-center gap-2">
            <GlobeIcon className="text-muted-foreground" />
            <span className="truncate">{value}</span>
          </span>
          <span className="text-muted-foreground flex items-center gap-1 text-xs">
            {offsetLabel(value)}
            <ChevronsUpDownIcon className="size-4 opacity-50" />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search timezone…" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>No timezone found.</CommandEmpty>
            <CommandGroup heading="Suggested">
              {Array.from(new Set(["UTC", local])).filter((tz) => tz.toLowerCase().includes(search.toLowerCase())).map((tz) => (
                <CommandItem key={`s-${tz}`} value={`suggested ${tz}`} onSelect={() => { onChange(tz); setOpen(false); }}>
                  <CheckIcon className={cn(value === tz ? "opacity-100" : "opacity-0")} />
                  {tz}
                  <span className="text-muted-foreground ms-auto text-xs">{tz === local ? "local" : offsetLabel(tz)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="All timezones">
              {zones.filter((tz) => tz.toLowerCase().includes(search.toLowerCase())).slice(0, 50).map((tz) => (
                <CommandItem key={tz} value={tz} onSelect={() => { onChange(tz); setOpen(false); }}>
                  <CheckIcon className={cn(value === tz ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{tz}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
