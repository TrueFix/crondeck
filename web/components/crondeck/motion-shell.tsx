"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, type HTMLMotionProps } from "framer-motion";

import {
  fadeUp,
  motionProps,
  pageTransition,
  pageTransitionRich,
  popIn,
  springSnappy,
  springSoft,
  staggerContainer,
  useMotionDisabled
} from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

/** Cross-fade + slide when navigating between app routes. */
export function RouteMotion({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const off = useMotionDisabled();
  const mobile = useIsMobile();
  const variants = off || mobile ? pageTransition : pageTransitionRich;

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        className="min-w-0"
        variants={variants}
        initial={off ? false : "hidden"}
        animate="show"
        exit={off ? undefined : "exit"}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function PageMotion({ className, children }: { className?: string; children: React.ReactNode }) {
  const off = useMotionDisabled();

  return (
    <motion.div
      className={cn(className)}
      variants={staggerContainer(0.06, 0.04)}
      initial={off ? false : "hidden"}
      animate="show"
      {...motionProps(!!off)}>
      {children}
    </motion.div>
  );
}

export function MotionBlock({
  className,
  children,
  delay = 0
}: {
  className?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  const off = useMotionDisabled();

  return (
    <motion.div
      className={className}
      variants={fadeUp}
      initial={off ? false : "hidden"}
      animate="show"
      transition={off ? { duration: 0 } : { delay, type: "spring", stiffness: 360, damping: 30 }}>
      {children}
    </motion.div>
  );
}

/** Stagger children that use `fadeUp` / `popIn` variants. */
export function MotionGrid({ className, children }: { className?: string; children: React.ReactNode }) {
  const off = useMotionDisabled();
  return (
    <motion.div
      className={className}
      variants={staggerContainer(0.07, 0.02)}
      initial={off ? false : "hidden"}
      animate="show">
      {children}
    </motion.div>
  );
}

export function MotionGridItem({
  className,
  children,
  ...props
}: HTMLMotionProps<"div"> & { children: React.ReactNode }) {
  const off = useMotionDisabled();
  return (
    <motion.div
      className={className}
      variants={popIn}
      whileHover={off ? undefined : { y: -3, transition: springSnappy }}
      whileTap={off ? undefined : { scale: 0.985 }}
      {...props}>
      {children}
    </motion.div>
  );
}

export function MotionPanel({ className, children }: { className?: string; children: React.ReactNode }) {
  const off = useMotionDisabled();
  return (
    <motion.div
      className={className}
      variants={popIn}
      initial={off ? false : "hidden"}
      animate="show"
      transition={off ? { duration: 0 } : springSoft}>
      {children}
    </motion.div>
  );
}

/** Mobile floating sidebar inner panel. */
export function MobileSidebarMotion({
  children,
  className,
  ...props
}: HTMLMotionProps<"div"> & { children: React.ReactNode }) {
  const off = useMotionDisabled();
  return (
    <motion.div
      className={className}
      initial={off ? false : { opacity: 0, x: -18, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      transition={off ? { duration: 0 } : springSoft}
      {...props}>
      {children}
    </motion.div>
  );
}
