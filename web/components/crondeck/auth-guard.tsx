"use client";

import * as React from "react";
import { api, ApiError } from "@/lib/api";
import { Spinner } from "@/components/ui/spinner";

export async function logout() {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    window.location.replace("/login/");
  }
}

/**
 * Client-side gate for the static dashboard. The Go API is the real security
 * boundary; this only avoids flashing protected UI to logged-out visitors.
 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<"checking" | "ok" | "error">("checking");

  React.useEffect(() => {
    let cancelled = false;
    api("/auth/me")
      .then(() => !cancelled && setState("ok"))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 401) {
          const next = window.location.pathname + window.location.search;
          window.location.replace(`/login/?next=${encodeURIComponent(next)}`);
        } else {
          setState("error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "ok") return <>{children}</>;
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4">
      <img src="/icon.svg" alt="" className="size-14 rounded-2xl shadow-[0_10px_40px_-10px_var(--chart-1)]" />
      {state === "checking" ? (
        <Spinner className="text-muted-foreground" />
      ) : (
        <div className="text-center">
          <p className="font-medium">Can’t reach the CronDeck server.</p>
          <button className="text-primary mt-1 text-sm underline" onClick={() => window.location.reload()}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
