// Client-side mirror of the backend extract logic (internal/executor/http_flow.go).
// It lets the job editor evaluate extract paths against an already-fetched
// response, so changing an extract rule never triggers a new HTTP request.

import type { HttpPreviewResult } from "@/lib/api";

export type MissingPolicy = "fail" | "empty" | "null";

// ---------------------------------------------------------------------------
// Friendly source/field representation.
//
// Stored paths stay canonical ("body.json.client_ip", "headers.x-csrf",
// "body.data"), but the editor presents them as a Source dropdown + a plain
// field, so users never type the "body.json." / "headers." prefixes and can use
// familiar array syntax like `items[0].name`.
// ---------------------------------------------------------------------------

export type ExtractSource = "json" | "header" | "raw";

export interface ExtractParts {
  source: ExtractSource;
  field: string;
}

/** "items[0].name" → "items.0.name" (canonical dotted form). */
function fieldToDotted(field: string): string {
  return field
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .replace(/^\.+/, "")
    .replace(/\.+/g, ".");
}

/** "items.0.name" → "items[0].name" (friendly display form). */
export function dottedToField(dotted: string): string {
  const parts = dotted.split(".").filter(Boolean);
  let out = "";
  for (const p of parts) {
    if (/^\d+$/.test(p)) out += `[${p}]`;
    else out += out ? `.${p}` : p;
  }
  return out;
}

/** Decode a stored canonical path into a Source + field for the editor. */
export function parsePath(path: string): ExtractParts {
  const p = (path ?? "").trim();
  const lower = p.toLowerCase();
  if (lower === "body.data") return { source: "raw", field: "" };
  if (lower.startsWith("body.json.")) return { source: "json", field: dottedToField(p.slice("body.json.".length)) };
  if (lower.startsWith("headers.")) return { source: "header", field: p.slice("headers.".length) };
  // Legacy bare path → treat as a JSON field.
  return { source: "json", field: p ? dottedToField(p) : "" };
}

/** Encode a Source + field back into a stored canonical path. */
export function composePath(parts: ExtractParts): string {
  if (parts.source === "raw") return "body.data";
  if (parts.source === "header") return "headers." + parts.field.trim();
  return "body.json." + fieldToDotted(parts.field);
}

/** Short human description of a stored path, e.g. for read-only views. */
export function describePath(path: string): string {
  const { source, field } = parsePath(path);
  if (source === "raw") return "whole body";
  if (source === "header") return `${field} (header)`;
  return `${field} (JSON)`;
}

export interface ExtractEvaluation {
  /** The resolved value, or null when not found. */
  value: string | null;
  found: boolean;
  /** Human-readable reason when not found (e.g. "response is not JSON"). */
  error?: string;
  /** True when the body was truncated and a JSON lookup could not be trusted. */
  uncertain?: boolean;
}

function stringifyJSONValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return JSON.stringify(v);
}

function jsonPathLookup(raw: string, path: string): ExtractEvaluation {
  let p = path.trim();
  if (p.startsWith("$.")) p = p.slice(2);
  else if (p.startsWith("$")) p = p.slice(1);
  if (p === "") return { value: null, found: false, error: "empty json path" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { value: null, found: false, error: "response is not JSON" };
  }

  let cur: unknown = parsed;
  for (const part of p.split(".")) {
    if (part === "") continue;
    if (Array.isArray(cur)) {
      const i = Number(part);
      if (!Number.isInteger(i) || i < 0 || i >= cur.length) {
        return { value: null, found: false, error: `index "${part}" out of range` };
      }
      cur = cur[i];
    } else if (cur && typeof cur === "object") {
      const obj = cur as Record<string, unknown>;
      if (!(part in obj)) return { value: null, found: false, error: `key "${part}" not found` };
      cur = obj[part];
    } else {
      return { value: null, found: false, error: `cannot descend into ${typeof cur}` };
    }
  }
  return { value: stringifyJSONValue(cur), found: true };
}

function headerLookup(headers: Record<string, string> | undefined, name: string): ExtractEvaluation {
  if (!headers) return { value: null, found: false, error: `header "${name}" not found` };
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === name.toLowerCase()) return { value: v, found: true };
  }
  return { value: null, found: false, error: `header "${name}" not found` };
}

/** Evaluate a single extract path against a fetched preview response. */
export function evaluateExtractPath(
  result: Pick<HttpPreviewResult, "body_preview" | "body_is_json" | "body_truncated" | "headers">,
  path: string
): ExtractEvaluation {
  const trimmed = path.trim();
  if (trimmed === "") return { value: null, found: false, error: "empty path" };
  const lower = trimmed.toLowerCase();
  const body = result.body_preview ?? "";

  if (lower === "body.data") {
    return { value: body, found: true, uncertain: result.body_truncated };
  }
  if (lower.startsWith("body.json.")) {
    const jsonPath = trimmed.slice("body.json.".length);
    const r = jsonPathLookup(body, jsonPath);
    if (result.body_truncated) r.uncertain = true;
    return r;
  }
  if (lower.startsWith("headers.")) {
    return headerLookup(result.headers, trimmed.slice("headers.".length));
  }
  // Legacy bare path → treated as a JSON path in the body.
  const r = jsonPathLookup(body, trimmed);
  if (result.body_truncated) r.uncertain = true;
  return r;
}

/**
 * Resolve every extract rule of a step against a fetched response, applying the
 * per-variable missing policy. Returns the variable map plus per-rule details
 * for the editor to display (found / value / error).
 */
export function resolveStepExtract(
  result: Pick<HttpPreviewResult, "body_preview" | "body_is_json" | "body_truncated" | "headers"> | undefined | null,
  extract: Record<string, string> | undefined,
  missing: Record<string, string> | undefined
): {
  vars: Record<string, string>;
  details: Record<string, ExtractEvaluation & { applied: string | null }>;
} {
  const vars: Record<string, string> = {};
  const details: Record<string, ExtractEvaluation & { applied: string | null }> = {};
  if (!extract) return { vars, details };

  for (const [name, path] of Object.entries(extract)) {
    if (!name.trim()) continue;
    if (!result) {
      details[name] = { value: null, found: false, applied: null };
      continue;
    }
    const evalResult = evaluateExtractPath(result, path);
    if (evalResult.found && evalResult.value !== null) {
      vars[name] = evalResult.value;
      details[name] = { ...evalResult, applied: evalResult.value };
      continue;
    }
    const policy = (missing?.[name] ?? "fail") as MissingPolicy;
    if (policy === "empty") {
      vars[name] = "";
      details[name] = { ...evalResult, applied: "" };
    } else if (policy === "null") {
      vars[name] = "null";
      details[name] = { ...evalResult, applied: "null" };
    } else {
      details[name] = { ...evalResult, applied: null };
    }
  }
  return { vars, details };
}
