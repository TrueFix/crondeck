"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { KeyIcon, CopyIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/crondeck/confirm-dialog";
import { api, type APIToken, type APITokenRole } from "@/lib/api";
import { dateTime } from "@/lib/format";

const ROLES: { value: APITokenRole; label: string; hint: string }[] = [
  { value: "operator", label: "Operator", hint: "Run jobs, read/write jobs & runs (no settings/backup)" },
  { value: "viewer", label: "Viewer", hint: "Read-only: jobs, runs, stats, live events" },
  { value: "admin", label: "Admin", hint: "Full API access — use sparingly for automation" }
];

export function APITokenSettings() {
  const { data, mutate, isLoading } = useSWR<APIToken[]>("/tokens");
  const [name, setName] = React.useState("");
  const [role, setRole] = React.useState<APITokenRole>("operator");
  const [creating, setCreating] = React.useState(false);
  const [plain, setPlain] = React.useState<string | null>(null);
  const [revokeId, setRevokeId] = React.useState<string | null>(null);

  const create = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setCreating(true);
    try {
      const res = await api<{ token: string; token_info: APIToken }>("/tokens", {
        method: "POST",
        body: { name: name.trim(), role }
      });
      setPlain(res.token);
      setName("");
      mutate();
      toast.success("Token created", { description: "Copy it now — it won’t be shown again." });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const revoke = async () => {
    if (!revokeId) return;
    try {
      await api(`/tokens/${revokeId}`, { method: "DELETE" });
      mutate();
      toast.success("Token revoked");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRevokeId(null);
    }
  };

  const copyPlain = async () => {
    if (!plain) return;
    try {
      await navigator.clipboard.writeText(plain);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Could not copy");
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <KeyIcon className="size-4 opacity-70" aria-hidden />
            API tokens
          </CardTitle>
          <CardDescription>
            For CI and scripts. Send <code className="font-mono text-xs">Authorization: Bearer cd_…</code> — no CSRF
            header required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {plain && (
            <div className="border-primary/30 bg-primary/5 space-y-2 rounded-lg border p-4">
              <Label>New token (shown once)</Label>
              <div className="flex gap-2">
                <Input readOnly value={plain} className="font-mono text-xs" />
                <Button type="button" variant="outline" size="icon" onClick={copyPlain} aria-label="Copy token">
                  <CopyIcon className="size-4" />
                </Button>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setPlain(null)}>
                Dismiss
              </Button>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                placeholder="GitHub Actions"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as APITokenRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-[11px]">{ROLES.find((r) => r.value === role)?.hint}</p>
            </div>
          </div>
          {isLoading ? (
            <Spinner className="size-5" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {(data ?? []).length === 0 ? (
                <li className="text-muted-foreground p-4 text-sm">No tokens yet.</li>
              ) : (
                data!.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">{t.name}</div>
                      <div className="text-muted-foreground font-mono text-xs">
                        {t.token_prefix}… · {t.role}
                        {t.last_used_at && <> · last used {dateTime(t.last_used_at)}</>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {t.revoked ? (
                        <Badge variant="secondary">Revoked</Badge>
                      ) : (
                        <Button type="button" variant="ghost" size="sm" onClick={() => setRevokeId(t.id)}>
                          <Trash2Icon className="size-4" /> Revoke
                        </Button>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </CardContent>
        <CardFooter>
          <Button type="button" disabled={creating} onClick={create}>
            {creating ? <Spinner className="size-4" /> : "Create token"}
          </Button>
        </CardFooter>
      </Card>
      <ConfirmDialog
        open={!!revokeId}
        onOpenChange={(o) => !o && setRevokeId(null)}
        title="Revoke API token?"
        description="Automations using this token will stop working immediately."
        confirmLabel="Revoke"
        destructive
        onConfirm={revoke}
      />
    </>
  );
}
