import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { listDiscounts, saveDiscount } from "@/lib/pos/actions";
import { can } from "@/lib/pos/roles";
import type { Discount } from "@/lib/pos/types";
import { formatMoney, parseMoneyToCents } from "@/lib/utils";

export const Route = createFileRoute("/discounts")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "discounts")) return <Forbidden />;
  return <Discounts />;
}

function Discounts() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["discounts"], queryFn: () => listDiscounts() });
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("10");
  const [min, setMin] = useState("0");

  const save = useMutation({
    mutationFn: (d: Omit<Discount, "id"> & { id?: string }) =>
      saveDiscount({
        data: {
          id: d.id,
          code: d.code,
          name: d.name,
          type: d.type,
          value: d.value,
          minSubtotalCents: d.minSubtotalCents,
          active: d.active,
        },
      }),
    onSuccess: () => {
      toast.success("Discount saved");
      setCode("");
      setName("");
      void qc.invalidateQueries({ queryKey: ["discounts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Discounts">
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <Card>
          <CardContent className="grid gap-3 pt-5">
            <div className="grid gap-1.5">
              <Label>Code</Label>
              <Input className="uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="WELCOME10" />
            </div>
            <div className="grid gap-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Welcome 10%" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label>Type</Label>
                <Select value={type} onChange={(e) => setType(e.target.value as typeof type)}>
                  <option value="percent">Percent</option>
                  <option value="fixed">Fixed $</option>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>{type === "percent" ? "Percent" : "Amount"}</Label>
                <Input value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label>Minimum subtotal</Label>
              <Input value={min} onChange={(e) => setMin(e.target.value)} />
            </div>
            <Button
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  code,
                  name,
                  type,
                  value: type === "percent" ? Number.parseInt(value, 10) || 0 : parseMoneyToCents(value),
                  minSubtotalCents: parseMoneyToCents(min),
                  active: true,
                })
              }
            >
              Add discount
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-2">
          {list.data?.map((d) => (
            <div key={d.id} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <div>
                <div className="font-mono text-sm">{d.code}</div>
                <div className="text-sm text-muted-foreground">{d.name}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">
                  {d.type === "percent" ? `${d.value}%` : formatMoney(d.value)}
                  {d.minSubtotalCents ? ` over ${formatMoney(d.minSubtotalCents)}` : ""}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => save.mutate({ ...d, active: !d.active })}
                >
                  {d.active ? "Disable" : "Enable"}
                </Button>
                {d.active ? <Badge>On</Badge> : <Badge variant="muted">Off</Badge>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
