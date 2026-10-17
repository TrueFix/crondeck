"use client";

import * as React from "react";
import { ChevronDownIcon, ChevronRightIcon, Loader2Icon, PlayIcon } from "lucide-react";
import { toast } from "sonner";

import type { HttpPreviewResult, HttpStep } from "@/lib/api";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function HttpStepPreview({
  step,
  variables,
  followRedirects,
  showHints,
  onData
}: {
  step: HttpStep;
  variables: Record<string, string>;
  followRedirects?: boolean;
  showHints?: boolean;
  /** Reports the latest fetched response so the editor can evaluate extract rules without re-requesting. */
  onData?: (data: HttpPreviewResult | null) => void;
}) {
  const [loading, setLoading] = React.useState(false);
  const [data, setData] = React.useState<HttpPreviewResult | null>(null);
  const [auto, setAuto] = React.useState(true);
  const [showBody, setShowBody] = React.useState(false);
  const [showReq, setShowReq] = React.useState(false);

  // Fingerprint of only the inputs that change the actual HTTP request. Extract
  // rules are deliberately excluded: editing them re-evaluates locally against
  // the cached response and never sends a new request.
  const requestSignature = React.useMemo(
    () =>
      JSON.stringify({
        url: step.url,
        method: step.method,
        body: step.body,
        headers: step.headers,
        variables,
        follow: followRedirects ?? true
      }),
    [step.url, step.method, step.body, step.headers, variables, followRedirects]
  );

  // Latest props via refs so `run` keeps a stable identity.
  const stepRef = React.useRef(step);
  const variablesRef = React.useRef(variables);
  const followRef = React.useRef(followRedirects);
  const onDataRef = React.useRef(onData);
  React.useEffect(() => {
    stepRef.current = step;
    variablesRef.current = variables;
    followRef.current = followRedirects;
    onDataRef.current = onData;
  });

  const abortRef = React.useRef<AbortController | null>(null);

  const run = React.useCallback(async (isAuto = false) => {
    const current = stepRef.current;
    if (!current.url?.trim()) {
      if (!isAuto) toast.error("Enter a URL first");
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    try {
      const res = await api<HttpPreviewResult>("/http/preview", {
        method: "POST",
        body: {
          // Omit extract so the backend doesn't fail the preview on a missing
          // path; extraction is evaluated client-side from this response.
          step: { ...current, extract: undefined, extract_missing: undefined },
          variables: variablesRef.current,
          follow_redirects: followRef.current ?? true
        },
        signal: ac.signal
      });
      if (ac.signal.aborted) return;
      setData(res);
      onDataRef.current?.(res);
      if (res.request_error && !isAuto) toast.error(res.request_error);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      if (!isAuto) toast.error((e as Error).message);
      setData(null);
      onDataRef.current?.(null);
    } finally {
      if (abortRef.current === ac) {
        setLoading(false);
        abortRef.current = null;
      }
    }
  }, []);

  // Fetch once per request change (debounced). The timer lives in a ref so
  // unrelated re-renders never cancel or re-arm it.
  const lastSigRef = React.useRef<string>("");
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!auto || !step.url?.trim()) return;
    if (requestSignature === lastSigRef.current) return; // request unchanged → keep cached response
    lastSigRef.current = requestSignature;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      void run(true);
    }, 1000);
  }, [auto, requestSignature, step.url, run]);

  React.useEffect(() => {
    if (auto) return;
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [auto]);

  React.useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const ok = data && !data.request_error && data.status > 0;

  return (
    <div className="bg-muted/30 space-y-3 rounded-xl border border-dashed p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">Live response</div>
        <div className="flex flex-wrap items-center gap-2">
          {showHints && (
            <label className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="accent-primary size-3.5"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
              />
              Auto-fetch on change
            </label>
          )}
          <Button type="button" size="sm" variant="secondary" disabled={loading || !step.url?.trim()} onClick={() => run()}>
            {loading ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
            {loading ? "Sending…" : data ? "Re-send" : "Send test request"}
          </Button>
        </div>
      </div>

      {!data && !loading && (
        <p className="text-muted-foreground text-xs">
          {auto && showHints
            ? "A test request runs automatically when the URL, headers, body, or variables change — the response is cached so editing extract rules never re-sends it."
            : "Run a test request to see the status and map variables — no need to save the job first."}
        </p>
      )}

      {data && (
        <>
          {/* Exactly what we send after {{variable}} substitution. */}
          {data.resolved_url && (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 font-mono text-xs">
                <span className="text-muted-foreground">→</span>
                <span className="text-primary font-semibold">{data.resolved_method}</span>
                <span className="break-all">{data.resolved_url}</span>
              </div>
              {(Object.keys(data.resolved_headers ?? {}).length > 0 || data.resolved_body) && (
                <>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium"
                    onClick={() => setShowReq((v) => !v)}>
                    {showReq ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
                    {showReq ? "Hide request details" : "Show request details"}
                  </button>
                  {showReq && (
                    <div className="bg-background space-y-2 rounded-lg border p-2 font-mono text-[11px]">
                      {Object.entries(data.resolved_headers ?? {}).map(([k, v]) => (
                        <div key={k} className="break-all">
                          <span className="text-muted-foreground">{k}:</span> {v}
                        </div>
                      ))}
                      {data.resolved_body && (
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all">{data.resolved_body}</pre>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {data.request_error ? (
            <p className="text-destructive text-sm">{data.request_error}</p>
          ) : (
            <p className="text-muted-foreground font-mono text-xs">
              ← HTTP {data.status}
              {data.duration_ms > 0 && ` · ${data.duration_ms}ms`}
              {data.body_truncated && " · body truncated"}
            </p>
          )}

          {ok && data.body_preview && (
            <div className="space-y-2">
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs font-medium"
                onClick={() => setShowBody((v) => !v)}>
                {showBody ? <ChevronDownIcon className="size-3.5" /> : <ChevronRightIcon className="size-3.5" />}
                {showBody ? "Hide response body" : "Show response body"}
              </button>
              {showBody && (
                <pre className="bg-background max-h-56 overflow-auto rounded-lg border p-2 font-mono text-[11px] whitespace-pre-wrap break-all">
                  {data.body_preview}
                </pre>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
