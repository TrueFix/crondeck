"use client";

import Link from "next/link";
import { LogOutIcon, ScrollTextIcon, SettingsIcon, ShieldCheckIcon } from "lucide-react";
import useSWR from "swr";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { logout } from "@/components/crondeck/auth-guard";
import type { Meta } from "@/lib/api";

export default function UserMenu() {
  const { data: meta } = useSWR<Meta>("/meta");


  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full" aria-label="Account menu">
          <Avatar>
            <AvatarFallback className="from-chart-1 to-chart-4 bg-linear-to-br text-xs font-semibold text-white">
              AD
            </AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" align="end">
        <DropdownMenuLabel className="p-0">
          <div className="flex items-center gap-3 px-1.5 py-2 text-left text-sm">
            <Avatar className="size-9">
              <AvatarFallback className="from-chart-1 to-chart-4 bg-linear-to-br text-xs font-semibold text-white">
                AD
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">Administrator</span>
              <span className="text-muted-foreground truncate text-xs">Signed in with admin key</span>
            </div>
            <Badge variant="secondary">v{meta?.version ?? "1"}</Badge>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/settings/">
              <SettingsIcon className="text-muted-foreground" />
              Settings
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/audit/">
              <ScrollTextIcon className="text-muted-foreground" />
              Audit log
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <ShieldCheckIcon className="text-muted-foreground" />
            Shell jobs {meta?.allow_shell ? "enabled" : "disabled"}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()}>
          <LogOutIcon className="text-muted-foreground" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
