import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell, Forbidden, usePosSession } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createCategory, listCategories, listProducts, saveProduct } from "@/lib/pos/actions";
import { deleteProductOption, listProductOptions, saveProductOption } from "@/lib/pos/catalog-options";
import { can } from "@/lib/pos/roles";
import type { Product } from "@/lib/pos/types";
import { formatMoney, parseMoneyToCents } from "@/lib/utils";

export const Route = createFileRoute("/products")({ component: Page });

function Page() {
  const session = usePosSession();
  const role = session.data?.member.role;
  if (session.data && role && !can(role, "catalog")) return <Forbidden />;
  return <Catalog />;
}

function Catalog() {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [newCat, setNewCat] = useState("");
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => listCategories() });
  const products = useQuery({
    queryKey: ["products-all", q],
    queryFn: () => listProducts({ data: { q, includeInactive: true } }),
  });

  const save = useMutation({
    mutationFn: (data: Parameters<typeof saveProduct>[0]["data"]) => saveProduct({ data }),
    onSuccess: () => {
      toast.success("Product saved");
      setEditing(null);
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["products-all"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addCat = useMutation({
    mutationFn: () => createCategory({ data: { name: newCat } }),
    onSuccess: () => {
      setNewCat("");
      void qc.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell
      title="Catalog"
      actions={
        <Button onClick={() => setEditing({ priceCents: 0, costCents: 0, quantity: 0, reorderPoint: 5, taxExempt: false, trackInventory: true, active: true })}>
          New product
        </Button>
      }
    >
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Search catalog" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2">
          <Input placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
          <Button variant="outline" disabled={!newCat.trim() || addCat.isPending} onClick={() => addCat.mutate()}>
            Add
          </Button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border text-xs tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">Product</th>
              <th className="px-4 py-3 font-medium">SKU</th>
              <th className="px-4 py-3 font-medium">Category</th>
              <th className="px-4 py-3 font-medium text-right">Price</th>
              <th className="px-4 py-3 font-medium text-right">On hand</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.data?.map((p) => (
              <tr key={p.id} className="cursor-pointer border-b border-border last:border-0 hover:bg-secondary/60" onClick={() => setEditing(p)}>
                <td className="px-4 py-3">
                  <div className="font-medium">{p.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{p.barcode}</div>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-3 text-muted-foreground">{p.categoryName ?? "—"}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{formatMoney(p.priceCents)}{p.soldBy === "weight" ? "/lb" : ""}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums">{p.trackInventory ? p.quantity : "—"}</td>
                <td className="px-4 py-3">{p.active ? <Badge>Active</Badge> : <Badge variant="muted">Hidden</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog open={Boolean(editing)} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit product" : "New product"}</DialogTitle>
          </DialogHeader>
          {editing ? (
            <ProductForm product={editing} categories={cats.data ?? []} busy={save.isPending} onSubmit={(data) => save.mutate(data)} />
          ) : null}
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function ProductForm({
  product,
  categories,
  busy,
  onSubmit,
}: {
  product: Partial<Product>;
  categories: Array<{ id: string; name: string }>;
  busy: boolean;
  onSubmit: (data: Parameters<typeof saveProduct>[0]["data"]) => void;
}) {
  const [name, setName] = useState(product.name ?? "");
  const [sku, setSku] = useState(product.sku ?? "");
  const [barcode, setBarcode] = useState(product.barcode ?? "");
  const [categoryId, setCategoryId] = useState(product.categoryId ?? "");
  const [description, setDescription] = useState(product.description ?? "");
  const [price, setPrice] = useState(((product.priceCents ?? 0) / 100).toFixed(2));
  const [cost, setCost] = useState(((product.costCents ?? 0) / 100).toFixed(2));
  const [quantity, setQuantity] = useState(String(product.quantity ?? 0));
  const [reorder, setReorder] = useState(String(product.reorderPoint ?? 5));
  const [taxExempt, setTaxExempt] = useState(Boolean(product.taxExempt));
  const [track, setTrack] = useState(product.trackInventory !== false);
  const [active, setActive] = useState(product.active !== false);
  const [soldBy, setSoldBy] = useState<"each" | "weight">(product.soldBy === "weight" ? "weight" : "each");
  const [imageUrl, setImageUrl] = useState(product.imageUrl ?? "");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          id: product.id,
          name,
          sku,
          barcode: barcode || null,
          categoryId: categoryId || null,
          description: description || null,
          priceCents: parseMoneyToCents(price),
          costCents: parseMoneyToCents(cost),
          quantity: Number.parseInt(quantity, 10) || 0,
          reorderPoint: Number.parseInt(reorder, 10) || 0,
          taxExempt,
          trackInventory: track,
          active,
          soldBy,
          imageUrl: imageUrl || null,
        });
      }}
    >
      <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="SKU"><Input className="font-mono" value={sku} onChange={(e) => setSku(e.target.value)} required /></Field>
        <Field label="Barcode"><Input className="font-mono" value={barcode} onChange={(e) => setBarcode(e.target.value)} /></Field>
      </div>
      <Field label="Category">
        <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          <option value="">Uncategorized</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Description"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Price"><Input value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label="Cost"><Input value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="On hand"><Input value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Field>
        <Field label="Reorder at"><Input value={reorder} onChange={(e) => setReorder(e.target.value)} /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={track} onChange={(e) => setTrack(e.target.checked)} />Track inventory</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={taxExempt} onChange={(e) => setTaxExempt(e.target.checked)} />Tax exempt</label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Active on the register</label>
      <Field label="Sold by">
        <Select value={soldBy} onChange={(e) => setSoldBy(e.target.value as "each" | "weight")}>
          <option value="each">Each</option>
          <option value="weight">By the pound</option>
        </Select>
      </Field>
      <Field label="Image URL"><Input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://" /></Field>
      {product.id ? <OptionEditor productId={product.id} /> : null}
      <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save product"}</Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function OptionEditor({ productId }: { productId: string }) {
  const qc = useQueryClient();
  const opts = useQuery({
    queryKey: ["product-options", productId],
    queryFn: () => listProductOptions({ data: { productId } }),
  });
  const [kind, setKind] = useState<"variant" | "modifier">("variant");
  const [name, setName] = useState("");
  const [delta, setDelta] = useState("0");
  const add = useMutation({
    mutationFn: () =>
      saveProductOption({
        data: { productId, kind, name, priceDeltaCents: Math.round(Number.parseFloat(delta || "0") * 100) },
      }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["product-options", productId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: (id: string) => deleteProductOption({ data: { id } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["product-options", productId] }),
  });
  return (
    <div className="grid gap-2 rounded-lg border border-border p-3">
      <div className="text-sm font-medium">Variants & modifiers</div>
      <ul className="space-y-1 text-sm">
        {opts.data?.map((o) => (
          <li key={o.id} className="flex justify-between gap-2">
            <span>
              {o.kind}: {o.name} ({o.priceDeltaCents >= 0 ? "+" : ""}
              {(o.priceDeltaCents / 100).toFixed(2)})
            </span>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => del.mutate(o.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-3 gap-2">
        <Select value={kind} onChange={(e) => setKind(e.target.value as "variant" | "modifier")}>
          <option value="variant">Variant</option>
          <option value="modifier">Modifier</option>
        </Select>
        <Input placeholder="Large / Extra shot" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="+$" value={delta} onChange={(e) => setDelta(e.target.value)} />
      </div>
      <Button type="button" variant="outline" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>
        Add option
      </Button>
    </div>
  );
}
