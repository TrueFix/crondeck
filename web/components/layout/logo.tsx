"use client";

import { motion, useReducedMotion as useFramerReduced } from "framer-motion";

import { springSnappy, useMotionOff } from "@/lib/motion";

export default function Logo() {
  const off = useMotionOff() || useFramerReduced();
  return (
    <motion.img
      src="/icon.svg"
      className="me-1 size-8 rounded-[9px] shadow-[0_6px_20px_-6px_var(--chart-1)] transition-all group-data-collapsible:size-6 group-data-[collapsible=icon]:size-8"
      alt="CronDeck logo"
      whileHover={off ? undefined : { scale: 1.06, rotate: -4 }}
      whileTap={off ? undefined : { scale: 0.94 }}
      transition={springSnappy}
    />
  );
}
