"use client";

import * as React from "react";
import type { Transition, Variants } from "framer-motion";

function readReduced() {
  if (typeof document === "undefined") return false;
  if (document.documentElement.dataset.effects === "reduced") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribeReduced(onChange: () => void) {
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export function useReducedMotion() {
  return React.useSyncExternalStore(subscribeReduced, readReduced, () => false);
}

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.85
};

export const springSoft: Transition = {
  type: "spring",
  stiffness: 280,
  damping: 28,
  mass: 0.9
};

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0 }
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1 }
};

export const staggerContainer = (stagger = 0.05, delay = 0): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren: delay }
  }
});

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1 }
};

export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 340, damping: 32, mass: 0.85 }
  },
  exit: { opacity: 0, y: -10, transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }
};

export const pageTransitionRich: Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { type: "spring", stiffness: 320, damping: 30 }
  },
  exit: { opacity: 0, y: -8, filter: "blur(3px)", transition: { duration: 0.16 } }
};

export const slidePanel: Variants = {
  hidden: { opacity: 0, x: -22, scale: 0.97 },
  show: { opacity: 1, x: 0, scale: 1, transition: springSoft as Transition }
};

export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.92, y: 8 },
  show: { opacity: 1, scale: 1, y: 0, transition: springSnappy as Transition }
};

/** CronDeck low-power mode + OS reduced motion. */
export function useMotionOff() {
  const reduced = useReducedMotion();
  return reduced;
}

export function motionProps(reduced: boolean, transition: Transition = springSnappy) {
  if (reduced) {
    return { initial: false as const, animate: { opacity: 1 }, transition: { duration: 0 } };
  }
  return { transition };
}
