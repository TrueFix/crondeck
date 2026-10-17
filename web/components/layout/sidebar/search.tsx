"use client";

import { SearchIcon } from "lucide-react";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { Kbd } from "@/components/ui/kbd";
import { useOpenSearch } from "@/components/crondeck/search-provider";

export default function Search() {
  const open = useOpenSearch();
  return <>
    <button id="sidebar-search" type="button" onClick={open}
      aria-label="Search jobs and actions" title="Search jobs and actions (Ctrl/⌘ K)"
      className="flex h-10 w-full items-center gap-2.5 rounded-xl border bg-background/35 px-3 text-left text-sm transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring group-data-[collapsible=icon]:hidden">
      <SearchIcon className="text-muted-foreground size-4 shrink-0" />
      <span className="text-muted-foreground min-w-0 flex-1 truncate">Search anything</span>
      <Kbd className="shrink-0">⌘ K</Kbd>
    </button>
    <SidebarMenu className="hidden group-data-[collapsible=icon]:flex">
      <SidebarMenuItem><SidebarMenuButton tooltip="Search (Ctrl/⌘ K)" onClick={open}>
        <SearchIcon /><span>Search</span>
      </SidebarMenuButton></SidebarMenuItem>
    </SidebarMenu>
  </>;
}
