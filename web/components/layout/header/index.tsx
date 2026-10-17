"use client";

import { PlusIcon, SearchIcon } from "lucide-react";
import Link from "next/link";

import { Separator } from "@/components/ui/separator";
import Notifications from "@/components/layout/header/notifications";
import ThemeSwitch from "@/components/layout/header/theme-switch";
import UserMenu from "@/components/layout/header/user-menu";
import { Button } from "@/components/ui/button";
import { LiveRuns } from "@/components/layout/header/live-runs";
import { useOpenSearch } from "@/components/crondeck/search-provider";
import { SidebarToggle } from "@/components/layout/header/sidebar-toggle";
import { IconToolbarButton } from "@/components/layout/header/icon-toolbar-button";
import { HeaderEnter } from "@/components/layout/header/header-motion";

export function SiteHeader() {
  const openSearch = useOpenSearch();

  return (
    <header className="bg-background/80 z-50 flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height) md:rounded-tl-xl md:rounded-tr-xl">
      <div className="flex w-full min-w-0 items-center gap-2 px-3 sm:px-4 lg:gap-3">
        <SidebarToggle />
        <HeaderEnter className="min-w-0 flex-1">
          <LiveRuns />
        </HeaderEnter>

        <HeaderEnter className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <IconToolbarButton className="md:hidden" onClick={openSearch} aria-label="Search jobs and actions">
            <SearchIcon />
          </IconToolbarButton>
          <Button size="sm" className="hidden sm:inline-flex" asChild>
            <Link href="/jobs/new/">
              <PlusIcon /> New job
            </Link>
          </Button>
          <Notifications />
          <ThemeSwitch />
          <Separator
            orientation="vertical"
            className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
          />
          <UserMenu />
        </HeaderEnter>
      </div>
    </header>
  );
}
