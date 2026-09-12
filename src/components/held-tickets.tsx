import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { holdTicket, listHeldTickets, releaseHeldTicket } from "@/lib/pos/ops";
import type { Product } from "@/lib/pos/types";

type Line = { product: Product; quantity: number };
type HeldPayload = { cart: Line[]; discountCode: string };

export function HeldTickets({
  cart,
  discountCode,
  onParked,
  onResume,
}: {
  cart: Line[];
  discountCode: string;
  onParked: () => void;
  onResume: (payload: HeldPayload) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const held = useQuery({ queryKey: ["held-tickets"], queryFn: () => listHeldTickets() });

  const park = useMutation({
    mutationFn: () => {
      if (!cart.length) throw new Error("Nothing to hold");
      const label = name.trim() || `Hold ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
      return holdTicket({
        data: {
          name: label.slice(0, 40),
          payload: { cart, discountCode } satisfies HeldPayload,
        },
      });
    },
    onSuccess: () => {
      toast.success("Ticket held");
      setName("");
      onParked();
      void qc.invalidateQueries({ queryKey: ["held-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const recall = useMutation({
    mutationFn: (id: string) => releaseHeldTicket({ data: { id } }),
    onSuccess: (res) => {
      const payload = res.payload as HeldPayload;
      if (!payload?.cart?.length) {
        toast.error("Held ticket was empty");
        return;
      }
      onResume({ cart: payload.cart, discountCode: payload.discountCode ?? "" });
      toast.success("Ticket recalled");
      void qc.invalidateQueries({ queryKey: ["held-tickets"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input
          className="h-9 max-w-48"
          placeholder="Hold name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button size="sm" variant="outline" disabled={park.isPending || !cart.length} onClick={() => park.mutate()}>
          Hold ticket
        </Button>
      </div>
      {(held.data ?? []).length ? (
        <ul className="mt-3 space-y-1 text-sm">
          {held.data!.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-2 rounded-md bg-secondary/60 px-2 py-1.5">
              <span className="truncate">{t.name}</span>
              <span className="flex gap-1">
                <Button size="sm" variant="outline" className="h-7" onClick={() => recall.mutate(t.id)}>
                  Recall
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive"
                  onClick={() =>
                    releaseHeldTicket({ data: { id: t.id } })
                      .then(() => {
                        toast.success("Discarded");
                        void qc.invalidateQueries({ queryKey: ["held-tickets"] });
                      })
                      .catch((e: Error) => toast.error(e.message))
                  }
                >
                  Discard
                </Button>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">No parked tickets.</p>
      )}
    </div>
  );
}
