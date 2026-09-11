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
import { issueGiftCard, listGiftCards, setGiftCardStatus } from "@/lib/pos/actions";
import { can } from "@/lib/pos/roles";
import { formatMoney, parseMoneyToCents } from "@/lib/utils";

export const Route = createFileRoute("/gift-cards")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "gift_cards")) return <Forbidden />;
  return <GiftCards />;
}

function GiftCards() {
  const session = usePosSession();
  const canIssue = session.data ? can(session.data.member.role, "gift_cards_issue") : false;
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["gift-cards"], queryFn: () => listGiftCards() });
  const [amount, setAmount] = useState("25");
  const [code, setCode] = useState("");
  const [issued, setIssued] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: () =>
      issueGiftCard({
        data: { amountCents: parseMoneyToCents(amount), code: code.trim() || undefined },
      }),
    onSuccess: (res) => {
      setIssued(res.code);
      setCode("");
      toast.success("Gift card issued");
      void qc.invalidateQueries({ queryKey: ["gift-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Gift cards">
      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {canIssue ? (
          <Card>
            <CardHeader>
              <CardTitle>Issue a card</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Amount</Label>
                <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label>Code (optional)</Label>
                <Input className="uppercase" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto-generated" />
              </div>
              <Button disabled={issue.isPending} onClick={() => issue.mutate()}>
                Issue
              </Button>
              {issued ? (
                <p className="rounded-md bg-secondary px-3 py-2 font-mono text-sm">
                  New code {issued}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                Demo cards TILL-2500 ($25) and TILL-5000 ($50) are already on the ledger.
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-5 text-sm text-muted-foreground">
              Cashiers can redeem gift cards on the register. Supervisors issue new ones.
            </CardContent>
          </Card>
        )}

        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium text-right">Balance</th>
                <th className="px-4 py-3 font-medium text-right">Issued</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.map((g) => (
                <tr key={g.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3 font-mono">{g.code}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(g.balanceCents)}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(g.initialCents)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {g.status === "active" ? <Badge>Active</Badge> : <Badge variant="muted">Disabled</Badge>}
                      {canIssue ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setGiftCardStatus({
                              data: { id: g.id, status: g.status === "active" ? "disabled" : "active" },
                            })
                              .then(() => qc.invalidateQueries({ queryKey: ["gift-cards"] }))
                              .catch((e: Error) => toast.error(e.message))
                          }
                        >
                          {g.status === "active" ? "Disable" : "Enable"}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
