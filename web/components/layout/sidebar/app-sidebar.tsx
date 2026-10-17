"use client";

import * as React from "react";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar
} from "@/components/ui/sidebar";
import { NavMain } from "@/components/layout/sidebar/nav-main";
import Search from "@/components/layout/sidebar/search";
import Logo from "@/components/layout/logo";
import { Card, CardContent, CardDescription, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useEventConnection } from "@/components/crondeck/event-stream";
import { StatusOrb } from "@/components/crondeck/status";
import type { Overview } from "@/lib/api";
import { percent } from "@/lib/format";
import { MotionPanel } from "@/components/crondeck/motion-shell";
import { motion, useReducedMotion as useFramerReduced } from "framer-motion";
import { springSoft, useMotionOff } from "@/lib/motion";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname();
  const { setOpenMobile, isMobile } = useSidebar();
  const connected = useEventConnection();
  const { data: overview } = useSWR<Overview>("/stats/overview");

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const rate = overview?.success_rate_24h ?? 0;
  const motionOff = useMotionOff() || useFramerReduced();

  return (
    <Sidebar
      collapsible="icon"
      variant="inset"
      {...props}>
      <SidebarHeader className="gap-4 px-3 pb-4 pt-4 group-data-[collapsible=icon]:px-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="hover:text-foreground h-11 gap-3 px-2 group-data-[collapsible=icon]:px-0!">
              <Link href="/">
                <Logo />
                <span className="text-foreground flex flex-col leading-tight group-data-[collapsible=icon]:hidden">
                  <span className="font-display text-base tracking-tight">CronDeck</span>
                  <span className="text-muted-foreground text-[9px] font-medium tracking-[.2em] uppercase">Automation studio</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <Search />
      </SidebarHeader>
      <SidebarContent className="gap-2 pb-4">
        <NavMain />
      </SidebarContent>
      <SidebarFooter className="px-3 pb-3 pt-2 group-data-[collapsible=icon]:hidden">
        <MotionPanel>
        <Card className="overflow-hidden py-0 group-data-[collapsible=icon]:hidden">
          <CardContent className="space-y-3 p-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Scheduler</CardTitle>
              <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <StatusOrb status={connected ? "success" : "failed"} pulse={false} className="size-1.5" />
                {connected ? "Live" : "Reconnecting"}
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between text-xs">
                <CardDescription>24h success rate</CardDescription>
                <span className="font-medium tabular-nums">{overview?.runs_24h ? percent(rate) : "—"}</span>
              </div>
              <motion.div
                initial={false}
                animate={{ opacity: 1 }}
                key={overview?.runs_24h ?? 0}
                transition={motionOff ? { duration: 0 } : springSoft}>
                <Progress value={rate} className="h-1.5" />
              </motion.div>
            </div>
            <CardDescription className="text-xs">
              {overview ? `${overview.enabled_jobs} of ${overview.total_jobs} jobs active` : "Loading…"}
            </CardDescription>
          </CardContent>
        </Card>
        </MotionPanel>
      </SidebarFooter>
    </Sidebar>
  );
}
