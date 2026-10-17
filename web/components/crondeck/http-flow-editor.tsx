"use client";

import * as React from "react";
import { ArrowDownIcon, GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import type { HttpConfig, HttpPreviewResult, HttpStep } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KeyValueEditor } from "@/components/crondeck/key-value-editor";
import { ExtractEditor } from "@/components/crondeck/extract-editor";
import { HttpStatusPicker } from "@/components/crondeck/http-status-picker";
import { cn } from "@/lib/utils";
import { availableTemplateVars, extractOverrideWarnings } from "@/lib/http-flow-vars";
import { resolveStepExtract } from "@/lib/http-extract";
import { HttpStepPreview } from "@/components/crondeck/http-step-preview";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

const BODY_CONTENT_TYPES: {
  value: HttpStep["body_content_type"];
  label: string;
  short: string;
  hint: string;
}[] = [
  { value: "auto", label: "Auto-detect", short: "Auto", hint: "JSON → application/json, else text/plain" },
  { value: "json", label: "JSON", short: "JSON", hint: "application/json — use with {{variables}}" },
  { value: "form", label: "Form (URL-encoded)", short: "Form", hint: "application/x-www-form-urlencoded" },
  { value: "text", label: "Plain text", short: "Text", hint: "text/plain; charset=utf-8" },
  { value: "none", label: "No default", short: "None", hint: "Set Content-Type only via Headers" }
];

export function emptyHttpStep(partial?: Partial<HttpStep>): HttpStep {
  return {
    name: "",
    url: "",
    method: "GET",
    headers: {},
    body: "",
    expected_status: [],
    extract: {},
    ...partial
  };
}

function singleFromConfig(c: HttpConfig): HttpStep {
  return emptyHttpStep({
    name: "Request",
    url: c.url ?? "",
    method: c.method ?? "GET",
    headers: c.headers ?? {},
    body: c.body ?? "",
    body_content_type: c.body_content_type ?? "auto",
    expected_status: c.expected_status ?? []
  });
}

function stepsFromConfig(c: HttpConfig): HttpStep[] {
  if (c.steps?.length) return c.steps.map((s) => emptyHttpStep(s));
  return [singleFromConfig(c)];
}

export function HttpFlowEditor({
  value,
  onChange,
  mask
}: {
  value: HttpConfig;
  onChange: (next: HttpConfig) => void;
  mask?: string;
}) {
  const [mode, setMode] = React.useState<"single" | "flow">((value.steps?.length ?? 0) > 0 ? "flow" : "single");
  React.useEffect(() => {
    if ((value.steps?.length ?? 0) > 0) setMode("flow");
  }, [value.steps?.length]);
  const steps = mode === "flow" ? stepsFromConfig(value) : [singleFromConfig(value)];
  // Cached test responses per step. Extract values are derived from these, so
  // editing extract rules re-evaluates locally instead of sending a request.
  const [previewDataByStep, setPreviewDataByStep] = React.useState<Record<number, HttpPreviewResult | null>>({});

  React.useEffect(() => {
    setPreviewDataByStep({});
  }, [mode, value.steps?.length]);

  const varsForStep = React.useCallback(
    (index: number) => {
      const list = stepsFromConfig(value);
      const out: Record<string, string> = {};
      for (let i = 0; i < index; i++) {
        const { vars } = resolveStepExtract(previewDataByStep[i], list[i]?.extract, list[i]?.extract_missing);
        Object.assign(out, vars);
      }
      return out;
    },
    [previewDataByStep, value]
  );

  const setModeAndSync = (next: "single" | "flow") => {
    if (next === "flow" && mode === "single") {
      onChange({
        ...value,
        steps: [singleFromConfig(value), emptyHttpStep({ name: "Step 2", method: "POST", expected_status: [200] })],
        url: value.url
      });
    } else if (next === "single" && mode === "flow") {
      const first = stepsFromConfig(value)[0];
      onChange({
        follow_redirects: value.follow_redirects,
        url: first.url,
        method: first.method,
        headers: first.headers,
        body: first.body,
        body_content_type: first.body_content_type,
        expected_status: first.expected_status
      });
    }
    setMode(next);
  };

  const patchStep = (index: number, patch: Partial<HttpStep>) => {
    const list = stepsFromConfig(value);
    list[index] = { ...list[index], ...patch };
    if (mode === "flow") {
      onChange({ follow_redirects: value.follow_redirects, steps: list });
    } else {
      const s = list[0];
      onChange({
        follow_redirects: value.follow_redirects,
        url: s.url,
        method: s.method,
        headers: s.headers,
        body: s.body,
        body_content_type: s.body_content_type,
        expected_status: s.expected_status
      });
    }
  };

  const addStep = () => {
    const list = stepsFromConfig(value);
    if (list.length >= 10) return;
    list.push(emptyHttpStep({ name: `Step ${list.length + 1}`, method: "POST", expected_status: [200] }));
    onChange({ follow_redirects: value.follow_redirects, steps: list });
    setMode("flow");
  };

  const removeStep = (index: number) => {
    const list = stepsFromConfig(value).filter((_, i) => i !== index);
    if (list.length === 0) return;
    if (list.length === 1) {
      const s = list[0];
      onChange({
        follow_redirects: value.follow_redirects,
        url: s.url,
        method: s.method,
        headers: s.headers,
        body: s.body,
        body_content_type: s.body_content_type,
        expected_status: s.expected_status
      });
      setMode("single");
      return;
    }
    onChange({ follow_redirects: value.follow_redirects, steps: list });
  };

  const renderStep = (step: HttpStep, index: number, showFlowChrome: boolean) => {
    const method = step.method ?? "GET";
    const allSteps = stepsFromConfig(value);
    const overrideWarnings = showFlowChrome ? extractOverrideWarnings(allSteps, index) : [];
    const priorVars = showFlowChrome && index > 0 ? availableTemplateVars(allSteps, index) : [];
    const priorValues = showFlowChrome && index > 0 ? varsForStep(index) : {};

    return (
      <div
        key={index}
        className={cn(
          "space-y-4 rounded-2xl border p-4",
          showFlowChrome && "bg-background/40 shadow-sm"
        )}>
        {showFlowChrome && (
          <div className="flex items-center gap-2">
            <GripVerticalIcon className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <Input
              value={step.name ?? ""}
              onChange={(e) => patchStep(index, { name: e.target.value })}
              placeholder={`Step ${index + 1}`}
              className="h-9 font-medium"
            />
            {steps.length > 1 && (
              <Button type="button" size="icon-sm" variant="ghost" aria-label="Remove step" onClick={() => removeStep(index)}>
                <Trash2Icon />
              </Button>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label>Request</Label>
          <div className="flex gap-2">
            <Select value={method} onValueChange={(v) => patchStep(index, { method: v })}>
              <SelectTrigger className="h-10 w-28 font-mono font-semibold">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HTTP_METHODS.map((m) => (
                  <SelectItem key={m} value={m} className="font-mono">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={step.url}
              onChange={(e) => patchStep(index, { url: e.target.value })}
              placeholder="https://api.example.com/v1/token"
              className="h-10 flex-1 font-mono text-sm"
            />
          </div>
          {showFlowChrome && index > 0 && (
            <div className="space-y-1.5">
              {priorVars.length > 0 ? (
                <>
                  <p className="text-muted-foreground text-xs">
                    Click to copy a variable, then paste it into the URL, a header, or the body:
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {priorVars.map((v) => {
                      const val = priorValues[v];
                      return (
                        <button
                          key={v}
                          type="button"
                          title={val !== undefined ? `${v} = ${val}` : "Run earlier steps to see the value"}
                          onClick={() => {
                            navigator.clipboard?.writeText(`{{${v}}}`);
                            toast.success(`Copied {{${v}}}`);
                          }}
                          className="bg-muted hover:bg-primary/10 inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[11px]">
                          <span className="text-primary">{`{{${v}}}`}</span>
                          {val !== undefined && (
                            <span className="text-muted-foreground truncate">= {val.length > 24 ? val.slice(0, 24) + "…" : val}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground text-xs">
                  Extract values in earlier steps to reuse them here as{" "}
                  <code className="bg-muted rounded px-1">{"{{variable}}"}</code> in the URL, headers, or body.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>Headers</Label>
          <KeyValueEditor
            value={step.headers}
            onChange={(headers) => patchStep(index, { headers })}
            keyPlaceholder="Header-Name"
            valuePlaceholder="value or {{token}}"
            mask={mask}
            addLabel="Add header"
          />
        </div>

        {!["GET", "HEAD"].includes(method) && (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>Body</Label>
              <div className="rounded-lg border bg-muted/25 p-2.5">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  className="flex w-full flex-wrap gap-2"
                  value={step.body_content_type ?? "auto"}
                  onValueChange={(v) => {
                    if (v) patchStep(index, { body_content_type: v as HttpStep["body_content_type"] });
                  }}
                  aria-label="Body content type">
                  {BODY_CONTENT_TYPES.map((opt) => (
                    <ToggleGroupItem
                      key={opt.value ?? "auto"}
                      value={opt.value ?? "auto"}
                      className="h-8 min-w-[3.5rem] flex-1 px-2 text-xs font-medium sm:flex-none sm:min-w-[4.25rem]"
                      title={`${opt.label} — ${opt.hint}`}
                      aria-label={opt.label}>
                      {opt.short}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            </div>
            <Textarea
              value={step.body ?? ""}
              onChange={(e) => patchStep(index, { body: e.target.value })}
              placeholder={
                (step.body_content_type ?? "auto") === "form"
                  ? "grant_type=client_credentials&client_id=..."
                  : '{"refresh": true}'
              }
              className="min-h-28 font-mono text-xs"
            />
          </div>
        )}

        <div className="space-y-2">
          <Label>Expected status</Label>
          <HttpStatusPicker
            value={step.expected_status ?? []}
            onChange={(expected_status) => patchStep(index, { expected_status: expected_status.length ? expected_status : undefined })}
          />
        </div>

        <HttpStepPreview
          step={step}
          variables={showFlowChrome ? varsForStep(index) : {}}
          followRedirects={value.follow_redirects}
          showHints={showFlowChrome}
          onData={(d) => setPreviewDataByStep((prev) => ({ ...prev, [index]: d }))}
        />

        {showFlowChrome && (
          <div className="space-y-2 border-t pt-4">
            <Label>Extract variables</Label>
            <p className="text-muted-foreground text-xs">
              Pull values out of the response into named variables. Pick where each value comes from, then the field
              (e.g. <code className="bg-muted rounded px-1">client_ip</code> or{" "}
              <code className="bg-muted rounded px-1">data.items[0].id</code>). Reuse them as{" "}
              <code className="bg-muted rounded px-1">{"{{name}}"}</code> in later steps.
            </p>
            <ExtractEditor
              extract={step.extract}
              extractMissing={step.extract_missing}
              preview={previewDataByStep[index]}
              onChange={(extract, extract_missing) => patchStep(index, { extract, extract_missing })}
            />
            {overrideWarnings.length > 0 && (
              <ul className="text-amber-600 dark:text-amber-500 space-y-1 text-xs" role="status">
                {overrideWarnings.map((w) => (
                  <li key={w.variable}>
                    <strong>{w.variable}</strong> was already defined in step {w.firstDefinedStep + 1}. Saving will{" "}
                    <strong>override</strong> it when this step runs — this step&apos;s value is used from here on.
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <Tabs value={mode} onValueChange={(v) => setModeAndSync(v as "single" | "flow")}>
        <TabsList className="grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="single">Single request</TabsTrigger>
          <TabsTrigger value="flow">Multi-step flow</TabsTrigger>
        </TabsList>
      </Tabs>

      {mode === "flow" ? (
        <div className="space-y-3">
          {steps.map((step, index) => (
            <React.Fragment key={index}>
              {renderStep(step, index, true)}
              {index < steps.length - 1 && (
                <div className="text-muted-foreground flex justify-center py-1">
                  <ArrowDownIcon className="size-5" aria-hidden />
                </div>
              )}
            </React.Fragment>
          ))}
          <Button type="button" variant="outline" className="w-full" onClick={addStep} disabled={steps.length >= 10}>
            <PlusIcon /> Add step
          </Button>
        </div>
      ) : (
        renderStep(steps[0], 0, false)
      )}

      <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
        <div>
          <div className="text-sm font-medium">Follow redirects</div>
          <div className="text-muted-foreground text-xs">Applies to every step · up to 10 hops</div>
        </div>
        <Switch
          checked={value.follow_redirects ?? true}
          onCheckedChange={(follow_redirects) => onChange({ ...value, follow_redirects })}
        />
      </div>
    </div>
  );
}
