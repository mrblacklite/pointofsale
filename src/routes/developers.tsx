import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { createApiKey, listApiKeys, revokeApiKey } from "@/lib/pos/actions";
import { can } from "@/lib/pos/roles";

export const Route = createFileRoute("/developers")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "api_keys")) return <Forbidden />;
  return <Developers />;
}

function Developers() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ["api-keys"], queryFn: () => listApiKeys() });
  const [name, setName] = useState("Desktop register");
  const [token, setToken] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createApiKey({ data: { name } }),
    onSuccess: (res) => {
      setToken(res.token);
      toast.success("Copy the key now — it won’t be shown again");
      void qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const origin = typeof window !== "undefined" ? window.location.origin : "https://your-till-host";

  return (
    <AppShell title="Sales API">
      <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>API keys</CardTitle>
            <CardDescription>Bearer tokens for Windows, Mac, and Linux registers.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
            <Button disabled={create.isPending} onClick={() => create.mutate()}>
              Generate key
            </Button>
            {token ? (
              <pre className="overflow-x-auto rounded-md bg-ink px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-paper">{token}</pre>
            ) : null}
            <ul className="space-y-2 text-sm">
              {keys.data?.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <div>
                    <div className="font-medium">{k.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{k.keyPrefix}…</div>
                  </div>
                  {k.revoked ? (
                    <Badge variant="muted">Revoked</Badge>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        revokeApiKey({ data: { id: k.id } })
                          .then(() => qc.invalidateQueries({ queryKey: ["api-keys"] }))
                          .catch((e: Error) => toast.error(e.message))
                      }
                    >
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Endpoints</CardTitle>
            <CardDescription>All routes live under /api/v1 and require Authorization: Bearer till_…</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <p>
              Point a desktop program at <span className="font-mono">{origin}/api/v1</span>. CORS is open so
              native wrappers and local tools can call it.
            </p>
            <Code>{`GET  /api/v1
GET  /api/v1/products?q=cola
GET  /api/v1/products/BEV-COLA
POST /api/v1/products
PATCH /api/v1/products/BEV-COLA
GET  /api/v1/categories
GET  /api/v1/inventory
POST /api/v1/inventory/adjust
     { "sku": "PRD-APL", "delta": 12, "reason": "receive", "note": "PO-88" }
GET  /api/v1/discounts
GET  /api/v1/gift-cards/TILL-2500
POST /api/v1/gift-cards
     { "amount_cents": 2500 }
GET  /api/v1/sales
GET  /api/v1/sales/1001
POST /api/v1/sales/quote
POST /api/v1/sales
POST /api/v1/sales/1001/void`}</Code>
            <p className="text-muted-foreground">Quote a ticket without moving stock, then commit:</p>
            <Code>{`curl -X POST ${origin}/api/v1/sales/quote \\
  -H "Authorization: Bearer till_…" \\
  -H "Content-Type: application/json" \\
  -d '{ "items": [{ "sku": "BEV-COLA", "quantity": 2 }], "discount_code": "WELCOME10" }'`}</Code>
            <p className="text-muted-foreground">Record a sale and decrement inventory:</p>
            <Code>{`curl -X POST ${origin}/api/v1/sales \\
  -H "Authorization: Bearer till_…" \\
  -H "Content-Type: application/json" \\
  -d '{
    "items": [{ "sku": "BEV-COLA", "quantity": 2 }],
    "discount_code": "WELCOME10",
    "payments": [{ "method": "card", "amount_cents": 600 }]
  }'`}</Code>
            <p className="text-muted-foreground">
              Payment amounts must cover the computed total (after tax and discount). Gift cards:
              method <span className="font-mono">gift_card</span> plus <span className="font-mono">gift_card_code</span>.
              Unknown SKUs and insufficient stock return 400 with an error string.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-ink p-4 font-mono text-xs leading-relaxed text-paper">
      {children}
    </pre>
  );
}
