import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { listStoreCustomers, setCustomerCredit } from "@/lib/pos/customer-account";
import { can } from "@/lib/pos/roles";
import { formatMoney } from "@/lib/utils";
import { useState } from "react";

export const Route = createFileRoute("/customers")({ component: CustomersPage });

function CustomersPage() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "staff")) return <Forbidden />;
  return (
    <AppShell title="Customers">
      <CustomerTable />
    </AppShell>
  );
}

function CustomerTable() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["store-customers"], queryFn: () => listStoreCustomers() });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (p: { customerId: string; creditCents: number }) => setCustomerCredit(p),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["store-customers"] }),
  });
  return (
    <Card>
      <CardHeader>
        <CardTitle>Store credit</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 text-sm">
              <div className="min-w-40 flex-1">
                <div className="font-medium">{c.name}</div>
                <div className="text-muted-foreground">{c.email ?? "No email"}</div>
              </div>
              <div className="font-mono text-xs">{formatMoney(c.creditCents)} credit</div>
              <Input
                className="w-28"
                inputMode="decimal"
                placeholder="0.00"
                value={draft[c.id] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [c.id]: e.target.value }))}
              />
              <Button
                size="sm"
                disabled={save.isPending}
                onClick={() => {
                  const dollars = Number(draft[c.id]);
                  if (!Number.isFinite(dollars) || dollars < 0) return;
                  save.mutate({ customerId: c.id, creditCents: Math.round(dollars * 100) });
                }}
              >
                Set credit
              </Button>
            </li>
          ))}
        </ul>
        {list.data?.length === 0 ? <p className="text-sm text-muted-foreground">No customers yet.</p> : null}
      </CardContent>
    </Card>
  );
}
