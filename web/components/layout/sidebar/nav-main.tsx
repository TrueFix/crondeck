"use client";

import { motion, useReducedMotion as useFramerReduced } from "framer-motion";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem
} from "@/components/ui/sidebar";
import { fadeUp, springSoft, staggerContainer, useReducedMotion } from "@/lib/motion";
import {
  CalendarClockIcon,
  GaugeIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  ListChecksIcon,
  PlusCircleIcon,
  ScrollTextIcon,
  SettingsIcon,
  type LucideIcon
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import useSWR from "swr";
import type { Overview } from "@/lib/api";

type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: "jobs" | "failing";
};

type NavGroup = { title: string; items: NavItem[] };

export const navItems: NavGroup[] = [
  {
    title: "Monitor",
    items: [
      { title: "Overview", href: "/", icon: GaugeIcon },
      { title: "Run history", href: "/runs/", icon: HistoryIcon, badge: "failing" },
      { title: "Calendar", href: "/calendar/", icon: CalendarClockIcon }
    ]
  },
  {
    title: "Manage",
    items: [
      { title: "Jobs", href: "/jobs/", icon: ListChecksIcon, badge: "jobs" },
      { title: "New job", href: "/jobs/new/", icon: PlusCircleIcon },
      { title: "Templates", href: "/templates/", icon: LayoutTemplateIcon }
    ]
  },
  {
    title: "System",
    items: [
      { title: "Audit log", href: "/audit/", icon: ScrollTextIcon },
      { title: "Settings", href: "/settings/", icon: SettingsIcon }
    ]
  }
];

function isActive(pathname: string, href: string) {
  const p = pathname.endsWith("/") ? pathname : pathname + "/";
  if (href === "/") return p === "/";
  if (href === "/jobs/") return p === "/jobs/" || p.startsWith("/jobs/view") || p.startsWith("/jobs/edit");
  return p.startsWith(href);
}

export function NavMain() {
  const pathname = usePathname();
  const { data: overview } = useSWR<Overview>("/stats/overview");
  const reduced = useReducedMotion() || useFramerReduced();

  const badgeValue = (b?: NavItem["badge"]) => {
    if (!overview || !b) return null;
    if (b === "jobs") return overview.total_jobs || null;
    if (b === "failing") return overview.failing_jobs || null;
    return null;
  };

  return (
    <motion.div
      key={pathname}
      variants={staggerContainer(0.035, 0.05)}
      initial={reduced ? false : "hidden"}
      animate="show">
      {navItems.map((nav, groupIndex) => (
        <SidebarGroup key={nav.title} className="px-3 py-1 group-data-[collapsible=icon]:px-2">
          <SidebarGroupLabel className="mb-1 h-6 px-3 text-[10px] font-semibold tracking-[.14em] uppercase">{nav.title}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {nav.items.map((item, itemIndex) => {
                const badge = badgeValue(item.badge);
                const active = isActive(pathname, item.href);
                return (
                  <SidebarMenuItem key={item.title}>
                    <motion.div
                      variants={fadeUp}
                      className="contents"
                      transition={reduced ? { duration: 0 } : { ...springSoft, delay: groupIndex * 0.04 + itemIndex * 0.02 }}>
                      <SidebarMenuButton
                        className="relative h-10 gap-3 rounded-xl px-3 transition-[background-color,transform]"
                        isActive={active}
                        tooltip={item.title}
                        asChild>
                        <Link href={item.href} aria-current={active ? "page" : undefined}>
                          {active && (
                            <motion.span
                              layoutId="sidebar-active"
                              className="bg-primary/12 absolute inset-0 rounded-xl ring-1 ring-primary/25"
                              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 34 }}
                            />
                          )}
                          <item.icon className="relative z-10" />
                          <span className="relative z-10">{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                      {badge !== null && (
                        <SidebarMenuBadge
                          className={
                            item.badge === "failing"
                              ? "top-1/2 right-3 -translate-y-1/2 text-status-failed bg-status-failed/12 rounded-full peer-hover/menu-button:text-status-failed"
                              : "top-1/2 right-3 -translate-y-1/2 peer-hover/menu-button:text-foreground"
                          }>
                          {badge}
                        </SidebarMenuBadge>
                      )}
                    </motion.div>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </motion.div>
  );
}
