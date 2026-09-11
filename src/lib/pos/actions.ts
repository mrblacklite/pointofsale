import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { asText, n, requirePos } from "./context";
import { ROLES, type Role } from "./roles";
import type {
  ApiKeyRow,
  Category,
  CompleteSaleInput,
  DashboardData,
  Discount,
  GiftCard,
  Member,
  Movement,
  Product,
  SaleDetail,
  SaleListItem,
  SaleResult,
  SessionContext,
  StaffRow,
  Store,
} from "./types";

const roleSchema = z.enum(ROLES);

function mapProduct(row: Record<string, unknown>): Product {
  return {
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
  };
}

export const getSessionContext = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SessionContext> => {
    const { store, member, seeded } = await requirePos(context.userId);
    return { store, member, seeded };
  });

export const getDashboard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DashboardData> => {
    const { sql, store } = await requirePos(context.userId);
    const today = await sql<{ cents: number; count: number }>`
      select coalesce(sum(total_cents), 0)::int as cents, count(*)::int as count
      from sales
      where store_id = ${store.id}
        and status = 'completed'
        and created_at >= date_trunc('day', now())
    `;
    const week = await sql<{ cents: number }>`
      select coalesce(sum(total_cents), 0)::int as cents
      from sales
      where store_id = ${store.id}
        and status = 'completed'
        and created_at >= now() - interval '7 days'
    `;
    const avg = await sql<{ cents: number }>`
      select coalesce(avg(total_cents), 0)::int as cents
      from sales
      where store_id = ${store.id}
        and status = 'completed'
        and created_at >= date_trunc('day', now())
    `;
    const lowStock = await sql<{
      id: string;
      name: string;
      sku: string;
      quantity: number;
      reorder_point: number;
    }>`
      select id, name, sku, quantity, reorder_point
      from products
      where store_id = ${store.id}
        and active = true
        and track_inventory = true
        and quantity <= reorder_point
      order by quantity asc, name
      limit 8
    `;
    const value = await sql<{ cents: number }>`
      select coalesce(sum(cost_cents * quantity), 0)::int as cents
      from products
      where store_id = ${store.id} and track_inventory = true
    `;
    const series = await sql<{ day: string; cents: number; count: number }>`
      select created_at::date::text as day,
        coalesce(sum(total_cents), 0)::int as cents,
        count(*)::int as count
      from sales
      where store_id = ${store.id}
        and status = 'completed'
        and created_at >= date_trunc('day', now()) - interval '6 days'
      group by 1
      order by 1
    `;
    const weekSeries = fillWeek(series.map((r) => ({ day: r.day, cents: n(r.cents), count: n(r.count) })));
    const recent = await sql<{
      id: string;
      receipt_number: number;
      cashier_name: string;
      status: "completed" | "voided";
      subtotal_cents: number;
      tax_cents: number;
      discount_cents: number;
      total_cents: number;
      created_at: unknown;
      item_count: number;
    }>`
      select s.id, s.receipt_number, s.cashier_name, s.status,
        s.subtotal_cents, s.tax_cents, s.discount_cents, s.total_cents,
        s.created_at, (select count(*)::int from sale_items i where i.sale_id = s.id) as item_count
      from sales s
      where s.store_id = ${store.id}
      order by s.created_at desc
      limit 6
    `;
    return {
      todayCents: n(today[0]?.cents),
      todayCount: n(today[0]?.count),
      weekCents: n(week[0]?.cents),
      avgTicketCents: n(avg[0]?.cents),
      lowStock: lowStock.map((r) => ({
        id: r.id,
        name: r.name,
        sku: r.sku,
        quantity: n(r.quantity),
        reorderPoint: n(r.reorder_point),
      })),
      recentSales: recent.map(mapSaleList),
      inventoryValueCents: n(value[0]?.cents),
      weekSeries,
    };
  });

function mapSaleList(row: {
  id: string;
  receipt_number: number;
  cashier_name: string;
  status: "completed" | "voided";
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  created_at: unknown;
  item_count: number;
}): SaleListItem {
  return {
    id: row.id,
    receiptNumber: n(row.receipt_number),
    cashierName: row.cashier_name,
    status: row.status,
    subtotalCents: n(row.subtotal_cents),
    taxCents: n(row.tax_cents),
    discountCents: n(row.discount_cents),
    totalCents: n(row.total_cents),
    createdAt: asText(row.created_at),
    itemCount: n(row.item_count),
  };
}

function fillWeek(rows: Array<{ day: string; cents: number; count: number }>) {
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const out: Array<{ day: string; cents: number; count: number }> = [];
  const now = new Date();
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date(now);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? { day: key, cents: 0, count: 0 });
  }
  return out;
}

export const listCategories = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Category[]> => {
    const { sql, store } = await requirePos(context.userId);
    const rows = await sql<{ id: string; name: string; sort_order: number }>`
      select id, name, sort_order from categories
      where store_id = ${store.id}
      order by sort_order, name
    `;
    return rows.map((r) => ({ id: r.id, name: r.name, sortOrder: n(r.sort_order) }));
  });

export const createCategory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(1).max(80) }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "catalog_write");
    const id = newId();
    const max = await sql<{ m: number }>`
      select coalesce(max(sort_order), 0)::int as m from categories where store_id = ${store.id}
    `;
    await sql`
      insert into categories (id, store_id, name, sort_order)
      values (${id}, ${store.id}, ${data.name}, ${n(max[0]?.m) + 1})
    `;
    return { id };
  });

export const listProducts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ q: z.string().optional(), categoryId: z.string().optional(), includeInactive: z.boolean().optional() }).optional())
  .handler(async ({ context, data }): Promise<Product[]> => {
    const { sql, store } = await requirePos(context.userId);
    const q = data?.q?.trim() ?? "";
    const categoryId = data?.categoryId || null;
    const includeInactive = Boolean(data?.includeInactive);
    const rows = await sql<Record<string, unknown>>`
      select p.*, c.name as category_name
      from products p
      left join categories c on c.id = p.category_id
      where p.store_id = ${store.id}
        and (${includeInactive} or p.active = true)
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
    return rows.map(mapProduct);
  });

const productInput = z.object({
  id: z.string().optional(),
  categoryId: z.string().nullable().optional(),
  sku: z.string().trim().min(1).max(40),
  barcode: z.string().trim().max(64).nullable().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  priceCents: z.number().int().min(0),
  costCents: z.number().int().min(0),
  taxExempt: z.boolean(),
  trackInventory: z.boolean(),
  quantity: z.number().int(),
  reorderPoint: z.number().int().min(0),
  active: z.boolean(),
});

export const saveProduct = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(productInput)
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "catalog_write");
    const barcode = data.barcode?.trim() ? data.barcode.trim() : null;
    const description = data.description?.trim() ? data.description.trim() : null;
    const categoryId = data.categoryId || null;
    if (data.id) {
      const before = await sql<{ quantity: number; track_inventory: boolean }>`
        select quantity, track_inventory from products
        where id = ${data.id} and store_id = ${store.id}
      `;
      if (!before[0]) throw new Error("Product not found.");
      await sql`
        update products set
          category_id = ${categoryId},
          sku = ${data.sku},
          barcode = ${barcode},
          name = ${data.name},
          description = ${description},
          price_cents = ${data.priceCents},
          cost_cents = ${data.costCents},
          tax_exempt = ${data.taxExempt},
          track_inventory = ${data.trackInventory},
          quantity = ${data.quantity},
          reorder_point = ${data.reorderPoint},
          active = ${data.active},
          updated_at = now()
        where id = ${data.id} and store_id = ${store.id}
      `;
      const delta = data.quantity - n(before[0].quantity);
      if (delta !== 0) {
        await sql`
          insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
          values (${newId()}, ${store.id}, ${data.id}, ${delta}, 'adjust', 'Catalog edit', ${member.userId})
        `;
      }
      return { id: data.id };
    }
    const id = newId();
    await sql`
      insert into products (
        id, store_id, category_id, sku, barcode, name, description,
        price_cents, cost_cents, tax_exempt, track_inventory, quantity, reorder_point, active
      ) values (
        ${id}, ${store.id}, ${categoryId}, ${data.sku}, ${barcode}, ${data.name}, ${description},
        ${data.priceCents}, ${data.costCents}, ${data.taxExempt}, ${data.trackInventory},
        ${data.quantity}, ${data.reorderPoint}, ${data.active}
      )
    `;
    if (data.quantity !== 0) {
      await sql`
        insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
        values (${newId()}, ${store.id}, ${id}, ${data.quantity}, 'receive', 'Opening quantity', ${member.userId})
      `;
    }
    return { id };
  });

export const adjustInventory = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      productId: z.string(),
      delta: z.number().int(),
      reason: z.enum(["receive", "adjust", "waste", "count"]),
      note: z.string().trim().max(240).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "inventory");
    if (data.delta === 0) throw new Error("Quantity change cannot be zero.");
    const updated = await sql<{ id: string; quantity: number }>`
      update products
      set quantity = quantity + ${data.delta}, updated_at = now()
      where id = ${data.productId} and store_id = ${store.id}
        and (quantity + ${data.delta}) >= 0
      returning id, quantity
    `;
    if (!updated[0]) throw new Error("Not enough on hand, or product missing.");
    await sql`
      insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
      values (${newId()}, ${store.id}, ${data.productId}, ${data.delta}, ${data.reason}, ${data.note ?? null}, ${member.userId})
    `;
    return { quantity: n(updated[0].quantity) };
  });

export const listMovements = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Movement[]> => {
    const { sql, store } = await requirePos(context.userId, "inventory");
    const rows = await sql<{
      id: string;
      product_name: string;
      sku: string;
      delta: number;
      reason: string;
      note: string | null;
      created_at: unknown;
      display_name: string | null;
    }>`
      select m.id, p.name as product_name, p.sku, m.delta, m.reason, m.note, m.created_at,
        sm.display_name
      from inventory_movements m
      join products p on p.id = m.product_id
      left join store_members sm on sm.user_id = m.user_id and sm.store_id = m.store_id
      where m.store_id = ${store.id}
      order by m.created_at desc
      limit 80
    `;
    return rows.map((r) => ({
      id: r.id,
      productName: r.product_name,
      sku: r.sku,
      delta: n(r.delta),
      reason: r.reason,
      note: r.note,
      createdAt: asText(r.created_at),
      userName: r.display_name || "Staff",
    }));
  });

export const listDiscounts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Discount[]> => {
    const { sql, store } = await requirePos(context.userId);
    const rows = await sql<{
      id: string;
      code: string;
      name: string;
      type: "percent" | "fixed";
      value: number;
      min_subtotal_cents: number;
      active: boolean;
    }>`
      select id, code, name, type, value, min_subtotal_cents, active
      from discounts where store_id = ${store.id}
      order by code
    `;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      type: r.type,
      value: n(r.value),
      minSubtotalCents: n(r.min_subtotal_cents),
      active: Boolean(r.active),
    }));
  });

export const saveDiscount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string().optional(),
      code: z.string().trim().min(1).max(24),
      name: z.string().trim().min(1).max(80),
      type: z.enum(["percent", "fixed"]),
      value: z.number().int().min(1),
      minSubtotalCents: z.number().int().min(0),
      active: z.boolean(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "discounts");
    const code = data.code.trim().toUpperCase();
    if (data.type === "percent" && data.value > 100) throw new Error("Percent cannot exceed 100.");
    if (data.id) {
      await sql`
        update discounts set
          code = ${code}, name = ${data.name}, type = ${data.type},
          value = ${data.value}, min_subtotal_cents = ${data.minSubtotalCents}, active = ${data.active}
        where id = ${data.id} and store_id = ${store.id}
      `;
      return { id: data.id };
    }
    const id = newId();
    await sql`
      insert into discounts (id, store_id, code, name, type, value, min_subtotal_cents, active)
      values (${id}, ${store.id}, ${code}, ${data.name}, ${data.type}, ${data.value}, ${data.minSubtotalCents}, ${data.active})
    `;
    return { id };
  });

export const listGiftCards = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<GiftCard[]> => {
    const { sql, store } = await requirePos(context.userId, "gift_cards");
    const rows = await sql<{
      id: string;
      code: string;
      initial_cents: number;
      balance_cents: number;
      status: "active" | "disabled";
      created_at: unknown;
    }>`
      select id, code, initial_cents, balance_cents, status, created_at
      from gift_cards where store_id = ${store.id}
      order by created_at desc
    `;
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      initialCents: n(r.initial_cents),
      balanceCents: n(r.balance_cents),
      status: r.status,
      createdAt: asText(r.created_at),
    }));
  });

export const issueGiftCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      code: z.string().trim().min(4).max(32).optional(),
      amountCents: z.number().int().min(100).max(500000),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "gift_cards_issue");
    const { randomBytes } = await import("node:crypto");
    const code = (data.code?.trim() || `TILL-${randomBytes(3).toString("hex").toUpperCase()}`).toUpperCase();
    const id = newId();
    await sql`
      insert into gift_cards (id, store_id, code, initial_cents, balance_cents, status)
      values (${id}, ${store.id}, ${code}, ${data.amountCents}, ${data.amountCents}, 'active')
    `;
    await sql`
      insert into gift_card_ledger (id, gift_card_id, store_id, delta_cents, reason, user_id)
      values (${newId()}, ${id}, ${store.id}, ${data.amountCents}, 'issue', ${member.userId})
    `;
    return { id, code };
  });

export const lookupGiftCard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ code: z.string().trim().min(1) }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "gift_cards");
    const rows = await sql<{
      id: string;
      code: string;
      balance_cents: number;
      status: string;
    }>`
      select id, code, balance_cents, status
      from gift_cards
      where store_id = ${store.id} and lower(code) = ${data.code.trim().toLowerCase()}
    `;
    if (!rows[0]) throw new Error("Gift card not found.");
    return {
      id: rows[0].id,
      code: rows[0].code,
      balanceCents: n(rows[0].balance_cents),
      status: rows[0].status,
    };
  });

export const setGiftCardStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string(), status: z.enum(["active", "disabled"]) }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "gift_cards_issue");
    await sql`
      update gift_cards set status = ${data.status}
      where id = ${data.id} and store_id = ${store.id}
    `;
    return { ok: true };
  });

const completeSaleSchema = z.object({
  lines: z.array(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(99) })).min(1),
  discountCode: z.string().trim().nullable().optional(),
  payments: z
    .array(
      z.object({
        method: z.enum(["cash", "card", "gift_card"]),
        amountCents: z.number().int().min(1),
        giftCardCode: z.string().nullable().optional(),
      }),
    )
    .min(1),
  tenderedCents: z.number().int().min(0).optional(),
  note: z.string().trim().max(240).nullable().optional(),
});

export const completeSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(completeSaleSchema)
  .handler(async ({ context, data }) => {
    return completeSaleInternal(context.userId, data);
  });

export async function completeSaleInternal(
  userId: string,
  data: CompleteSaleInput,
  opts: { viaApi?: boolean; dryRun?: boolean } = {},
): Promise<SaleResult> {
  const viaApi = Boolean(opts.viaApi);
  const dryRun = Boolean(opts.dryRun);
  const { sql, store, member } = await requirePos(userId, "pos");
  const productIds = data.lines.map((l) => l.productId);
  const products: Record<string, unknown>[] = [];
  for (const id of productIds) {
    const rows = await sql<Record<string, unknown>>`
      select * from products
      where store_id = ${store.id} and id = ${id}
    `;
    if (rows[0]) products.push(rows[0]);
  }
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const built: Array<{
    productId: string;
    sku: string;
    name: string;
    quantity: number;
    unitPriceCents: number;
    taxCents: number;
    lineTotalCents: number;
    track: boolean;
  }> = [];

  for (const line of data.lines) {
    const p = byId.get(line.productId);
    if (!p || !p.active) throw new Error("A product in the cart is unavailable.");
    if (Boolean(p.track_inventory) && n(p.quantity) < line.quantity) {
      throw new Error(`Not enough stock for ${String(p.name)}.`);
    }
    const unit = n(p.price_cents);
    const lineTotal = unit * line.quantity;
    const tax = p.tax_exempt ? 0 : Math.round((lineTotal * store.taxRateBps) / 10000);
    built.push({
      productId: String(p.id),
      sku: String(p.sku),
      name: String(p.name),
      quantity: line.quantity,
      unitPriceCents: unit,
      taxCents: tax,
      lineTotalCents: lineTotal,
      track: Boolean(p.track_inventory),
    });
  }

  const subtotal = built.reduce((s, l) => s + l.lineTotalCents, 0);
  let discountCents = 0;
  let discountCode: string | null = null;
  if (data.discountCode?.trim()) {
    const code = data.discountCode.trim().toUpperCase();
    const d = await sql<{ type: "percent" | "fixed"; value: number; min_subtotal_cents: number; active: boolean; code: string }>`
      select type, value, min_subtotal_cents, active, code from discounts
      where store_id = ${store.id} and code = ${code}
    `;
    if (!d[0] || !d[0].active) throw new Error("Discount code is not valid.");
    if (subtotal < n(d[0].min_subtotal_cents)) throw new Error("Cart does not meet the discount minimum.");
    discountCents =
      d[0].type === "percent"
        ? Math.round((subtotal * n(d[0].value)) / 100)
        : Math.min(subtotal, n(d[0].value));
    discountCode = d[0].code;
  }

  const discountedSubtotal = Math.max(0, subtotal - discountCents);
  const taxScale = subtotal === 0 ? 0 : discountedSubtotal / subtotal;
  for (const line of built) {
    line.taxCents = Math.round(line.taxCents * taxScale);
    line.lineTotalCents = Math.round(line.lineTotalCents * taxScale);
  }
  const taxCents = built.reduce((s, l) => s + l.taxCents, 0);
  const total = discountedSubtotal + taxCents;

  const paySum = data.payments.reduce((s, p) => s + p.amountCents, 0);
  const tendered = data.tenderedCents ?? paySum;
  if (!dryRun && paySum < total) throw new Error("Payment does not cover the total.");
  const change = dryRun ? 0 : Math.max(0, tendered - total);

  for (const pmt of data.payments) {
    if (pmt.method !== "gift_card") continue;
    const code = pmt.giftCardCode?.trim();
    if (!code) throw new Error("Gift card code required.");
    const card = await sql<{ id: string; balance_cents: number; status: string }>`
      select id, balance_cents, status from gift_cards
      where store_id = ${store.id} and lower(code) = ${code.toLowerCase()}
    `;
    if (!card[0] || card[0].status !== "active") throw new Error("Gift card is not active.");
    if (n(card[0].balance_cents) < pmt.amountCents) throw new Error("Gift card balance is too low.");
  }

  if (dryRun) {
    return {
      id: "quote",
      receiptNumber: 0,
      subtotalCents: discountedSubtotal,
      discountCents,
      taxCents,
      totalCents: total,
      changeCents: change,
      items: built,
      cashierName: member.displayName,
      storeName: store.name,
      receiptFooter: store.receiptFooter,
      createdAt: new Date().toISOString(),
    };
  }

  const receiptRows = await sql<{ n: number }>`
    update store_counters
    set next_receipt = next_receipt + 1
    where store_id = ${store.id}
    returning next_receipt - 1 as n
  `;
  const receiptNumber = n(receiptRows[0]?.n) || 1001;
  const saleId = newId();

  await sql`
    insert into sales (
      id, store_id, receipt_number, cashier_user_id, cashier_name, status,
      discount_code, discount_cents, subtotal_cents, tax_cents, total_cents,
      tendered_cents, change_cents, note
    ) values (
      ${saleId}, ${store.id}, ${receiptNumber}, ${member.userId}, ${member.displayName}, ${"completed"},
      ${discountCode}, ${discountCents}, ${discountedSubtotal}, ${taxCents}, ${total},
      ${tendered}, ${change}, ${data.note ?? null}
    )
  `;

  for (const line of built) {
    await sql`
      insert into sale_items (
        id, sale_id, store_id, product_id, sku, name, quantity, unit_price_cents, tax_cents, line_total_cents
      ) values (
        ${newId()}, ${saleId}, ${store.id}, ${line.productId}, ${line.sku}, ${line.name},
        ${line.quantity}, ${line.unitPriceCents}, ${line.taxCents}, ${line.lineTotalCents}
      )
    `;
    if (line.track) {
      const moved = await sql<{ id: string }>`
        update products
        set quantity = quantity - ${line.quantity}, updated_at = now()
        where id = ${line.productId} and store_id = ${store.id} and quantity >= ${line.quantity}
        returning id
      `;
      if (!moved[0]) throw new Error(`Stock changed for ${line.name}. Retry the sale.`);
      await sql`
        insert into inventory_movements (id, store_id, product_id, delta, reason, note, sale_id, user_id)
        values (${newId()}, ${store.id}, ${line.productId}, ${-line.quantity}, 'sale', ${viaApi ? "API sale" : "Register"}, ${saleId}, ${member.userId})
      `;
    }
  }

  for (const pmt of data.payments) {
    await sql`
      insert into payments (id, sale_id, store_id, method, amount_cents, gift_card_code)
      values (${newId()}, ${saleId}, ${store.id}, ${pmt.method}, ${pmt.amountCents}, ${pmt.giftCardCode ?? null})
    `;
    if (pmt.method === "gift_card" && pmt.giftCardCode) {
      const updated = await sql<{ id: string }>`
        update gift_cards
        set balance_cents = balance_cents - ${pmt.amountCents}
        where store_id = ${store.id}
          and lower(code) = ${pmt.giftCardCode.trim().toLowerCase()}
          and balance_cents >= ${pmt.amountCents}
        returning id
      `;
      if (!updated[0]) throw new Error("Gift card could not be charged.");
      await sql`
        insert into gift_card_ledger (id, gift_card_id, store_id, delta_cents, reason, sale_id, user_id)
        values (${newId()}, ${updated[0].id}, ${store.id}, ${-pmt.amountCents}, 'redeem', ${saleId}, ${member.userId})
      `;
    }
  }

  return {
    id: saleId,
    receiptNumber,
    subtotalCents: discountedSubtotal,
    discountCents,
    taxCents,
    totalCents: total,
    changeCents: change,
    items: built,
    cashierName: member.displayName,
    storeName: store.name,
    receiptFooter: store.receiptFooter,
    createdAt: new Date().toISOString(),
  };
}

export const listSales = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<SaleListItem[]> => {
    const { sql, store } = await requirePos(context.userId, "sales");
    const rows = await sql<{
      id: string;
      receipt_number: number;
      cashier_name: string;
      status: "completed" | "voided";
      subtotal_cents: number;
      tax_cents: number;
      discount_cents: number;
      total_cents: number;
      created_at: unknown;
      item_count: number;
    }>`
      select s.id, s.receipt_number, s.cashier_name, s.status,
        s.subtotal_cents, s.tax_cents, s.discount_cents, s.total_cents,
        s.created_at, (select count(*)::int from sale_items i where i.sale_id = s.id) as item_count
      from sales s
      where s.store_id = ${store.id}
      order by s.created_at desc
      limit 100
    `;
    return rows.map(mapSaleList);
  });

export const getSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }): Promise<SaleDetail> => {
    const { sql, store } = await requirePos(context.userId, "sales");
    const rows = await sql<{
      id: string;
      receipt_number: number;
      cashier_name: string;
      cashier_user_id: string;
      status: "completed" | "voided";
      subtotal_cents: number;
      tax_cents: number;
      discount_cents: number;
      total_cents: number;
      tendered_cents: number;
      change_cents: number;
      note: string | null;
      discount_code: string | null;
      created_at: unknown;
    }>`
      select id, receipt_number, cashier_name, cashier_user_id, status,
        subtotal_cents, tax_cents, discount_cents, total_cents,
        tendered_cents, change_cents, note, discount_code, created_at
      from sales where id = ${data.id} and store_id = ${store.id}
    `;
    const s = rows[0];
    if (!s) throw new Error("Sale not found.");
    const items = await sql<{
      id: string;
      sku: string;
      name: string;
      quantity: number;
      unit_price_cents: number;
      tax_cents: number;
      line_total_cents: number;
    }>`
      select id, sku, name, quantity, unit_price_cents, tax_cents, line_total_cents
      from sale_items where sale_id = ${s.id} order by name
    `;
    const payments = await sql<{
      id: string;
      method: string;
      amount_cents: number;
      gift_card_code: string | null;
    }>`
      select id, method, amount_cents, gift_card_code from payments where sale_id = ${s.id}
    `;
    return {
      id: s.id,
      receiptNumber: n(s.receipt_number),
      cashierName: s.cashier_name,
      cashierUserId: s.cashier_user_id,
      status: s.status,
      subtotalCents: n(s.subtotal_cents),
      taxCents: n(s.tax_cents),
      discountCents: n(s.discount_cents),
      totalCents: n(s.total_cents),
      createdAt: asText(s.created_at),
      itemCount: items.length,
      note: s.note,
      discountCode: s.discount_code,
      tenderedCents: n(s.tendered_cents),
      changeCents: n(s.change_cents),
      items: items.map((i) => ({
        id: i.id,
        sku: i.sku,
        name: i.name,
        quantity: n(i.quantity),
        unitPriceCents: n(i.unit_price_cents),
        taxCents: n(i.tax_cents),
        lineTotalCents: n(i.line_total_cents),
      })),
      payments: payments.map((p) => ({
        id: p.id,
        method: p.method,
        amountCents: n(p.amount_cents),
        giftCardCode: p.gift_card_code,
      })),
    };
  });

export const voidSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    return voidSaleInternal(context.userId, data.id);
  });

export async function voidSaleInternal(userId: string, saleId: string) {
  const { sql, store, member } = await requirePos(userId, "void");
  const sale = await sql<{ id: string; status: string }>`
    select id, status from sales where id = ${saleId} and store_id = ${store.id}
  `;
  if (!sale[0]) throw new Error("Sale not found.");
  if (sale[0].status === "voided") throw new Error("Sale is already voided.");
  const items = await sql<{ product_id: string | null; quantity: number }>`
    select product_id, quantity from sale_items where sale_id = ${sale[0].id}
  `;
  for (const item of items) {
    if (!item.product_id) continue;
    await sql`
      update products set quantity = quantity + ${n(item.quantity)}, updated_at = now()
      where id = ${item.product_id} and store_id = ${store.id} and track_inventory = true
    `;
    await sql`
      insert into inventory_movements (id, store_id, product_id, delta, reason, note, sale_id, user_id)
      values (${newId()}, ${store.id}, ${item.product_id}, ${n(item.quantity)}, 'void', 'Voided sale', ${sale[0].id}, ${member.userId})
    `;
  }
  const pmts = await sql<{ gift_card_code: string | null; amount_cents: number; method: string }>`
    select gift_card_code, amount_cents, method from payments where sale_id = ${sale[0].id}
  `;
  for (const p of pmts) {
    if (p.method !== "gift_card" || !p.gift_card_code) continue;
    const card = await sql<{ id: string }>`
      update gift_cards set balance_cents = balance_cents + ${n(p.amount_cents)}
      where store_id = ${store.id} and lower(code) = ${p.gift_card_code.toLowerCase()}
      returning id
    `;
    if (card[0]) {
      await sql`
        insert into gift_card_ledger (id, gift_card_id, store_id, delta_cents, reason, sale_id, user_id)
        values (${newId()}, ${card[0].id}, ${store.id}, ${n(p.amount_cents)}, 'void', ${sale[0].id}, ${member.userId})
      `;
    }
  }
  await sql`
    update sales set status = 'voided', voided_at = now(), voided_by = ${member.userId}
    where id = ${sale[0].id} and store_id = ${store.id}
  `;
  return { ok: true, id: sale[0].id };
}

export const listStaff = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<StaffRow[]> => {
    const { sql, store } = await requirePos(context.userId, "staff");
    const members = await sql<{
      id: string;
      user_id: string;
      email: string;
      display_name: string;
      role: Role;
      active: boolean;
      created_at: unknown;
    }>`
      select id, user_id, email, display_name, role, active, created_at
      from store_members where store_id = ${store.id}
      order by display_name
    `;
    const invites = await sql<{
      id: string;
      email: string;
      display_name: string;
      role: Role;
      created_at: unknown;
    }>`
      select id, email, display_name, role, created_at
      from staff_invites where store_id = ${store.id}
      order by created_at desc
    `;
    return [
      ...members.map((m) => ({
        id: m.id,
        userId: m.user_id,
        email: m.email,
        displayName: m.display_name,
        role: m.role,
        active: Boolean(m.active),
        pending: false,
        createdAt: asText(m.created_at),
      })),
      ...invites.map((i) => ({
        id: i.id,
        userId: null,
        email: i.email,
        displayName: i.display_name,
        role: i.role,
        active: true,
        pending: true,
        createdAt: asText(i.created_at),
      })),
    ];
  });

export const createStaff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      email: z.string().trim().email(),
      displayName: z.string().trim().min(1).max(80),
      role: roleSchema,
      password: z.string().min(8).max(72).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "staff");
    const email = data.email.trim().toLowerCase();
    const existingMember = await sql<{ id: string }>`
      select id from store_members where store_id = ${store.id} and lower(email) = ${email}
    `;
    if (existingMember[0]) throw new Error("That email is already on staff.");
    const existingUser = await sql<{ id: string }>`
      select id from "user" where lower(email) = ${email} limit 1
    `;

    if (data.password) {
      let userId = existingUser[0]?.id;
      if (!userId) {
        const { hashPassword } = await import("better-auth/crypto");
        userId = newId();
        const password = await hashPassword(data.password);
        await sql`
          insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
          values (${userId}, ${data.displayName}, ${email}, true, now(), now())
        `;
        await sql`
          insert into "account" (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
          values (${newId()}, ${userId}, ${"credential"}, ${userId}, ${password}, now(), now())
        `;
      }
      const taken = await sql<{ id: string }>`select id from store_members where user_id = ${userId}`;
      if (taken[0]) throw new Error("That account already belongs to a store.");
      await sql`
        insert into store_members (id, store_id, user_id, email, display_name, role, active)
        values (${newId()}, ${store.id}, ${userId}, ${email}, ${data.displayName}, ${data.role}, true)
      `;
      await sql`delete from staff_invites where store_id = ${store.id} and lower(email) = ${email}`;
      return { pending: false };
    }

    if (existingUser[0]) {
      const taken = await sql<{ id: string }>`select id from store_members where user_id = ${existingUser[0].id}`;
      if (taken[0]) throw new Error("That account already belongs to a store.");
      await sql`
        insert into store_members (id, store_id, user_id, email, display_name, role, active)
        values (${newId()}, ${store.id}, ${existingUser[0].id}, ${email}, ${data.displayName}, ${data.role}, true)
      `;
      return { pending: false };
    }

    await sql`
      insert into staff_invites (id, store_id, email, display_name, role, created_by)
      values (${newId()}, ${store.id}, ${email}, ${data.displayName}, ${data.role}, ${member.userId})
      on conflict (store_id, email) do update set display_name = excluded.display_name, role = excluded.role
    `;
    return { pending: true };
  });

export const updateStaff = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      id: z.string(),
      role: roleSchema.optional(),
      active: z.boolean().optional(),
      pending: z.boolean(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "staff");
    if (data.pending) {
      if (data.active === false) {
        await sql`delete from staff_invites where id = ${data.id} and store_id = ${store.id}`;
        return { ok: true };
      }
      if (data.role) {
        await sql`
          update staff_invites set role = ${data.role}
          where id = ${data.id} and store_id = ${store.id}
        `;
      }
      return { ok: true };
    }
    const target = await sql<{ user_id: string; role: Role }>`
      select user_id, role from store_members where id = ${data.id} and store_id = ${store.id}
    `;
    if (!target[0]) throw new Error("Staff member not found.");
    if (target[0].user_id === member.userId && data.active === false) {
      throw new Error("You cannot disable your own account.");
    }
    if (target[0].role === "admin" && (data.role !== "admin" || data.active === false)) {
      const admins = await sql<{ c: number }>`
        select count(*)::int as c from store_members
        where store_id = ${store.id} and role = 'admin' and active = true
      `;
      if (n(admins[0]?.c) <= 1) throw new Error("Keep at least one active admin.");
    }
    if (data.role) {
      await sql`
        update store_members set role = ${data.role}
        where id = ${data.id} and store_id = ${store.id}
      `;
    }
    if (typeof data.active === "boolean") {
      await sql`
        update store_members set active = ${data.active}
        where id = ${data.id} and store_id = ${store.id}
      `;
    }
    return { ok: true };
  });

export const updateStore = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      name: z.string().trim().min(1).max(80),
      legalName: z.string().trim().max(120).nullable().optional(),
      address: z.string().trim().max(200).nullable().optional(),
      phone: z.string().trim().max(40).nullable().optional(),
      taxRateBps: z.number().int().min(0).max(3000),
      receiptFooter: z.string().trim().max(240).nullable().optional(),
    }),
  )
  .handler(async ({ context, data }): Promise<Store> => {
    const { sql, store } = await requirePos(context.userId, "settings");
    await sql`
      update stores set
        name = ${data.name},
        legal_name = ${data.legalName ?? null},
        address = ${data.address ?? null},
        phone = ${data.phone ?? null},
        tax_rate_bps = ${data.taxRateBps},
        receipt_footer = ${data.receiptFooter ?? null}
      where id = ${store.id}
    `;
    return {
      ...store,
      name: data.name,
      legalName: data.legalName ?? null,
      address: data.address ?? null,
      phone: data.phone ?? null,
      taxRateBps: data.taxRateBps,
      receiptFooter: data.receiptFooter ?? null,
    };
  });

async function sha256(raw: string) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(raw).digest("hex");
}

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<ApiKeyRow[]> => {
    const { sql, store } = await requirePos(context.userId, "api_keys");
    const rows = await sql<{
      id: string;
      name: string;
      key_prefix: string;
      last_used_at: unknown;
      created_at: unknown;
      revoked: boolean;
    }>`
      select id, name, key_prefix, last_used_at, created_at, revoked
      from api_keys where store_id = ${store.id}
      order by created_at desc
    `;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      lastUsedAt: r.last_used_at ? asText(r.last_used_at) : null,
      createdAt: asText(r.created_at),
      revoked: Boolean(r.revoked),
    }));
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(1).max(60) }))
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "api_keys");
    const { randomBytes } = await import("node:crypto");
    const raw = `till_${randomBytes(24).toString("hex")}`;
    const id = newId();
    const prefix = raw.slice(0, 12);
    await sql`
      insert into api_keys (id, store_id, name, key_prefix, key_hash, created_by)
      values (${id}, ${store.id}, ${data.name}, ${prefix}, ${await sha256(raw)}, ${member.userId})
    `;
    return { id, token: raw, prefix };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "api_keys");
    await sql`
      update api_keys set revoked = true
      where id = ${data.id} and store_id = ${store.id}
    `;
    return { ok: true };
  });

export type { Member };
