import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, Plus, Search, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { HeldTickets } from "@/components/held-tickets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeSale, listCategories, listDiscounts, listProducts, lookupGiftCard } from "@/lib/pos/actions";
import { can } from "@/lib/pos/roles";
import type { Product } from "@/lib/pos/types";
import { cn, formatMoney } from "@/lib/utils";

export const Route = createFileRoute("/pos")({ component: PosPage });

type Line = { product: Product; quantity: number };

function PosPage() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "pos")) return <Forbidden />;
  return <Register />;
}

function Register() {
  const qc = useQueryClient();
  const session = usePosSession();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [cart, setCart] = useState<Line[]>([]);
  const [discountCode, setDiscountCode] = useState("");
  const [giftCode, setGiftCode] = useState("");
  const [giftCents, setGiftCents] = useState(0);
  const [method, setMethod] = useState<"cash" | "card">("card");
  const [tendered, setTendered] = useState("");
  const [receipt, setReceipt] = useState<Awaited<ReturnType<typeof completeSale>> | null>(null);
  const [mobileTicket, setMobileTicket] = useState(false);

  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const discounts = useQuery({ queryKey: ["discounts"], queryFn: () => listDiscounts() });
  const products = useQuery({
    queryKey: ["products", q, categoryId],
    queryFn: () => listProducts({ data: { q, categoryId: categoryId ?? undefined } }),
  });

  const subtotal = cart.reduce((s, l) => s + l.product.priceCents * l.quantity, 0);
  const taxRateBps = session.data?.store.taxRateBps ?? 0;
  const rawTax = cart.reduce(
    (s, l) =>
      s + (l.product.taxExempt ? 0 : Math.round((l.product.priceCents * l.quantity * taxRateBps) / 10000)),
    0,
  );
  const code = discountCode.trim().toUpperCase();
  const offer = discounts.data?.find((d) => d.active && d.code === code);
  const discountCents =
    offer && subtotal >= offer.minSubtotalCents
      ? offer.type === "percent"
        ? Math.round((subtotal * offer.value) / 100)
        : Math.min(subtotal, offer.value)
      : 0;
  const discounted = Math.max(0, subtotal - discountCents);
  const taxScale = subtotal === 0 ? 0 : discounted / subtotal;
  const tax = Math.round(rawTax * taxScale);
  const total = discounted + tax;
  const giftApplied = Math.min(giftCents, total);
  const due = Math.max(0, total - giftApplied);
  const tenderedCents = method === "cash" ? Math.round(Number.parseFloat(tendered || "0") * 100) : due;
  const change = method === "cash" ? Math.max(0, tenderedCents - due) : 0;

  function add(product: Product) {
    if (product.trackInventory && product.quantity <= 0) {
      toast.error(`${product.name} is out of stock`);
      return;
    }
    setCart((prev) => {
      const i = prev.findIndex((l) => l.product.id === product.id);
      if (i === -1) return [...prev, { product, quantity: 1 }];
      const next = [...prev];
      const qty = next[i].quantity + 1;
      if (product.trackInventory && qty > product.quantity) {
        toast.error("Not enough on hand");
        return prev;
      }
      next[i] = { ...next[i], quantity: qty };
      return next;
    });
  }

  function setQty(id: string, quantity: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.product.id === id ? { ...l, quantity } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  const lookup = useMutation({
    mutationFn: () => lookupGiftCard({ data: { code: giftCode } }),
    onSuccess: (card) => {
      if (card.status !== "active") {
        toast.error("Card is disabled");
        return;
      }
      setGiftCents(card.balanceCents);
      toast.success(`Balance ${formatMoney(card.balanceCents)}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pay = useMutation({
    mutationFn: () => {
      if (!cart.length) throw new Error("Cart is empty");
      if (method === "cash" && tenderedCents < due) throw new Error("Cash tendered is short");
      const payments: Array<{
        method: "cash" | "card" | "gift_card";
        amountCents: number;
        giftCardCode?: string | null;
      }> = [];
      if (giftApplied > 0) {
        payments.push({ method: "gift_card", amountCents: giftApplied, giftCardCode: giftCode });
      }
      if (due > 0) {
        payments.push({ method, amountCents: due });
      }
      if (!payments.length) throw new Error("Nothing to tender");
      return completeSale({
        data: {
          lines: cart.map((l) => ({ productId: l.product.id, quantity: l.quantity })),
          discountCode: discountCents > 0 ? discountCode.trim() : null,
          payments,
          tenderedCents: method === "cash" ? tenderedCents + giftApplied : undefined,
        },
      });
    },
    onSuccess: (res) => {
      setReceipt(res);
      setCart([]);
      setDiscountCode("");
      setGiftCode("");
      setGiftCents(0);
      setTendered("");
      setMobileTicket(false);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["dashboard"] });
      void qc.invalidateQueries({ queryKey: ["sales"] });
      void qc.invalidateQueries({ queryKey: ["gift-cards"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const ticket = (
    <Ticket
      cart={cart}
      setQty={setQty}
      clear={() => setCart([])}
      discountCode={discountCode}
      setDiscountCode={setDiscountCode}
      giftCode={giftCode}
      setGiftCode={setGiftCode}
      giftCents={giftCents}
      onLookup={() => lookup.mutate()}
      looking={lookup.isPending}
      method={method}
      setMethod={setMethod}
      tendered={tendered}
      setTendered={setTendered}
      subtotal={subtotal}
      discountCents={discountCents}
      tax={tax}
      total={total}
      giftApplied={giftApplied}
      due={due}
      change={change}
      paying={pay.isPending}
      onPay={() => pay.mutate()}
      taxLabel={`${((session.data?.store.taxRateBps ?? 0) / 100).toFixed(2)}%`}
    />
  );

  return (
    <AppShell
      title="Register"
      actions={
        <Button className="lg:hidden" variant="secondary" onClick={() => setMobileTicket(true)}>
          Ticket · {formatMoney(total)}
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Name, SKU, or barcode"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" || !products.data?.length) return;
                const needle = q.trim().toLowerCase();
                const exact = products.data.find(
                  (p) => p.sku.toLowerCase() === needle || (p.barcode && p.barcode.toLowerCase() === needle),
                );
                add(exact ?? products.data[0]);
                setQ("");
              }}
            />
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <Chip active={!categoryId} onClick={() => setCategoryId(null)}>
              All
            </Chip>
            {cats.data?.map((c) => (
              <Chip key={c.id} active={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                {c.name}
              </Chip>
            ))}
          </div>
          <HeldTickets
            cart={cart}
            discountCode={discountCode}
            onParked={() => {
              setCart([]);
              setDiscountCode("");
              setGiftCode("");
              setGiftCents(0);
              setTendered("");
            }}
            onResume={(payload) => {
              setCart(payload.cart);
              setDiscountCode(payload.discountCode);
              setGiftCode("");
              setGiftCents(0);
            }}
          />
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            {products.data?.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => add(p)}
                className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/40 hover:bg-secondary"
              >
                <div className="font-medium leading-snug">{p.name}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{p.sku}</div>
                <div className="mt-3 flex items-end justify-between">
                  <span className="font-mono text-sm tabular-nums">{formatMoney(p.priceCents)}</span>
                  {p.trackInventory ? (
                    <span className={cn("text-xs", p.quantity <= p.reorderPoint ? "text-warn" : "text-muted-foreground")}>
                      {p.quantity} left
                    </span>
                  ) : null}
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="hidden lg:block">{ticket}</div>
      </div>
      {mobileTicket ? (
        <div className="fixed inset-0 z-40 bg-ink/40 lg:hidden" onClick={() => setMobileTicket(false)}>
          <div className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto rounded-t-xl bg-card p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl">Ticket</h2>
              <Button variant="ghost" size="icon-sm" onClick={() => setMobileTicket(false)}><X /></Button>
            </div>
            {ticket}
          </div>
        </div>
      ) : null}
      <Dialog open={Boolean(receipt)} onOpenChange={(o) => !o && setReceipt(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Ticket #{receipt?.receiptNumber}</DialogTitle>
            <DialogDescription>{receipt?.storeName}</DialogDescription>
          </DialogHeader>
          {receipt ? (
            <div className="font-mono text-sm">
              {receipt.items.map((i) => (
                <div key={i.sku} className="flex justify-between py-1">
                  <span>{i.quantity} × {i.name}</span>
                  <span>{formatMoney(i.lineTotalCents)}</span>
                </div>
              ))}
              <div className="mt-3 flex justify-between border-t border-border pt-2"><span>Tax</span><span>{formatMoney(receipt.taxCents)}</span></div>
              {receipt.discountCents ? <div className="flex justify-between text-primary"><span>Discount</span><span>-{formatMoney(receipt.discountCents)}</span></div> : null}
              <div className="mt-1 flex justify-between text-base font-medium"><span>Total</span><span>{formatMoney(receipt.totalCents)}</span></div>
              {receipt.changeCents > 0 ? <div className="mt-1 flex justify-between"><span>Change</span><span>{formatMoney(receipt.changeCents)}</span></div> : null}
              <p className="mt-4 text-center text-xs text-muted-foreground">{receipt.receiptFooter}</p>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Chip({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-9 shrink-0 rounded-full px-3 text-sm", active ? "bg-ink text-paper" : "bg-secondary text-foreground")}>
      {children}
    </button>
  );
}

function Ticket(props: {
  cart: Line[];
  setQty: (id: string, q: number) => void;
  clear: () => void;
  discountCode: string;
  setDiscountCode: (v: string) => void;
  giftCode: string;
  setGiftCode: (v: string) => void;
  giftCents: number;
  onLookup: () => void;
  looking: boolean;
  method: "cash" | "card";
  setMethod: (m: "cash" | "card") => void;
  tendered: string;
  setTendered: (v: string) => void;
  subtotal: number;
  discountCents: number;
  tax: number;
  total: number;
  giftApplied: number;
  due: number;
  change: number;
  paying: boolean;
  onPay: () => void;
  taxLabel: string;
}) {
  const quick = useMemo(() => {
    const due = props.due;
    const options = [due, Math.ceil(due / 500) * 500, Math.ceil(due / 1000) * 1000, due + 500];
    return [...new Set(options.filter((n) => n >= due))].slice(0, 4);
  }, [props.due]);
  return (
    <aside className="flex flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-display text-lg">Ticket</h2>
        {props.cart.length ? (
          <button type="button" className="text-xs text-muted-foreground hover:text-destructive" onClick={props.clear}>Clear</button>
        ) : null}
      </div>
      <div className="min-h-40 flex-1 space-y-2 p-3">
        {props.cart.length === 0 ? (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">Tap a product to start a ticket.</p>
        ) : (
          props.cart.map((l) => (
            <div key={l.product.id} className="flex items-center gap-2 rounded-md bg-secondary/60 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{l.product.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{formatMoney(l.product.priceCents)}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-sm" className="size-8" onClick={() => props.setQty(l.product.id, l.quantity - 1)}>{l.quantity === 1 ? <Trash2 /> : <Minus />}</Button>
                <span className="w-6 text-center font-mono text-sm tabular-nums">{l.quantity}</span>
                <Button variant="ghost" size="icon-sm" className="size-8" onClick={() => props.setQty(l.product.id, l.quantity + 1)}><Plus /></Button>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="space-y-3 border-t border-border p-4">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-muted-foreground">Discount code</Label>
            <Input className="h-9 uppercase" value={props.discountCode} onChange={(e) => props.setDiscountCode(e.target.value.toUpperCase())} placeholder="WELCOME10" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Gift card</Label>
            <div className="flex gap-1">
              <Input className="h-9 uppercase" value={props.giftCode} onChange={(e) => props.setGiftCode(e.target.value.toUpperCase())} placeholder="TILL-2500" />
              <Button variant="outline" size="sm" className="h-9" onClick={props.onLookup} disabled={props.looking}>Use</Button>
            </div>
          </div>
        </div>
        {props.giftCents > 0 ? <Badge>Gift card {formatMoney(props.giftCents)} available</Badge> : null}
        <div className="space-y-1 font-mono text-sm tabular-nums">
          <Row k="Subtotal" v={formatMoney(props.subtotal)} />
          {props.discountCents > 0 ? <Row k="Discount" v={`-${formatMoney(props.discountCents)}`} /> : props.discountCode.trim() ? <p className="text-xs text-warn">Code doesn’t apply to this ticket yet.</p> : null}
          <Row k={`Tax ${props.taxLabel}`} v={formatMoney(props.tax)} />
          {props.giftApplied > 0 ? <Row k="Gift card" v={`-${formatMoney(props.giftApplied)}`} /> : null}
          <Row k="Due" v={formatMoney(props.due)} strong />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant={props.method === "card" ? "default" : "outline"} onClick={() => props.setMethod("card")}>Card</Button>
          <Button variant={props.method === "cash" ? "default" : "outline"} onClick={() => props.setMethod("cash")}>Cash</Button>
        </div>
        {props.method === "cash" ? (
          <div>
            <Label className="text-xs text-muted-foreground">Tendered</Label>
            <Input className="h-11 font-mono" inputMode="decimal" value={props.tendered} onChange={(e) => props.setTendered(e.target.value)} placeholder={(props.due / 100).toFixed(2)} />
            <div className="mt-2 flex flex-wrap gap-1">
              {quick.map((c) => (
                <button key={c} type="button" className="rounded-full bg-secondary px-2.5 py-1 text-xs" onClick={() => props.setTendered((c / 100).toFixed(2))}>{formatMoney(c)}</button>
              ))}
            </div>
            {props.change > 0 ? <p className="mt-2 text-sm">Change <span className="font-mono tabular-nums">{formatMoney(props.change)}</span></p> : null}
          </div>
        ) : null}
        <Button className="w-full" size="lg" disabled={!props.cart.length || props.paying} onClick={props.onPay}>
          {props.paying ? "Recording…" : `Charge ${formatMoney(props.due)}`}
        </Button>
      </div>
    </aside>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cn("flex justify-between", strong && "text-base font-medium")}>
      <span className={strong ? "" : "text-muted-foreground"}>{k}</span>
      <span>{v}</span>
    </div>
  );
}
