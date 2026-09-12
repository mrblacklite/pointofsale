import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { n, requirePos } from "./context";
import { poOpenQty } from "./ops-math";

export const listSuppliers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store } = await requirePos(context.userId, "inventory");
    const rows = await sql<{ id: string; name: string; email: string | null; phone: string | null; note: string | null }>`
      select id, name, email, phone, note from suppliers where store_id = ${store.id} order by name
    `;
    return rows;
  });

export const saveSupplier = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().nullable().optional(),
      phone: z.string().trim().max(32).nullable().optional(),
      note: z.string().trim().max(240).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "inventory");
    if (data.id) {
      await sql`
        update suppliers set name = ${data.name}, email = ${data.email ?? null}, phone = ${data.phone ?? null}, note = ${data.note ?? null}
        where id = ${data.id} and store_id = ${store.id}
      `;
      return { id: data.id };
    }
    const id = newId();
    await sql`
      insert into suppliers (id, store_id, name, email, phone, note)
      values (${id}, ${store.id}, ${data.name}, ${data.email ?? null}, ${data.phone ?? null}, ${data.note ?? null})
    `;
    return { id };
  });

export const listPurchaseOrders = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store } = await requirePos(context.userId, "inventory");
    const rows = await sql<{
      id: string;
      status: string;
      note: string | null;
      created_at: unknown;
      supplier_name: string;
      lines: number;
    }>`
      select po.id, po.status, po.note, po.created_at, s.name as supplier_name,
        (select count(*)::int from purchase_order_lines l where l.po_id = po.id) as lines
      from purchase_orders po
      join suppliers s on s.id = po.supplier_id
      where po.store_id = ${store.id}
      order by po.created_at desc
      limit 80
    `;
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      note: r.note,
      createdAt: String(r.created_at),
      supplierName: r.supplier_name,
      lineCount: n(r.lines),
    }));
  });

export const getPurchaseOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "inventory");
    const po = await sql<{
      id: string;
      status: string;
      note: string | null;
      supplier_id: string;
      supplier_name: string;
      created_at: unknown;
    }>`
      select po.id, po.status, po.note, po.supplier_id, s.name as supplier_name, po.created_at
      from purchase_orders po
      join suppliers s on s.id = po.supplier_id
      where po.id = ${data.id} and po.store_id = ${store.id}
    `;
    if (!po[0]) throw new Error("PO not found.");
    const lines = await sql<{
      id: string;
      product_id: string;
      name: string;
      sku: string;
      quantity: number;
      received_qty: number;
      cost_cents: number;
    }>`
      select l.id, l.product_id, p.name, p.sku, l.quantity, l.received_qty, l.cost_cents
      from purchase_order_lines l
      join products p on p.id = l.product_id
      where l.po_id = ${po[0].id}
    `;
    return {
      id: po[0].id,
      status: po[0].status,
      note: po[0].note,
      supplierId: po[0].supplier_id,
      supplierName: po[0].supplier_name,
      createdAt: String(po[0].created_at),
      lines: lines.map((l) => ({
        id: l.id,
        productId: l.product_id,
        name: l.name,
        sku: l.sku,
        quantity: n(l.quantity),
        receivedQty: n(l.received_qty),
        openQty: poOpenQty(n(l.quantity), n(l.received_qty)),
        costCents: n(l.cost_cents),
      })),
    };
  });

export const createPurchaseOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      supplierId: z.string(),
      note: z.string().trim().max(240).optional(),
      lines: z
        .array(
          z.object({
            productId: z.string(),
            quantity: z.number().int().min(1),
            costCents: z.number().int().min(0),
          }),
        )
        .min(1),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "inventory");
    const supplier = await sql<{ id: string }>`
      select id from suppliers where id = ${data.supplierId} and store_id = ${store.id}
    `;
    if (!supplier[0]) throw new Error("Supplier not found.");
    const id = newId();
    await sql`
      insert into purchase_orders (id, store_id, supplier_id, status, note, created_by)
      values (${id}, ${store.id}, ${data.supplierId}, ${"open"}, ${data.note ?? null}, ${member.userId})
    `;
    for (const line of data.lines) {
      const product = await sql<{ id: string }>`
        select id from products where id = ${line.productId} and store_id = ${store.id}
      `;
      if (!product[0]) throw new Error("Product not found.");
      await sql`
        insert into purchase_order_lines (id, po_id, store_id, product_id, quantity, cost_cents)
        values (${newId()}, ${id}, ${store.id}, ${line.productId}, ${line.quantity}, ${line.costCents})
      `;
    }
    return { id };
  });

export const receivePurchaseOrder = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "inventory");
    const po = await sql<{ id: string; status: string }>`
      select id, status from purchase_orders where id = ${data.id} and store_id = ${store.id}
    `;
    if (!po[0]) throw new Error("PO not found.");
    if (po[0].status !== "open") throw new Error("PO is not open.");
    const lines = await sql<{ id: string; product_id: string; quantity: number; received_qty: number }>`
      select id, product_id, quantity, received_qty from purchase_order_lines where po_id = ${po[0].id}
    `;
    for (const line of lines) {
      const open = poOpenQty(n(line.quantity), n(line.received_qty));
      if (open <= 0) continue;
      await sql`
        update products set quantity = quantity + ${open}, updated_at = now()
        where id = ${line.product_id} and store_id = ${store.id}
      `;
      await sql`
        insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
        values (${newId()}, ${store.id}, ${line.product_id}, ${open}, ${"receive"}, ${"PO receive"}, ${member.userId})
      `;
      await sql`update purchase_order_lines set received_qty = quantity where id = ${line.id}`;
    }
    await sql`update purchase_orders set status = ${"received"}, received_at = now() where id = ${po[0].id}`;
    return { id: po[0].id };
  });
