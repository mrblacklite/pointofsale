import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listProducts } from "@/lib/pos/actions";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  listPurchaseOrders,
  listSuppliers,
  receivePurchaseOrder,
  saveSupplier,
} from "@/lib/pos/purchasing";
import { can } from "@/lib/pos/roles";
import { formatMoney } from "@/lib/utils";

export const Route = createFileRoute("/purchasing")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "inventory")) return <Forbidden />;
  return <Purchasing />;
}

function Purchasing() {
  const qc = useQueryClient();
  const suppliers = useQuery({ queryKey: ["suppliers"], queryFn: () => listSuppliers() });
  const pos = useQuery({ queryKey: ["pos-list"], queryFn: () => listPurchaseOrders() });
  const products = useQuery({
    queryKey: ["products-all", ""],
    queryFn: () => listProducts({ data: { includeInactive: true } }),
  });
  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("12");
  const [cost, setCost] = useState("0");
  const [openId, setOpenId] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["po", openId],
    queryFn: () => getPurchaseOrder({ data: { id: openId! } }),
    enabled: Boolean(openId),
  });

  const addSupplier = useMutation({
    mutationFn: () => saveSupplier({ data: { name } }),
    onSuccess: () => {
      toast.success("Supplier saved");
      setName("");
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createPo = useMutation({
    mutationFn: () => {
      const quantity = Number.parseInt(qty, 10);
      const costCents = Math.round(Number.parseFloat(cost || "0") * 100);
      if (!supplierId || !productId || !Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Supplier, product, and quantity required");
      }
      return createPurchaseOrder({
        data: { supplierId, lines: [{ productId, quantity, costCents: Math.max(0, costCents) }] },
      });
    },
    onSuccess: () => {
      toast.success("PO created");
      void qc.invalidateQueries({ queryKey: ["pos-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const receive = useMutation({
    mutationFn: (id: string) => receivePurchaseOrder({ data: { id } }),
    onSuccess: () => {
      toast.success("Received into inventory");
      void qc.invalidateQueries({ queryKey: ["pos-list"] });
      void qc.invalidateQueries({ queryKey: ["po"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["products-all"] });
      void qc.invalidateQueries({ queryKey: ["movements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Purchasing">
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Supplier</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
              <Button disabled={addSupplier.isPending || !name.trim()} onClick={() => addSupplier.mutate()}>
                Add supplier
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>New PO</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Supplier</option>
                {suppliers.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
              <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Product</option>
                {products.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
              <Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="Qty" />
              <Input value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Unit cost $" />
              <Button disabled={createPo.isPending} onClick={() => createPo.mutate()}>
                Create PO
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Supplier</th>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {pos.data?.map((p) => (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/60"
                    onClick={() => setOpenId(p.id)}
                  >
                    <td className="px-4 py-3 font-medium">{p.supplierName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{p.createdAt.replace("T", " ").slice(0, 16)}</td>
                    <td className="px-4 py-3">
                      {p.status === "received" ? <Badge>Received</Badge> : <Badge variant="warn">{p.status}</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {detail.data ? (
            <Card>
              <CardHeader>
                <CardTitle>
                  {detail.data.supplierName}{" "}
                  {detail.data.status === "open" ? (
                    <Button size="sm" className="ml-2" disabled={receive.isPending} onClick={() => receive.mutate(detail.data!.id)}>
                      Receive all
                    </Button>
                  ) : null}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {detail.data.lines.map((l) => (
                    <li key={l.id} className="flex justify-between">
                      <span>
                        {l.name} · {l.sku}
                      </span>
                      <span className="font-mono">
                        {l.receivedQty}/{l.quantity} · {formatMoney(l.costCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}
