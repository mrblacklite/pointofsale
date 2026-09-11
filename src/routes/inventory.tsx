import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adjustInventory, listMovements, listProducts } from "@/lib/pos/actions";
import { can } from "@/lib/pos/roles";
import { formatMoney } from "@/lib/utils";

export const Route = createFileRoute("/inventory")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "inventory")) return <Forbidden />;
  return <Inventory />;
}

function Inventory() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const products = useQuery({
    queryKey: ["products-all", q],
    queryFn: () => listProducts({ data: { q, includeInactive: true } }),
  });
  const moves = useQuery({ queryKey: ["movements"], queryFn: () => listMovements() });
  const [productId, setProductId] = useState("");
  const [delta, setDelta] = useState("12");
  const [reason, setReason] = useState<"receive" | "adjust" | "waste" | "count">("receive");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function onAdjust() {
    const raw = Number.parseInt(delta, 10);
    if (!productId || !Number.isInteger(raw) || raw === 0) {
      toast.error("Choose a product and a non-zero quantity");
      return;
    }
    const signed = reason === "waste" ? -Math.abs(raw) : reason === "receive" ? Math.abs(raw) : raw;
    setBusy(true);
    try {
      await adjustInventory({ data: { productId, delta: signed, reason, note: note || undefined } });
      toast.success("Inventory updated");
      void qc.invalidateQueries({ queryKey: ["products-all"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["movements"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not adjust stock");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Inventory">
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Receive / adjust</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Select product</option>
              {products.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.quantity})
                </option>
              ))}
            </Select>
            <Select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="receive">Receive shipment</option>
              <option value="adjust">Manual adjust (+/−)</option>
              <option value="count">Cycle count delta</option>
              <option value="waste">Waste / spoilage</option>
            </Select>
            <Input
              type="number"
              value={delta}
              onChange={(e) => setDelta(e.target.value)}
              placeholder="Quantity"
            />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
            <Button onClick={() => void onAdjust()} disabled={busy}>
              {busy ? "Saving…" : "Apply"}
            </Button>
            <p className="text-xs text-muted-foreground">
              Receive and waste use the absolute quantity. Adjust and count use the signed number you
              enter.
            </p>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Input placeholder="Filter by name or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
                <tr>
                  <th className="px-4 py-3 font-medium">Product</th>
                  <th className="px-4 py-3 font-medium text-right">On hand</th>
                  <th className="px-4 py-3 font-medium text-right">Reorder</th>
                  <th className="px-4 py-3 font-medium text-right">Value</th>
                  <th className="px-4 py-3 font-medium">Flag</th>
                </tr>
              </thead>
              <tbody>
                {products.data
                  ?.filter((p) => p.trackInventory)
                  .map((p) => (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{p.quantity}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{p.reorderPoint}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">
                        {formatMoney(p.costCents * p.quantity)}
                      </td>
                      <td className="px-4 py-3">
                        {p.quantity <= 0 ? (
                          <Badge variant="danger">Out</Badge>
                        ) : p.quantity <= p.reorderPoint ? (
                          <Badge variant="warn">Low</Badge>
                        ) : (
                          <Badge variant="muted">OK</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Movement log</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {moves.data?.map((m) => (
                  <li key={m.id} className="flex justify-between gap-3 py-2">
                    <div>
                      <div className="font-medium">
                        {m.productName}{" "}
                        <span className={m.delta < 0 ? "text-destructive" : "text-primary"}>
                          {m.delta > 0 ? "+" : ""}
                          {m.delta}
                        </span>
                      </div>
                      <div className="text-muted-foreground">
                        {m.reason} · {m.userName}
                        {m.note ? ` · ${m.note}` : ""}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">
                      {m.createdAt.replace("T", " ").slice(0, 16)}
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
