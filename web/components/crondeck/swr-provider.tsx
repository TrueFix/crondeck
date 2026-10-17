"use client";

import { SWRConfig } from "swr";
import { fetcher } from "@/lib/api";

export function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        revalidateOnFocus: true,
        keepPreviousData: true,
        dedupingInterval: 2500,
        focusThrottleInterval: 10000,
        refreshWhenHidden: false,
        shouldRetryOnError: (err) => !(err && typeof err === "object" && "status" in err && (err as { status: number }).status < 500),
        errorRetryCount: 3
      }}>
      {children}
    </SWRConfig>
  );
}
