import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { getSale, listSales, voidSale } from "@/lib/pos/actions";
import { returnSale } from "@/lib/pos/returns";
import { can } from "@/lib/pos/roles";
import type { SaleDetail } from "@/lib/pos/types";
import { formatMoney } from "@/lib/utils";

export const Route = createFileRoute("/sales")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "sales")) return <Forbidden />;
  return <Sales />;
}

function Sales() {
  const session = usePosSession();
  const qc = useQueryClient();
  const sales = useQuery({ queryKey: ["sales"], queryFn: () => listSales() });
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<"cash" | "card" | "gift_card">("cash");
  const [giftCode, setGiftCode] = useState("");
  const canVoid = session.data ? can(session.data.member.role, "void") : false;

  const load = async (id: string) => {
    try {
      const sale = await getSale({ data: { id } });
      setDetail(sale);
      setQty(Object.fromEntries(sale.items.map((i) => [i.id, ""])));
      const gift = sale.payments.find((p) => p.method === "gift_card");
      setGiftCode(gift?.giftCardCode ?? "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load sale");
    }
  };

  const voidMut = useMutation({
    mutationFn: () => voidSale({ data: { id: detail!.id } }),
    onSuccess: () => {
      toast.success("Sale voided. Stock restored.");
      setDetail(null);
      void qc.invalidateQueries({ queryKey: ["sales"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ret = useMutation({
    mutationFn: () => {
      const lines = Object.entries(qty)
        .map(([saleItemId, raw]) => ({ saleItemId, quantity: Number.parseInt(raw, 10) }))
        .filter((l) => Number.isInteger(l.quantity) && l.quantity > 0);
      if (!lines.length) throw new Error("Enter a quantity to return");
      return returnSale({
        data: {
          saleId: detail!.id,
          lines,
          method,
          giftCardCode: giftCode || undefined,
        },
      });
    },
    onSuccess: (res) => {
      toast.success(`Return #${res.receiptNumber} · ${formatMoney(res.refundCents)} refunded`);
      setDetail(null);
      void qc.invalidateQueries({ queryKey: ["sales"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["gift-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Sales">
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[680px] text-left text-sm">
          <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Ticket</th>
              <th className="px-4 py-3 font-medium">Cashier</th>
              <th className="px-4 py-3 font-medium">When</th>
              <th className="px-4 py-3 font-medium text-right">Total</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {sales.data?.map((s) => (
              <tr
                key={s.id}
                className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/60"
                onClick={() => load(s.id)}
              >
                <td className="px-4 py-3 font-medium">#{s.receiptNumber}</td>
                <td className="px-4 py-3">{s.cashierName}</td>
                <td className="px-4 py-3 text-muted-foreground">{s.createdAt.replace("T", " ").slice(0, 16)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(s.totalCents)}</td>
                <td className="px-4 py-3">
                  {s.status === "voided" ? (
                    <Badge variant="danger">Voided</Badge>
                  ) : s.totalCents < 0 ? (
                    <Badge variant="warn">Return</Badge>
                  ) : (
                    <Badge>Paid</Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={Boolean(detail)} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ticket #{detail?.receiptNumber}</DialogTitle>
          </DialogHeader>
          {detail ? (
            <div className="space-y-3 text-sm">
              <div className="text-muted-foreground">
                {detail.cashierName} · {detail.createdAt.replace("T", " ").slice(0, 16)}
              </div>
              <ul className="divide-y divide-border">
                {detail.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="font-mono">
                      {i.quantity} × {i.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{formatMoney(i.lineTotalCents)}</span>
                      {detail.status === "completed" && detail.totalCents > 0 ? (
                        <Input
                          className="h-8 w-16"
                          inputMode="numeric"
                          placeholder="qty"
                          value={qty[i.id] ?? ""}
                          onChange={(e) => setQty((prev) => ({ ...prev, [i.id]: e.target.value }))}
                        />
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-between">
                <span>Tax</span>
                <span className="font-mono">{formatMoney(detail.taxCents)}</span>
              </div>
              {detail.discountCents ? (
                <div className="flex justify-between text-primary">
                  <span>Discount {detail.discountCode}</span>
                  <span className="font-mono">-{formatMoney(detail.discountCents)}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-base font-medium">
                <span>Total</span>
                <span className="font-mono">{formatMoney(detail.totalCents)}</span>
              </div>
              <div className="text-muted-foreground">
                Paid {detail.payments.map((p) => `${p.method} ${formatMoney(p.amountCents)}`).join(" + ")}
              </div>
              {detail.status === "completed" && detail.totalCents > 0 ? (
                <div className="grid gap-2 border-t border-border pt-3">
                  <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                    <option value="cash">Refund cash</option>
                    <option value="card">Refund card</option>
                    <option value="gift_card">Refund gift card</option>
                  </Select>
                  {method === "gift_card" ? (
                    <Input
                      className="uppercase"
                      placeholder="Gift card code"
                      value={giftCode}
                      onChange={(e) => setGiftCode(e.target.value.toUpperCase())}
                    />
                  ) : null}
                  <Button disabled={ret.isPending} onClick={() => ret.mutate()}>
                    Post return
                  </Button>
                </div>
              ) : null}
              {canVoid && detail.status === "completed" && detail.totalCents > 0 ? (
                <Button variant="destructive" disabled={voidMut.isPending} onClick={() => voidMut.mutate()}>
                  Void sale
                </Button>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
