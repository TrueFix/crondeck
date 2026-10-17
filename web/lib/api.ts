// Typed client for the CronDeck Go API.

export type JobType = "http" | "shell" | "script" | "sql";
export type RunStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "timeout"
  | "cancelled"
  | "skipped";
export type ConcurrencyPolicy = "allow" | "forbid" | "replace";

export interface HttpStep {
  name?: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** How to set Content-Type when not specified in headers: auto | json | form | text | none */
  body_content_type?: "auto" | "json" | "form" | "text" | "none";
  expected_status?: number[];
  /** Map variable name → source path: body.data, body.json.id, headers.x-csrf, or legacy data.id */
  extract?: Record<string, string>;
  /** Map variable name → behavior when the path is not found: "fail" | "empty" | "null" (default "fail") */
  extract_missing?: Record<string, string>;
}

export interface HttpExtractHint {
  path: string;
  variable_suggestion: string;
  preview_value: string;
}

export interface HttpPreviewResult {
  status: number;
  status_text: string;
  duration_ms: number;
  headers: Record<string, string>;
  body_preview: string;
  body_truncated: boolean;
  body_is_json: boolean;
  hints: HttpExtractHint[];
  extracted?: Record<string, string>;
  extract_error?: string;
  request_error?: string;
  /** The exact request sent after {{variable}} substitution. */
  resolved_url: string;
  resolved_method: string;
  resolved_headers?: Record<string, string>;
  resolved_body?: string;
}

export interface HttpConfig {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  /** How to set Content-Type when not specified in headers: auto | json | form | text | none */
  body_content_type?: "auto" | "json" | "form" | "text" | "none";
  expected_status?: number[];
  follow_redirects?: boolean;
  /** When set, runs sequentially; later steps may use {{variables}} from extract. */
  steps?: HttpStep[];
}
export interface ShellConfig {
  command: string;
  workdir?: string;
  env?: Record<string, string>;
}
export interface ScriptConfig {
  interpreter: string;
  source: string;
  workdir?: string;
  env?: Record<string, string>;
}
export interface SQLConfig {
  driver: "sqlite" | "postgres";
  dsn: string;
  query: string;
  max_rows?: number;
}

export interface SqlStatementResult {
  sql: string;
  kind: "rows" | "exec";
  columns?: string[];
  rows?: string[][];
  row_count: number;
  truncated: boolean;
  rows_affected: number;
  error?: string;
}
export interface SqlTestResult {
  ok: boolean;
  error?: string;
  duration_ms: number;
  rolled_back: boolean;
  statements: SqlStatementResult[];
}
export type JobConfig = HttpConfig | ShellConfig | ScriptConfig | SQLConfig;

export interface Job {
  id: string;
  name: string;
  description: string;
  type: JobType;
  schedule: string;
  timezone: string;
  config: JobConfig;
  enabled: boolean;
  timeout_sec: number;
  max_retries: number;
  retry_backoff_sec: number;
  concurrency_policy: ConcurrencyPolicy;
  tags: string[];
  depends_on: string[];
  color: string;
  last_run_at: string | null;
  last_status: RunStatus | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
  running: number;
}

export type JobInput = Pick<
  Job,
  | "name"
  | "description"
  | "type"
  | "schedule"
  | "timezone"
  | "config"
  | "enabled"
  | "timeout_sec"
  | "max_retries"
  | "retry_backoff_sec"
  | "concurrency_policy"
  | "tags"
  | "depends_on"
  | "color"
>;

export interface Run {
  id: string;
  job_id: string;
  job_name?: string;
  job_type?: JobType;
  status: RunStatus;
  trigger: "schedule" | "manual" | "retry" | "chain";
  attempt: number;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  exit_code: number | null;
  http_status: number | null;
  output?: string;
  error: string;
  created_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface JobDetail {
  job: Job;
  next_runs: string[];
  recent_runs: Run[];
}

export interface Overview {
  total_jobs: number;
  enabled_jobs: number;
  failing_jobs: number;
  running_now: number;
  runs_24h: number;
  success_24h: number;
  failed_24h: number;
  success_rate_24h: number;
  success_rate_7d: number;
  runs_7d: number;
  avg_duration_ms_7d: number;
  prev_runs_24h: number;
  prev_success_rate_24h: number;
}

export interface TimelineBucket {
  t: string;
  success: number;
  failed: number;
  other: number;
}
export interface HeatDay {
  date: string;
  total: number;
  failed: number;
}
export interface JobStat {
  job_id: string;
  job_name: string;
  job_type: JobType;
  runs: number;
  failures: number;
  avg_duration_ms: number;
  success_rate: number;
}
export interface Upcoming {
  job_id: string;
  job_name: string;
  job_type: JobType;
  at: string;
}
export interface AuditEntry {
  id: number;
  action: string;
  target_id: string;
  meta: Record<string, unknown>;
  ip: string;
  created_at: string;
}
export interface UserAccount {
  id: string;
  username: string;
  role: APITokenRole;
  created_at: string;
}

export interface Meta {
  version: string;
  allow_shell: boolean;
  allow_sql: boolean;
  interpreters: string[];
  default_timezone: string;
  server_time: string;
  uptime_sec: number;
  mask: string;
}
export type APITokenRole = "admin" | "operator" | "viewer";

export interface APIToken {
  id: string;
  name: string;
  role: APITokenRole;
  token_prefix: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked: boolean;
  created_at: string;
}

export interface NotificationSettings {
  enabled: boolean;
  dedupe_minutes: number;
  webhook_url: string;
  slack_webhook_url: string;
  discord_webhook_url: string;
  email_enabled: boolean;
  email_to: string[];
  email_from: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_tls: boolean;
}

export interface Settings {
  run_retention_days: number;
  max_concurrent_runs: number;
  max_output_bytes: number;
  allow_shell: boolean;
  default_timezone: string;
  session_ttl_hours: number;
  environment: string;
  db_path: string;
  active_sessions: number;
  current_session: { created_at: string; expires_at: string; ip: string; user_agent: string } | null;
  active_runs: number;
  sse_clients: number;
  version: string;
  uptime_sec: number;
}

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }
}

let redirecting = false;

export function redirectToLogin(preserveDestination = true) {
  if (typeof window === "undefined") return;
  if (redirecting || window.location.pathname.startsWith("/login")) return;
  redirecting = true;
  const next = window.location.pathname + window.location.search;
  window.location.replace(preserveDestination ? `/login/?next=${encodeURIComponent(next)}` : "/login/");
}

export async function api<T = unknown>(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? "GET",
    credentials: "same-origin",
    signal: init.signal,
    headers: {
      "X-Requested-With": "crondeck",
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {})
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined
  });

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } })
      ?.error;
    if (res.status === 401 && !path.startsWith("/auth/")) redirectToLogin();
    throw new ApiError(
      res.status,
      err?.code ?? "http_error",
      err?.message ?? `Request failed (${res.status})`,
      err?.fields
    );
  }
  return data as T;
}

/** SWR fetcher: keys are API paths like "/jobs?page=1". */
export const fetcher = <T,>(path: string) => api<T>(path);

export function qs(params: Record<string, string | number | boolean | undefined | null>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}
