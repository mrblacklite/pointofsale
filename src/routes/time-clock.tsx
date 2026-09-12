import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { clockIn, clockOut, listTimeClock, myClockStatus } from "@/lib/pos/time-clock";
import { can } from "@/lib/pos/roles";

export const Route = createFileRoute("/time-clock")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "sales")) return <Forbidden />;
  return <TimeClock />;
}

function TimeClock() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["clock-status"], queryFn: () => myClockStatus() });
  const punches = useQuery({ queryKey: ["clock-log"], queryFn: () => listTimeClock({ data: { days: 14 } }) });

  const inn = useMutation({
    mutationFn: () => clockIn(),
    onSuccess: () => {
      toast.success("Clocked in");
      void qc.invalidateQueries({ queryKey: ["clock-status"] });
      void qc.invalidateQueries({ queryKey: ["clock-log"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const out = useMutation({
    mutationFn: () => clockOut(),
    onSuccess: (res) => {
      toast.success(`Clocked out · ${res.hours.toFixed(2)} hrs`);
      void qc.invalidateQueries({ queryKey: ["clock-status"] });
      void qc.invalidateQueries({ queryKey: ["clock-log"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const byName = new Map<string, number>();
  for (const p of punches.data ?? []) {
    byName.set(p.name, (byName.get(p.name) ?? 0) + p.hours);
  }

  return (
    <AppShell title="Time clock">
      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Your punch</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {status.data?.clockedIn ? (
              <>
                <Badge>Clocked in</Badge>
                <p className="text-sm text-muted-foreground">
                  Since {status.data.clockedInAt?.replace("T", " ").slice(0, 16)}
                </p>
                <Button disabled={out.isPending} onClick={() => out.mutate()}>
                  Clock out
                </Button>
              </>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Not on the clock.</p>
                <Button disabled={inn.isPending} onClick={() => inn.mutate()}>
                  Clock in
                </Button>
              </>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Hours (14 days)</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {[...byName.entries()].map(([name, hours]) => (
                  <li key={name} className="flex justify-between">
                    <span>{name}</span>
                    <span className="font-mono tabular-nums">{hours.toFixed(2)} h</span>
                  </li>
                ))}
                {!byName.size ? <li className="text-muted-foreground">No punches yet.</li> : null}
              </ul>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Punches</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border text-sm">
                {punches.data?.map((p) => (
                  <li key={p.id} className="flex justify-between gap-3 py-2">
                    <div>
                      <div className="font-medium">
                        {p.name} {p.open ? <Badge variant="warn">Open</Badge> : null}
                      </div>
                      <div className="text-muted-foreground">
                        {p.clockedInAt.replace("T", " ").slice(0, 16)}
                        {p.clockedOutAt ? ` → ${p.clockedOutAt.replace("T", " ").slice(0, 16)}` : ""}
                      </div>
                    </div>
                    <div className="font-mono text-xs tabular-nums">{p.hours.toFixed(2)} h</div>
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
