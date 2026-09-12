import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { n, requirePos } from "./context";
import type { Product } from "./types";

export const listProductOptions = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ productId: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId);
    const rows = await sql<{ id: string; kind: "variant" | "modifier"; name: string; price_delta_cents: number }>`
      select id, kind, name, price_delta_cents
      from product_options
      where store_id = ${store.id} and product_id = ${data.productId}
      order by kind, name
    `;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      name: r.name,
      priceDeltaCents: n(r.price_delta_cents),
    }));
  });

export const saveProductOption = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      productId: z.string(),
      kind: z.enum(["variant", "modifier"]),
      name: z.string().trim().min(1).max(80),
      priceDeltaCents: z.number().int(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "catalog_write");
    const id = newId();
    await sql`
      insert into product_options (id, store_id, product_id, kind, name, price_delta_cents)
      values (${id}, ${store.id}, ${data.productId}, ${data.kind}, ${data.name}, ${data.priceDeltaCents})
    `;
    return { id };
  });

export const deleteProductOption = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "catalog_write");
    await sql`delete from product_options where id = ${data.id} and store_id = ${store.id}`;
    return { ok: true };
  });

export const saveProductMeta = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string(),
      soldBy: z.enum(["each", "weight"]),
      imageUrl: z.string().trim().max(500).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "catalog_write");
    await sql`
      update products
      set sold_by = ${data.soldBy}, image_url = ${data.imageUrl ?? null}, updated_at = now()
      where id = ${data.id} and store_id = ${store.id}
    `;
    return { id: data.id };
  });

export const listRegisterProducts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ q: z.string().optional(), categoryId: z.string().optional() }).optional())
  .handler(async ({ context, data }): Promise<Product[]> => {
    const { sql, store } = await requirePos(context.userId);
    const q = data?.q?.trim() ?? "";
    const categoryId = data?.categoryId || null;
    const rows = await sql<Record<string, unknown>>`
      select p.*, c.name as category_name
      from products p
      left join categories c on c.id = p.category_id
      where p.store_id = ${store.id}
        and p.active = true
        and (${categoryId}::text is null or p.category_id = ${categoryId})
        and (
          ${q} = ''
          or p.name ilike ${"%" + q + "%"}
          or p.sku ilike ${"%" + q + "%"}
          or coalesce(p.barcode, '') ilike ${"%" + q + "%"}
        )
      order by p.name
      limit 200
    `;
    return rows.map((row) => ({
      id: String(row.id),
      categoryId: row.category_id ? String(row.category_id) : null,
      categoryName: row.category_name ? String(row.category_name) : null,
      sku: String(row.sku),
      barcode: row.barcode ? String(row.barcode) : null,
      name: String(row.name),
      description: row.description ? String(row.description) : null,
      priceCents: n(row.price_cents),
      costCents: n(row.cost_cents),
      taxExempt: Boolean(row.tax_exempt),
      trackInventory: Boolean(row.track_inventory),
      quantity: n(row.quantity),
      reorderPoint: n(row.reorder_point),
      active: Boolean(row.active),
      soldBy: row.sold_by === "weight" ? "weight" : "each",
      imageUrl: row.image_url ? String(row.image_url) : null,
    }));
  });
