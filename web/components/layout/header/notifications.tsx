"use client";

import * as React from "react";
import { BellIcon, ClockIcon } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";
import { useIsMobile } from "@/hooks/use-mobile";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { IconToolbarButton } from "@/components/layout/header/icon-toolbar-button";
import type { Page, Run } from "@/lib/api";
import { relativeTime } from "@/lib/format";
import { StatusBadge } from "@/components/crondeck/status";
import { useUIPreferences } from "@/hooks/use-ui-preferences";

/** Recent failures feed (failed + timed-out runs in the last 24h). */
const Notifications = () => {
  useUIPreferences();
  const isMobile = useIsMobile();
  // Stable key for the lifetime of the header (SSE revalidation keeps it fresh).
  const [since] = React.useState(() => new Date(Date.now() - 24 * 3600e3).toISOString().slice(0, 19) + "Z");
  const { data: failed } = useSWR<Page<Run>>(`/runs?status=failed&per_page=10&from=${encodeURIComponent(since)}`);
  const { data: timeouts } = useSWR<Page<Run>>(`/runs?status=timeout&per_page=10&from=${encodeURIComponent(since)}`);
  const items = [...(failed?.items ?? []), ...(timeouts?.items ?? [])]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 12);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconToolbarButton className="relative" aria-label="Recent failures">
          <BellIcon />
          {items.length > 0 && (
            <span className="bg-destructive absolute end-0.5 top-0.5 block size-1.5 shrink-0 rounded-full"></span>
          )}
        </IconToolbarButton>
      </DropdownMenuTrigger>

      <DropdownMenuContent align={isMobile ? "center" : "end"} className="ms-4 w-80 p-0">
        <DropdownMenuLabel className="sticky top-0 z-10 p-0">
          <div className="flex justify-between border-b px-6 py-4">
            <div className="font-medium">Failures · last 24h</div>
            <Button variant="link" className="h-auto p-0 text-xs" size="icon-sm" asChild>
              <Link href="/runs/?status=failed">View all</Link>
            </Button>
          </div>
        </DropdownMenuLabel>

        {items.length === 0 ? (
          <div className="text-muted-foreground px-6 py-10 text-center text-sm">
            No failures. Everything is ticking along nicely.
          </div>
        ) : (
          <ScrollArea className="h-[350px]">
            {items.map((item) => (
              <DropdownMenuItem key={item.id} asChild className="group flex cursor-pointer items-start gap-3 rounded-none border-b px-4 py-3">
                <Link href={`/runs/?run=${item.id}`}>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.job_name}</span>
                      <StatusBadge status={item.status} className="h-5 px-2" />
                    </div>
                    <div className="text-muted-foreground line-clamp-1 text-xs">{item.error || "No error message"}</div>
                    <div className="text-muted-foreground flex items-center gap-1 text-xs">
                      <ClockIcon className="size-3!" />
                      {relativeTime(item.created_at)}
                    </div>
                  </div>
                </Link>
              </DropdownMenuItem>
            ))}
          </ScrollArea>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default Notifications;
