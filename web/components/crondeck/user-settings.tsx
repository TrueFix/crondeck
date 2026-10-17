"use client";

import * as React from "react";
import useSWR from "swr";
import { toast } from "sonner";
import { UsersIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { ConfirmDialog } from "@/components/crondeck/confirm-dialog";
import { api, type APITokenRole, type UserAccount } from "@/lib/api";
import { dateTime } from "@/lib/format";

export function UserSettings() {
  const { data, mutate, isLoading } = useSWR<UserAccount[]>("/users");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [role, setRole] = React.useState<APITokenRole>("operator");
  const [saving, setSaving] = React.useState(false);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  const create = async () => {
    setSaving(true);
    try {
      await api("/users", { method: "POST", body: { username: username.trim(), password, role } });
      setUsername("");
      setPassword("");
      mutate();
      toast.success("User created");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    try {
      await api(`/users/${deleteId}`, { method: "DELETE" });
      mutate();
      toast.success("User removed");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <UsersIcon className="size-4 opacity-70" aria-hidden />
            Users
          </CardTitle>
          <CardDescription>
            Password login for your team. The legacy <strong>ADMIN_KEY</strong> still works as full admin when no session user is linked.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="uname">Username</Label>
              <Input id="uname" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label htmlFor="upass">Password</Label>
              <Input id="upass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label>Role</Label>
              <Select value={role} onValueChange={(v) => setRole(v as APITokenRole)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="operator">Operator</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {isLoading ? (
            <Spinner className="size-5" />
          ) : (
            <ul className="divide-y rounded-lg border">
              {(data ?? []).length === 0 ? (
                <li className="text-muted-foreground p-4 text-sm">No users yet — create one or keep using ADMIN_KEY.</li>
              ) : (
                data!.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                    <div>
                      <div className="font-medium">{u.username}</div>
                      <div className="text-muted-foreground text-xs capitalize">
                        {u.role} · since {dateTime(u.created_at)}
                      </div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDeleteId(u.id)}>
                      <Trash2Icon className="size-4" /> Remove
                    </Button>
                  </li>
                ))
              )}
            </ul>
          )}
        </CardContent>
        <CardFooter>
          <Button type="button" disabled={saving || password.length < 12} onClick={create}>
            {saving ? <Spinner className="size-4" /> : "Add user"}
          </Button>
        </CardFooter>
      </Card>
      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Remove user?" description="They will not be able to sign in again." confirmLabel="Remove" destructive onConfirm={remove} />
    </>
  );
}
