"use client";

import * as React from "react";
import { useSWRConfig } from "swr";
import { redirectToLogin, type Run } from "@/lib/api";

type LogListener = (chunk: string) => void;
type RunListener = (type: string, run: Run) => void;

interface EventStreamCtx {
  connected: boolean;
  /** live run IDs (queued or running) known from events */
  activeRuns: Map<string, Run>;
  finishedRuns: Set<string>;
  subscribeLog: (runId: string, fn: LogListener) => () => void;
  subscribeRuns: (fn: RunListener) => () => void;
}

const Ctx = React.createContext<EventStreamCtx | null>(null);
const ConnectionCtx = React.createContext(false);
const RunEventsCtx = React.createContext<EventStreamCtx["subscribeRuns"] | null>(null);

const RUN_PREFIXES = ["/jobs", "/runs", "/stats/overview"];
const JOB_PREFIXES = [...RUN_PREFIXES, "/stats", "/upcoming", "/tags", "/audit", "/settings", "/search/jobs"];

/**
 * Opens one EventSource to /api/events for the whole app and:
 *  - revalidates SWR caches (throttled) when jobs/runs change,
 *  - streams run.log chunks to subscribers (live log viewer),
 *  - tracks active runs for the header pulse indicator.
 */
export function EventStreamProvider({ children }: { children: React.ReactNode }) {
  const { mutate } = useSWRConfig();
  const [connected, setConnected] = React.useState(false);
  const [activeRuns, setActiveRuns] = React.useState<Map<string, Run>>(new Map());
  const [finishedRuns, setFinishedRuns] = React.useState<Set<string>>(new Set());
  const finished = React.useRef(new Set<string>());
  const logListeners = React.useRef(new Map<string, Set<LogListener>>());
  const runListeners = React.useRef(new Set<RunListener>());
  const pending = React.useRef<number | null>(null);
  const dirtyJobs = React.useRef(false);
  const active = React.useRef(new Map<string, Run>());
  const activeDirty = React.useRef(false);
  const lastCharts = React.useRef(0);

  const revalidate = React.useCallback((jobs = false) => {
    dirtyJobs.current ||= jobs;
    if (pending.current !== null) return;
    pending.current = window.setTimeout(() => {
      pending.current = null;
      const now = Date.now();
      const refreshCharts = now - lastCharts.current >= 10000;
      const prefixes = dirtyJobs.current ? JOB_PREFIXES : [...RUN_PREFIXES, ...(refreshCharts ? ["/stats"] : [])];
      if (refreshCharts) lastCharts.current = now;
      dirtyJobs.current = false;
      if (document.hidden) return;
      mutate(
        // SWR only revalidates mounted hooks. Keep cached data during refresh.
        (key) => typeof key === "string" && prefixes.some((p) => key.startsWith(p)),
        undefined,
        { revalidate: true, populateCache: false }
      );
    }, 2500);
  }, [mutate]);

  React.useEffect(() => {
    let es: EventSource | null = null;
    let retry: number | null = null;
    let closed = false;

    const connect = () => {
      es = new EventSource("/api/events", { withCredentials: true });
      es.addEventListener("hello", () => {
        setConnected(true);
        active.current.clear();
        activeDirty.current = true;
        revalidate(true);
      });
      es.onerror = () => {
        setConnected(false);
        if (es && es.readyState === EventSource.CLOSED && !closed) {
          retry = window.setTimeout(connect, 4000);
        }
      };

      const onRun = (type: string) => (e: MessageEvent) => {
        const run = JSON.parse(e.data) as Run;
        if (type === "run.finished") {
          active.current.delete(run.id);
          finished.current.add(run.id);
          if (finished.current.size > 500) finished.current.delete(finished.current.values().next().value!);
        }
        else active.current.set(run.id, run);
        activeDirty.current = true;
        runListeners.current.forEach((fn) => fn(type, run));
        revalidate();
      };
      es.addEventListener("run.queued", onRun("run.queued"));
      es.addEventListener("run.started", onRun("run.started"));
      es.addEventListener("run.finished", onRun("run.finished"));
      es.addEventListener("run.log", (e: MessageEvent) => {
        const d = JSON.parse(e.data) as { run_id: string; chunk: string };
        logListeners.current.get(d.run_id)?.forEach((fn) => fn(d.chunk));
      });
      es.addEventListener("job.updated", () => revalidate(true));
      es.addEventListener("job.deleted", () => revalidate(true));
      es.addEventListener("system.restored", () => redirectToLogin(false));
    };
    connect();
    const publish = window.setInterval(() => {
      if (!activeDirty.current || document.hidden) return;
      activeDirty.current = false;
      setFinishedRuns(new Set(finished.current));
      setActiveRuns((previous) => {
        const next = active.current;
        if (previous.size === next.size && [...next].every(([id, run]) => previous.get(id)?.status === run.status)) return previous;
        return new Map(next);
      });
    }, 250);
    const visible = () => { if (!document.hidden) revalidate(true); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      closed = true;
      if (retry) window.clearTimeout(retry);
      es?.close();
      if (pending.current) window.clearTimeout(pending.current);
      pending.current = null;
      window.clearInterval(publish);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [revalidate]);

  const subscribeLog = React.useCallback((runId: string, fn: LogListener) => {
    const map = logListeners.current;
    if (!map.has(runId)) map.set(runId, new Set());
    map.get(runId)!.add(fn);
    return () => {
      map.get(runId)?.delete(fn);
      if (map.get(runId)?.size === 0) map.delete(runId);
    };
  }, []);

  const subscribeRuns = React.useCallback((fn: RunListener) => {
    runListeners.current.add(fn);
    return () => {
      runListeners.current.delete(fn);
    };
  }, []);

  const value = React.useMemo(
    () => ({ connected, activeRuns, finishedRuns, subscribeLog, subscribeRuns }),
    [connected, activeRuns, finishedRuns, subscribeLog, subscribeRuns]
  );
  return <ConnectionCtx.Provider value={connected}>
    <RunEventsCtx.Provider value={subscribeRuns}>
      <Ctx.Provider value={value}>{children}</Ctx.Provider>
    </RunEventsCtx.Provider>
  </ConnectionCtx.Provider>;
}

export function useEventConnection() { return React.useContext(ConnectionCtx); }

export function useRunEvents() {
  const subscribe = React.useContext(RunEventsCtx);
  if (!subscribe) throw new Error("EventStreamProvider is required");
  return subscribe;
}

export function useEventStream() {
  const ctx = React.useContext(Ctx);
  if (!ctx) throw new Error("useEventStream must be used inside EventStreamProvider");
  return ctx;
}
