import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createStaff, listStaff, updateStaff } from "@/lib/pos/actions";
import { can, ROLE_BLURB, ROLE_LABEL, ROLES, type Role } from "@/lib/pos/roles";

export const Route = createFileRoute("/staff")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "staff")) return <Forbidden />;
  return <Staff />;
}

function Staff() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["staff"], queryFn: () => listStaff() });
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Role>("cashier");
  const [password, setPassword] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createStaff({
        data: {
          email,
          displayName,
          role,
          password: password.trim() || undefined,
        },
      }),
    onSuccess: (res) => {
      toast.success(res.pending ? "Invite saved — they join on first sign-in" : "Staff account ready");
      setEmail("");
      setDisplayName("");
      setPassword("");
      void qc.invalidateQueries({ queryKey: ["staff"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Staff">
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Add someone</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Role</Label>
              <Select value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{ROLE_BLURB[role]}</p>
            </div>
            <div className="grid gap-1.5">
              <Label>Password (optional)</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} />
              <p className="text-xs text-muted-foreground">
                Set a password to create their login now. Leave blank to invite — they join when they
                sign up with this email.
              </p>
            </div>
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              Add staff
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {list.data?.map((s) => (
            <div key={s.id} className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">{s.displayName}</div>
                <div className="text-sm text-muted-foreground">{s.email}</div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {s.pending ? <Badge variant="warn">Pending</Badge> : null}
                {!s.active ? <Badge variant="danger">Disabled</Badge> : null}
                <Select
                  className="w-36"
                  value={s.role}
                  onChange={(e) =>
                    updateStaff({ data: { id: s.id, role: e.target.value as Role, pending: s.pending } })
                      .then(() => qc.invalidateQueries({ queryKey: ["staff"] }))
                      .catch((err: Error) => toast.error(err.message))
                  }
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateStaff({ data: { id: s.id, active: s.pending ? false : !s.active, pending: s.pending } })
                      .then(() => qc.invalidateQueries({ queryKey: ["staff"] }))
                      .catch((err: Error) => toast.error(err.message))
                  }
                >
                  {s.pending ? "Revoke" : s.active ? "Disable" : "Enable"}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
