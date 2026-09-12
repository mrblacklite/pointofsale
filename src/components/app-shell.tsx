import { Link, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Boxes,
  Clock,
  Gift,
  KeyRound,
  LayoutDashboard,
  Menu,
  Package,
  Receipt,
  Settings,
  ShoppingCart,
  Tag,
  Truck,
  Users,
  X,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { RedirectToSignIn, UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getSessionContext } from "@/lib/pos/actions";
import { can, ROLE_LABEL, type Permission } from "@/lib/pos/roles";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

const NAV: Array<{ to: string; label: string; icon: typeof LayoutDashboard; perm: Permission | "account" }> = [
  { to: "/", label: "Overview", icon: LayoutDashboard, perm: "sales" },
  { to: "/pos", label: "Register", icon: ShoppingCart, perm: "pos" },
  { to: "/time-clock", label: "Time clock", icon: Clock, perm: "sales" },
  { to: "/products", label: "Catalog", icon: Package, perm: "catalog" },
  { to: "/inventory", label: "Inventory", icon: Boxes, perm: "inventory" },
  { to: "/purchasing", label: "Purchasing", icon: Truck, perm: "inventory" },
  { to: "/sales", label: "Sales", icon: Receipt, perm: "sales" },
  { to: "/discounts", label: "Discounts", icon: Tag, perm: "discounts" },
  { to: "/gift-cards", label: "Gift cards", icon: Gift, perm: "gift_cards" },
  { to: "/staff", label: "Staff", icon: Users, perm: "staff" },
  { to: "/customers", label: "Customers", icon: Users, perm: "sales" },
  { to: "/developers", label: "API", icon: KeyRound, perm: "api_keys" },
  { to: "/settings", label: "Store", icon: Settings, perm: "settings" },
];

export function AppShell({
  children,
  title,
  actions,
}: {
  children: ReactNode;
  title: string;
  actions?: ReactNode;
}) {
  const { user, isPending } = useCurrentUserState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = useQuery({
    queryKey: ["pos-session"],
    queryFn: () => getSessionContext(),
    enabled: Boolean(user),
  });
  const [open, setOpen] = useState(false);

  if (isPending) return <ShellSkeleton />;
  if (!user) {
    return (
      <>
        <div className="grid min-h-dvh place-items-center bg-background px-6 text-center">
          <div>
            <p className="font-display text-3xl tracking-tight">Till</p>
            <p className="mt-2 text-sm text-muted-foreground">Taking you to sign in…</p>
          </div>
        </div>
        <RedirectToSignIn />
      </>
    );
  }

  const role = session.data?.member.role;
  const items =
    role === "customer"
      ? [{ to: "/", label: "Account", icon: LayoutDashboard, perm: "sales" as const }]
      : NAV.filter((item) => (role ? item.perm === "account" || can(role, item.perm as Permission) : false));

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 p-3">
      {items.map((item) => {
        const active = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-foreground"
                : "text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh bg-background">
      <aside className="hidden w-60 shrink-0 flex-col bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex items-center gap-2 px-5 pt-6 pb-4">
          <span className="font-display text-2xl tracking-tight">Till</span>
        </div>
        {nav}
        <div className="border-t border-white/10 p-4 text-xs text-sidebar-muted">
          <div className="truncate text-sm text-sidebar-foreground">
            {session.data?.store.name ?? "…"}
          </div>
          <div>{role ? ROLE_LABEL[role] : "Loading"}</div>
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button type="button" className="absolute inset-0 bg-ink/40" aria-label="Close menu" onClick={() => setOpen(false)} />
          <aside className="relative z-50 flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground">
            <div className="flex items-center justify-between px-5 pt-6 pb-4">
              <span className="font-display text-2xl tracking-tight">Till</span>
              <Button variant="sidebar" size="icon-sm" onClick={() => setOpen(false)}>
                <X />
              </Button>
            </div>
            {nav}
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-3 border-b border-border px-4 md:h-16 md:px-6">
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={() => setOpen(true)}>
            <Menu />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-medium tracking-tight md:text-xl">{title}</h1>
          </div>
          {actions}
          <UserButton />
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function ShellSkeleton() {
  return (
    <div className="flex min-h-dvh bg-background">
      <div className="hidden w-60 bg-sidebar p-6 text-sidebar-foreground md:block">
        <span className="font-display text-2xl tracking-tight">Till</span>
      </div>
      <div className="flex-1 p-6">
        <div className="mb-6 font-display text-xl md:hidden">Till</div>
        <Skeleton className="mb-6 h-8 w-40" />
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      </div>
    </div>
  );
}

export function Forbidden() {
  return (
    <AppShell title="No access">
      <div className="mx-auto max-w-md rounded-xl border border-border bg-card p-8 text-center">
        <h2 className="font-display text-2xl">This desk isn’t yours</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your role doesn’t include this screen. Ask an admin if you need it.
        </p>
      </div>
    </AppShell>
  );
}

export function usePosSession() {
  const { user } = useCurrentUserState();
  return useQuery({
    queryKey: ["pos-session"],
    queryFn: () => getSessionContext(),
    enabled: Boolean(user),
  });
}
