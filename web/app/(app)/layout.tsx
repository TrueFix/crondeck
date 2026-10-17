"use client";

import React from "react";

import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/layout/sidebar/app-sidebar";
import { SiteHeader } from "@/components/layout/header";
import { AuthGuard } from "@/components/crondeck/auth-guard";
import { EventStreamProvider } from "@/components/crondeck/event-stream";
import { SearchProvider } from "@/components/crondeck/search-provider";
import { PageMotion, RouteMotion } from "@/components/crondeck/motion-shell";

function readSidebarCookie(): boolean {
  if (typeof document === "undefined") return true;
  const m = document.cookie.match(/(?:^|;\s*)sidebar_state=(true|false)/);
  return m ? m[1] === "true" : true;
}

export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [open, setOpen] = React.useState(true);
  React.useEffect(() => setOpen(readSidebarCookie()), []);

  return (
    <AuthGuard>
      <EventStreamProvider>
        <SidebarProvider
          className="spatial-workspace min-w-0"
          open={open}
          onOpenChange={setOpen}
          style={
            {
              "--sidebar-width": "calc(var(--spacing) * 64)",
              "--content-full-height":
                "calc(100svh - var(--header-height) - (var(--content-padding) * 2) - env(safe-area-inset-bottom, 0px))"
            } as React.CSSProperties
          }>
          <SearchProvider>
          <AppSidebar />
          <SidebarInset className="min-w-0 overflow-hidden">
            <SiteHeader />
            <div
              data-slot="app-scroll"
              className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain">
              <div className="@container/main min-w-0 p-(--content-padding) pb-[max(var(--content-padding),env(safe-area-inset-bottom,0px))] xl:group-data-[theme-content-layout=centered]/layout:mx-auto xl:group-data-[theme-content-layout=centered]/layout:w-full xl:group-data-[theme-content-layout=centered]/layout:max-w-7xl">
                <RouteMotion>
                  <PageMotion>{children}</PageMotion>
                </RouteMotion>
              </div>
            </div>
          </SidebarInset>
          </SearchProvider>
        </SidebarProvider>
      </EventStreamProvider>
    </AuthGuard>
  );
}
