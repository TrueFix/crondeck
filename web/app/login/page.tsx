"use client";

import * as React from "react";
import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  UserIcon,
  ArrowRightIcon,
  ShieldCheckIcon,
  ZapIcon,
  DatabaseIcon
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

const tickerLines = [
  { expr: "*/5 * * * *", name: "health-check.ping", status: "success" },
  { expr: "0 3 * * *", name: "postgres.backup", status: "success" },
  { expr: "@every 30s", name: "queue.drain", status: "running" },
  { expr: "0 9 * * MON-FRI", name: "report.daily", status: "success" },
  { expr: "15 */2 * * *", name: "cache.warmup", status: "success" },
  { expr: "0 0 1 * *", name: "invoices.generate", status: "success" }
];

function safeNext(): string {
  if (typeof window === "undefined") return "/";
  const n = new URLSearchParams(window.location.search).get("next") ?? "/";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/";
}

type LoginMode = "key" | "password";

export default function LoginPage() {
  const [mode, setMode] = React.useState<LoginMode>("key");
  const [key, setKey] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showSecret, setShowSecret] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState(0);
  const keyRef = React.useRef<HTMLInputElement>(null);
  const userRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    api("/auth/me")
      .then(() => window.location.replace(safeNext()))
      .catch(() => (mode === "key" ? keyRef.current?.focus() : userRef.current?.focus()));
  }, [mode]);

  const fail = (err: unknown) => {
    const msg =
      err instanceof ApiError ? err.message : "Could not reach the server. Is CronDeck running?";
    setError(msg);
    setShake((s) => s + 1);
    setLoading(false);
  };

  const submitKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!key.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await api("/auth/login", { method: "POST", body: { key: key.trim() } });
      window.location.replace(safeNext());
    } catch (err) {
      fail(err);
      keyRef.current?.select();
    }
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;
    setLoading(true);
    setError(null);
    try {
      await api("/auth/login", {
        method: "POST",
        body: { username: username.trim(), password }
      });
      window.location.replace(safeNext());
    } catch (err) {
      fail(err);
    }
  };

  const canSubmit = mode === "key" ? key.trim().length > 0 : username.trim().length > 0 && password.length > 0;

  return (
    <div className="flex min-h-svh p-3 lg:h-svh">
      <div className="glass glass-sheen relative hidden w-1/2 overflow-hidden rounded-3xl border lg:flex lg:flex-col lg:justify-between lg:p-10">
        <div className="flex items-center gap-3">
          <img src="/icon.svg" alt="" className="size-10 rounded-xl shadow-[0_10px_30px_-8px_var(--chart-1)]" />
          <span className="font-display text-xl tracking-tight">CronDeck</span>
        </div>

        <div className="relative space-y-8">
          <h1 className="font-display max-w-md text-5xl leading-[1.05] tracking-tight">
            Every job, <span className="text-aurora">right on time.</span>
          </h1>
          <p className="text-muted-foreground max-w-md text-base">
            Schedule HTTP calls, shell commands and scripts. Watch them run live, retry on failure, and keep the
            whole history in one place.
          </p>

          <div className="glass max-w-md overflow-hidden rounded-2xl border p-1.5">
            <div className="relative h-[216px] overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_18%,black_82%,transparent)]">
              <div className="animate-[ticker_18s_linear_infinite] motion-reduce:animate-none">
                {[...tickerLines, ...tickerLines].map((l, i) => (
                  <div key={i} className="flex h-12 items-center gap-3 rounded-xl px-3 font-mono text-xs">
                    <span
                      data-pulse={l.status === "running"}
                      className={cn(
                        "status-orb size-2",
                        l.status === "running" ? "text-status-running" : "text-status-success"
                      )}
                    />
                    <span className="text-muted-foreground w-28 shrink-0">{l.expr}</span>
                    <span className="truncate">{l.name}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="text-muted-foreground flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <span className="flex items-center gap-1.5">
            <ZapIcon className="size-3.5" /> Single Go binary
          </span>
          <span className="flex items-center gap-1.5">
            <DatabaseIcon className="size-3.5" /> Embedded SQLite
          </span>
          <span className="flex items-center gap-1.5">
            <ShieldCheckIcon className="size-3.5" /> Admin key or team login
          </span>
        </div>
      </div>

      <div className="flex w-full items-center justify-center lg:w-1/2">
        <div
          key={shake}
          className={cn(
            "glass glass-sheen w-full max-w-md space-y-8 rounded-3xl border px-6 py-10 sm:px-10",
            shake > 0 && "animate-shake"
          )}>
          <div className="text-center">
            <div className="from-chart-1/25 to-chart-4/25 ring-chart-1/30 mx-auto mb-5 flex size-14 items-center justify-center rounded-2xl bg-linear-to-br ring-1">
              {mode === "key" ? <KeyRoundIcon className="text-primary size-6" /> : <UserIcon className="text-primary size-6" />}
            </div>
            <h2 className="font-display text-3xl tracking-tight">Welcome back</h2>
            <p className="text-muted-foreground mt-2 text-sm">Sign in with your admin key or a team account</p>
          </div>

          <Tabs
            value={mode}
            onValueChange={(v) => {
              setMode(v as LoginMode);
              setError(null);
            }}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="key">Admin key</TabsTrigger>
              <TabsTrigger value="password">Username</TabsTrigger>
            </TabsList>

            <TabsContent value="key" className="mt-5">
              <form className="space-y-5" onSubmit={submitKey}>
                <div className="space-y-2">
                  <Label htmlFor="admin-key">Admin key</Label>
                  <div className="relative">
                    <Input
                      ref={keyRef}
                      id="admin-key"
                      name="admin-key"
                      type={showSecret ? "text" : "password"}
                      autoComplete="current-password"
                      spellCheck={false}
                      required
                      value={key}
                      onChange={(e) => {
                        setKey(e.target.value);
                        setError(null);
                      }}
                      aria-invalid={!!error}
                      aria-describedby={error ? "login-error" : undefined}
                      className="h-11 pr-11 font-mono"
                      placeholder="••••••••••••••••••••••••••••••••"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="absolute top-1/2 right-1.5 -translate-y-1/2"
                      onClick={() => setShowSecret((s) => !s)}
                      aria-label={showSecret ? "Hide key" : "Show key"}>
                      {showSecret ? <EyeOffIcon /> : <EyeIcon />}
                    </Button>
                  </div>
                </div>
                {error && mode === "key" && (
                  <p id="login-error" role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                )}
                <Button type="submit" className="h-11 w-full text-sm" disabled={loading || !canSubmit}>
                  {loading ? <Spinner /> : <>Unlock dashboard <ArrowRightIcon /></>}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="password" className="mt-5">
              <form className="space-y-5" onSubmit={submitPassword}>
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    ref={userRef}
                    id="username"
                    name="username"
                    autoComplete="username"
                    required
                    value={username}
                    onChange={(e) => {
                      setUsername(e.target.value);
                      setError(null);
                    }}
                    className="h-11"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      name="password"
                      type={showSecret ? "text" : "password"}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setError(null);
                      }}
                      className="h-11 pr-11"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="absolute top-1/2 right-1.5 -translate-y-1/2"
                      onClick={() => setShowSecret((s) => !s)}
                      aria-label={showSecret ? "Hide password" : "Show password"}>
                      {showSecret ? <EyeOffIcon /> : <EyeIcon />}
                    </Button>
                  </div>
                </div>
                {error && mode === "password" && (
                  <p role="alert" className="text-destructive text-sm">
                    {error}
                  </p>
                )}
                <Button type="submit" className="h-11 w-full text-sm" disabled={loading || !canSubmit}>
                  {loading ? <Spinner /> : <>Sign in <ArrowRightIcon /></>}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          <p className="text-muted-foreground text-center text-xs leading-relaxed">
            The admin key is <code className="bg-muted rounded px-1 py-0.5">ADMIN_KEY</code> on the server. Team
            accounts are created under Settings → Users. Five failed attempts lock this IP for 15 minutes.
          </p>
        </div>
      </div>
    </div>
  );
}
