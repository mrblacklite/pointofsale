import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, ShoppingCart } from "lucide-react";
import { AppShell, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDashboard } from "@/lib/pos/actions";
import { can } from "@/lib/pos/roles";
import { formatMoney } from "@/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { user, isPending } = useCurrentUserState();
  if (isPending || !user) return <Landing />;
  return <Dashboard />;
}

function Landing() {
  return (
    <main className="min-h-dvh bg-background">
      <header className="flex items-center justify-between px-5 py-5 md:px-10">
        <span className="font-display text-2xl tracking-tight">Till</span>
        <Button asChild>
          <Link to="/login">Sign in</Link>
        </Button>
      </header>
      <section className="mx-auto grid max-w-5xl gap-10 px-5 py-10 md:grid-cols-2 md:items-center md:py-20">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
            Point of sale
          </p>
          <h1 className="mt-3 font-display text-4xl leading-[1.05] tracking-tight md:text-6xl">
            The counter, kept honest.
          </h1>
          <p className="mt-5 max-w-md text-base text-muted-foreground">
            Ring sales, watch inventory, issue gift cards, and run the same register from a
            desktop program through the sales API.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/login">Open a store</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/login">Staff sign in</Link>
            </Button>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5 font-mono text-sm">
          <div className="text-xs tracking-wide text-muted-foreground uppercase">Ticket 1001</div>
          <div className="mt-4 space-y-2">
            <Line name="2 × Cola 2L" price="$5.98" />
            <Line name="Honeycrisp Apple" price="$1.29" />
            <Line name="Sourdough Loaf" price="$5.99" />
          </div>
          <div className="mt-4 flex justify-between border-t border-border pt-3">
            <span>Tax</span>
            <span>$1.09</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-medium">
            <span>Total</span>
            <span>$14.35</span>
          </div>
          <div className="mt-4 rounded-md bg-primary px-3 py-2 text-center text-primary-foreground">
            Paid · card
          </div>
        </div>
      </section>
    </main>
  );
}

function Line({ name, price }: { name: string; price: string }) {
  return (
    <div className="flex justify-between">
      <span>{name}</span>
      <span>{price}</span>
    </div>
  );
}

function Dashboard() {
  const session = usePosSession();
  const dash = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => getDashboard(),
    enabled: Boolean(session.data),
  });

  return (
    <AppShell title="Overview">
      {session.data?.seeded ? (
        <div className="mb-5 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          Your market is seeded with a grocery catalog, discounts, and sample gift cards so you can
          ring a sale immediately.
        </div>
      ) : null}

      {!dash.data ? (
        <div className="grid gap-4 md:grid-cols-4">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Today" value={formatMoney(dash.data.todayCents)} hint={`${dash.data.todayCount} tickets`} />
            <Stat label="This week" value={formatMoney(dash.data.weekCents)} hint="Completed sales" />
            <Stat label="Avg ticket" value={formatMoney(dash.data.avgTicketCents)} hint="Today" />
            <Stat label="Stock value" value={formatMoney(dash.data.inventoryValueCents)} hint="At cost" />
          </div>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Last seven days</CardTitle>
              <CardDescription>Completed ticket totals</CardDescription>
            </CardHeader>
            <CardContent>
              <WeekBars days={dash.data.weekSeries} />
            </CardContent>
          </Card>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
            <Card>
              <CardHeader>
                <CardTitle>Recent tickets</CardTitle>
                <CardDescription>Latest completed and voided sales</CardDescription>
              </CardHeader>
              <CardContent>
                {dash.data.recentSales.length === 0 ? (
                  <EmptyRegister canPos={session.data ? can(session.data.member.role, "pos") : false} />
                ) : (
                  <ul className="divide-y divide-border">
                    {dash.data.recentSales.map((s) => (
                      <li key={s.id} className="flex items-center justify-between py-3 text-sm">
                        <div>
                          <div className="font-medium">#{s.receiptNumber}</div>
                          <div className="text-muted-foreground">
                            {s.cashierName} · {s.itemCount} items
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono tabular-nums">{formatMoney(s.totalCents)}</div>
                          {s.status === "voided" ? <Badge variant="danger">Voided</Badge> : null}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Needs restock</CardTitle>
                <CardDescription>On-hand at or below the reorder point</CardDescription>
              </CardHeader>
              <CardContent>
                {dash.data.lowStock.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Shelves look healthy.</p>
                ) : (
                  <ul className="space-y-3">
                    {dash.data.lowStock.map((p) => (
                      <li key={p.id} className="flex items-start justify-between gap-3 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="font-mono text-xs text-muted-foreground">{p.sku}</div>
                        </div>
                        <Badge variant={p.quantity <= 0 ? "danger" : "warn"}>
                          <AlertTriangle className="mr-1 size-3" />
                          {p.quantity}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
                {session.data && can(session.data.member.role, "inventory") ? (
                  <Button asChild variant="outline" className="mt-4 w-full">
                    <Link to="/inventory">
                      Inventory <ArrowRight className="size-4" />
                    </Link>
                  </Button>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</div>
        <div className="mt-2 font-display text-3xl tracking-tight tabular-nums">{value}</div>
        <div className="mt-1 text-sm text-muted-foreground">{hint}</div>
      </CardContent>
    </Card>
  );
}

function WeekBars({ days }: { days: Array<{ day: string; cents: number; count: number }> }) {
  const max = Math.max(...days.map((d) => d.cents), 1);
  return (
    <div className="flex h-36 items-end gap-2">
      {days.map((d) => {
        const height = Math.max(6, Math.round((d.cents / max) * 120));
        const label = d.day.slice(5);
        return (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div
              className="w-full max-w-12 rounded-sm bg-primary"
              style={{ height }}
              title={`${d.count} tickets · ${formatMoney(d.cents)}`}
            />
            <span className="font-mono text-xs text-muted-foreground">{label}</span>
          </div>
        );
      })}
    </div>
  );
}

function EmptyRegister({ canPos }: { canPos: boolean }) {
  return (
    <div className="py-6 text-center">
      <p className="text-sm text-muted-foreground">No tickets yet today.</p>
      {canPos ? (
        <Button asChild className="mt-4">
          <Link to="/pos">
            <ShoppingCart className="size-4" /> Open register
          </Link>
        </Button>
      ) : null}
    </div>
  );
}
