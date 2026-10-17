"use client";

import { MenuIcon, XIcon } from "lucide-react";
import { motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { useSidebar } from "@/components/ui/sidebar";
import { springSnappy, useMotionDisabled } from "@/lib/motion";

export function SidebarToggle({ className }: { className?: string }) {
  const { toggleSidebar, open, openMobile, isMobile } = useSidebar();
  const sidebarOpen = isMobile ? openMobile : open;
  const reduced = useMotionDisabled();

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
      aria-expanded={sidebarOpen}
      className={cn(
        "relative inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-border/70 bg-background/80 shadow-sm",
        "text-foreground transition-colors hover:bg-muted/80 active:scale-[0.97]",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        className
      )}>
      <motion.span
        className="relative flex size-5 items-center justify-center"
        initial={false}
        animate={{ rotate: sidebarOpen ? 90 : 0 }}
        transition={reduced ? { duration: 0 } : springSnappy}>
        <motion.span
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: sidebarOpen ? 0 : 1, scale: sidebarOpen ? 0.6 : 1 }}
          transition={reduced ? { duration: 0 } : { duration: 0.16 }}>
          <MenuIcon className="size-5" strokeWidth={2.25} />
        </motion.span>
        <motion.span
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: sidebarOpen ? 1 : 0, scale: sidebarOpen ? 1 : 0.6 }}
          transition={reduced ? { duration: 0 } : { duration: 0.16 }}>
          <XIcon className="size-5" strokeWidth={2.25} />
        </motion.span>
      </motion.span>
    </button>
  );
}
