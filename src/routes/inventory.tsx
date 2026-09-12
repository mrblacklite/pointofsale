import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { adjustInventory, listMovements, listProducts } from "@/lib/pos/actions";
import { cycleCountDelta, stockFlag } from "@/lib/pos/ops-math";
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
  const [lowOnly, setLowOnly] = useState(false);
  const products = useQuery({
    queryKey: ["products-all", q],
    queryFn: () => listProducts({ data: { q, includeInactive: true } }),
  });
  const moves = useQuery({ queryKey: ["movements"], queryFn: () => listMovements() });
  const [productId, setProductId] = useState("");
  const [qty, setQty] = useState("12");
  const [reason, setReason] = useState<"receive" | "adjust" | "waste" | "count">("receive");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const tracked = useMemo(
    () => (products.data ?? []).filter((p) => p.trackInventory),
    [products.data],
  );
  const selected = tracked.find((p) => p.id === productId);
  const low = tracked.filter((p) => stockFlag(p.quantity, p.reorderPoint) !== "ok");
  const rows = lowOnly ? tracked.filter((p) => stockFlag(p.quantity, p.reorderPoint) !== "ok") : tracked;

  async function onAdjust() {
    const raw = Number.parseInt(qty, 10);
    if (!productId || !Number.isInteger(raw)) {
      toast.error("Choose a product and a quantity");
      return;
    }
    let delta = raw;
    if (reason === "waste") delta = -Math.abs(raw);
    if (reason === "receive") delta = Math.abs(raw);
    if (reason === "count") {
      if (!selected) {
        toast.error("Choose a product to count");
        return;
      }
      if (raw < 0) {
        toast.error("Counted quantity cannot be negative");
        return;
      }
      delta = cycleCountDelta(selected.quantity, raw);
      if (delta === 0) {
        toast.error("Count matches on-hand");
        return;
      }
    }
    if (delta === 0) {
      toast.error("Quantity change cannot be zero");
      return;
    }
    setBusy(true);
    try {
      await adjustInventory({
        data: {
          productId,
          delta,
          reason,
          note: note || (reason === "count" ? `Counted ${raw}` : undefined),
        },
      });
      toast.success(reason === "count" ? `Count posted (${delta > 0 ? "+" : ""}${delta})` : "Inventory updated");
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
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Receive / count</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Select value={productId} onChange={(e) => setProductId(e.target.value)}>
                <option value="">Select product</option>
                {tracked.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.quantity})
                  </option>
                ))}
              </Select>
              <Select value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
                <option value="receive">Receive shipment</option>
                <option value="count">Cycle count (counted qty)</option>
                <option value="adjust">Manual adjust (+/−)</option>
                <option value="waste">Waste / spoilage</option>
              </Select>
              <Input
                type="number"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder={reason === "count" ? "Counted on hand" : "Quantity"}
              />
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
              {reason === "count" && selected ? (
                <p className="text-xs text-muted-foreground">
                  On hand {selected.quantity}. Posting will apply {cycleCountDelta(selected.quantity, Number.parseInt(qty, 10) || 0)}.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Receive and waste use absolute qty. Adjust is signed. Count is the number on the shelf.
                </p>
              )}
              <Button onClick={() => void onAdjust()} disabled={busy}>
                {busy ? "Saving…" : "Apply"}
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Low stock</CardTitle>
            </CardHeader>
            <CardContent>
              {low.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing at or below reorder.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {low.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-2">
                      <button type="button" className="text-left" onClick={() => setProductId(p.id)}>
                        <div className="font-medium">{p.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                      </button>
                      <Badge variant={stockFlag(p.quantity, p.reorderPoint) === "out" ? "danger" : "warn"}>
                        {p.quantity} / {p.reorderPoint}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-48 flex-1" placeholder="Filter by name or SKU" value={q} onChange={(e) => setQ(e.target.value)} />
            <Button variant={lowOnly ? "default" : "outline"} onClick={() => setLowOnly((v) => !v)}>
              Low only
            </Button>
          </div>
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
                {rows.map((p) => {
                  const flag = stockFlag(p.quantity, p.reorderPoint);
                  return (
                    <tr key={p.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium">{p.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{p.quantity}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{p.reorderPoint}</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(p.costCents * p.quantity)}</td>
                      <td className="px-4 py-3">
                        {flag === "out" ? <Badge variant="danger">Out</Badge> : flag === "low" ? <Badge variant="warn">Low</Badge> : <Badge variant="muted">OK</Badge>}
                      </td>
                    </tr>
                  );
                })}
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
                    <div className="shrink-0 text-xs text-muted-foreground">{m.createdAt.replace("T", " ").slice(0, 16)}</div>
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
