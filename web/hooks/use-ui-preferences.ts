"use client";
import { useSyncExternalStore } from "react";
import { defaultPreferences, getPreferences, subscribePreferences } from "@/lib/ui-preferences";

export function useUIPreferences() {
  return useSyncExternalStore(subscribePreferences, getPreferences, () => defaultPreferences);
}
