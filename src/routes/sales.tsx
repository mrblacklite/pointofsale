import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getSale, listSales, voidSale } from "@/lib/pos/actions";
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
  const canVoid = session.data ? can(session.data.member.role, "void") : false;

  const load = async (id: string) => {
    try {
      setDetail(await getSale({ data: { id } }));
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
                <td className="px-4 py-3 text-muted-foreground">
                  {s.createdAt.replace("T", " ").slice(0, 16)}
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(s.totalCents)}</td>
                <td className="px-4 py-3">
                  {s.status === "voided" ? <Badge variant="danger">Voided</Badge> : <Badge>Paid</Badge>}
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
              <ul className="divide-y divide-border font-mono">
                {detail.items.map((i) => (
                  <li key={i.id} className="flex justify-between py-1.5">
                    <span>
                      {i.quantity} × {i.name}
                    </span>
                    <span>{formatMoney(i.lineTotalCents)}</span>
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
                Paid{" "}
                {detail.payments.map((p) => `${p.method} ${formatMoney(p.amountCents)}`).join(" + ")}
              </div>
              {canVoid && detail.status === "completed" ? (
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
