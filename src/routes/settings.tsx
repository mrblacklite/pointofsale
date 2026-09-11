import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { updateStore } from "@/lib/pos/actions";
import { can } from "@/lib/pos/roles";

export const Route = createFileRoute("/settings")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "settings")) return <Forbidden />;
  return <Settings />;
}

function Settings() {
  const session = usePosSession();
  const qc = useQueryClient();
  const store = session.data?.store;
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [tax, setTax] = useState("8.25");
  const [footer, setFooter] = useState("");

  useEffect(() => {
    if (!store) return;
    setName(store.name);
    setLegalName(store.legalName ?? "");
    setAddress(store.address ?? "");
    setPhone(store.phone ?? "");
    setTax(((store.taxRateBps ?? 0) / 100).toFixed(2));
    setFooter(store.receiptFooter ?? "");
  }, [store]);

  const save = useMutation({
    mutationFn: () =>
      updateStore({
        data: {
          name,
          legalName: legalName || null,
          address: address || null,
          phone: phone || null,
          taxRateBps: Math.round(Number.parseFloat(tax || "0") * 100),
          receiptFooter: footer || null,
        },
      }),
    onSuccess: () => {
      toast.success("Store updated");
      void qc.invalidateQueries({ queryKey: ["pos-session"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Store">
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Store profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Legal name</Label>
            <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Address</Label>
            <Textarea value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Sales tax %</Label>
              <Input value={tax} onChange={(e) => setTax(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label>Receipt footer</Label>
            <Textarea value={footer} onChange={(e) => setFooter(e.target.value)} />
          </div>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </CardContent>
      </Card>
    </AppShell>
  );
}
