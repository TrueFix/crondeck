"use client";

import { motion } from "framer-motion";

import { fadeIn, springSoft, useMotionDisabled } from "@/lib/motion";

export function HeaderEnter({ children, className }: { children: React.ReactNode; className?: string }) {
  const off = useMotionDisabled();
  return (
    <motion.div
      className={className}
      variants={fadeIn}
      initial={off ? false : { opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={off ? { duration: 0 } : { ...springSoft, delay: 0.05 }}>
      {children}
    </motion.div>
  );
}
