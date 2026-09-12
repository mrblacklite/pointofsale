import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GROK_PROVIDERS, authClient, authEnabled, signIn } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  const { user, isPending } = useCurrentUserState();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!isPending && user) {
    void navigate({ to: "/" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "up") {
        const { data, error: err } = await authClient.signUp.email({
          email,
          password,
          name: name.trim() || email.split("@")[0],
        });
        if (err) throw new Error(err.message ?? "Could not create account");
        captureToken(data);
      } else {
        const { data, error: err } = await authClient.signIn.email({ email, password });
        if (err) throw new Error(err.message ?? "Could not sign in");
        captureToken(data);
      }
      try {
        await authClient.getSession();
      } catch {
        /* session store recovers */
      }
      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-dvh lg:grid-cols-[1.1fr_0.9fr]">
      <section className="hidden flex-col justify-between bg-sidebar px-12 py-12 text-sidebar-foreground lg:flex">
        <span className="font-display text-3xl tracking-tight">Till</span>
        <div className="max-w-md">
          <h1 className="font-display text-5xl leading-[1.05] tracking-tight">
            Your receipts. Your credit.
          </h1>
          <p className="mt-5 text-base text-sidebar-muted">
            Create a customer account to see purchases assigned to you and any store credit the
            shop adds. Staff are invited by an admin.
          </p>
        </div>
        <p className="text-sm text-sidebar-muted">One shop. Customer accounts by default.</p>
      </section>

      <section className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="font-display text-3xl tracking-tight lg:hidden">
            Till
          </Link>
          <h2 className="mt-6 font-display text-3xl tracking-tight">
            {mode === "in" ? "Sign in" : "Create a customer account"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "in"
              ? "Customers and staff use the email on their account. Google and X work too."
              : "This creates a customer account for this shop. An admin can promote you to cashier later."}
          </p>

          {authEnabled ? (
            <div className="mt-6 grid gap-2">
              {GROK_PROVIDERS.map((p) => (
                <Button
                  key={p.providerId}
                  type="button"
                  variant="outline"
                  onClick={() => signIn(p.providerId, { callbackURL: "/" })}
                >
                  Continue with {p.label}
                </Button>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">Sign-in is disabled.</p>
          )}

          <div className="my-6 flex items-center gap-3 text-xs tracking-wide text-muted-foreground uppercase">
            <span className="h-px flex-1 bg-border" />
            or email
            <span className="h-px flex-1 bg-border" />
          </div>

          <form className="grid gap-3" onSubmit={onSubmit}>
            {mode === "up" ? (
              <div className="grid gap-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
            ) : null}
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "up" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={busy || !authEnabled}>
              {busy ? "Working…" : mode === "in" ? "Sign in" : "Create customer account"}
            </Button>
          </form>

          <button
            type="button"
            className="mt-4 text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setError(null);
            }}
          >
            {mode === "in" ? "New here? Create a customer account" : "Already have an account? Sign in"}
          </button>
        </div>
      </section>
    </main>
  );
}

function captureToken(data: unknown) {
  if (!data || typeof data !== "object") return;
  const token = "token" in data ? (data as { token?: unknown }).token : null;
  if (typeof token === "string" && token) {
    try {
      sessionStorage.setItem("grok-auth.bearer-token", token);
    } catch {
      /* ignore */
    }
  }
}
