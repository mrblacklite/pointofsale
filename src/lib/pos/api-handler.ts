import { createHash } from "node:crypto";
import { getSql } from "@/lib/db";
import { newId } from "@/lib/utils";
import { completeSaleInternal, voidSaleInternal } from "./actions";
import { n } from "./context";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
  });
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS });
}

function hashKey(raw: string) {
  return createHash("sha256").update(raw).digest("hex");
}

function bearer(request: Request) {
  const h = request.headers.get("authorization") || request.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m?.[1]?.trim() ?? "";
}

async function authStore(request: Request) {
  const token = bearer(request);
  if (!token.startsWith("till_")) return null;
  const sql = await getSql();
  const rows = await sql<{
    id: string;
    store_id: string;
    created_by: string;
    revoked: boolean;
  }>`
    select id, store_id, created_by, revoked from api_keys
    where key_hash = ${hashKey(token)}
    limit 1
  `;
  const key = rows[0];
  if (!key || key.revoked) return null;
  await sql`update api_keys set last_used_at = now() where id = ${key.id}`;
  return key;
}

type SaleBody = {
  items?: Array<{ sku?: string; barcode?: string; quantity?: number }>;
  discount_code?: string | null;
  payments?: Array<{ method?: string; amount_cents?: number; gift_card_code?: string | null }>;
  tendered_cents?: number;
  note?: string;
};

async function parseSale(sql: Awaited<ReturnType<typeof getSql>>, storeId: string, body: SaleBody) {
  const items = body.items ?? [];
  if (!items.length) throw new Error("items required");
  const lines: Array<{ productId: string; quantity: number }> = [];
  for (const item of items) {
    const code = item.sku?.trim() || item.barcode?.trim();
    const qty = Number(item.quantity ?? 1);
    if (!code || !Number.isInteger(qty) || qty < 1) {
      throw new Error("each item needs sku/barcode and quantity");
    }
    const p = await sql<{ id: string }>`
      select id from products
      where store_id = ${storeId} and (sku = ${code} or barcode = ${code})
      limit 1
    `;
    if (!p[0]) throw new Error(`Unknown product ${code}`);
    lines.push({ productId: p[0].id, quantity: qty });
  }
  const payments = (body.payments ?? []).map((p) => ({
    method: (p.method === "gift_card" ? "gift_card" : p.method === "card" ? "card" : "cash") as
      | "cash"
      | "card"
      | "gift_card",
    amountCents: Number(p.amount_cents ?? 0),
    giftCardCode: p.gift_card_code ?? null,
  }));
  return {
    lines,
    payments,
    discountCode: body.discount_code ?? null,
    tenderedCents: body.tendered_cents,
    note: body.note ?? "API sale",
  };
}

function salePayload(result: Awaited<ReturnType<typeof completeSaleInternal>>) {
  return {
    id: result.id,
    receipt_number: result.receiptNumber,
    subtotal_cents: result.subtotalCents,
    discount_cents: result.discountCents,
    tax_cents: result.taxCents,
    total_cents: result.totalCents,
    change_cents: result.changeCents,
    cashier_name: result.cashierName,
    store_name: result.storeName,
    created_at: result.createdAt,
    items: result.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unit_price_cents: i.unitPriceCents,
      tax_cents: i.taxCents,
      line_total_cents: i.lineTotalCents,
    })),
  };
}

export async function handlePosApi(request: Request, splat: string) {
  if (request.method === "OPTIONS") return corsPreflight();

  const path = splat.replace(/^\/+|\/+$/g, "");
  const segments = path ? path.split("/") : [];
  const key = await authStore(request);
  if (!key) return json({ error: "Unauthorized. Send Authorization: Bearer till_…" }, 401);

  const sql = await getSql();
  const storeId = key.store_id;
  const actorId = key.created_by;

  try {
    if (request.method === "GET" && (path === "" || path === "health")) {
      const store = await sql<{ name: string; tax_rate_bps: number; currency: string }>`
        select name, tax_rate_bps, currency from stores where id = ${storeId}
      `;
      return json({
        ok: true,
        service: "till",
        version: "1",
        store: store[0]
          ? {
              name: store[0].name,
              tax_rate_bps: n(store[0].tax_rate_bps),
              currency: store[0].currency,
            }
          : null,
        endpoints: [
          "GET /api/v1",
          "GET /api/v1/products?q=",
          "GET /api/v1/products/{sku}",
          "POST /api/v1/products",
          "PATCH /api/v1/products/{sku}",
          "GET /api/v1/categories",
          "GET /api/v1/inventory",
          "POST /api/v1/inventory/adjust",
          "GET /api/v1/discounts",
          "GET /api/v1/gift-cards/{code}",
          "POST /api/v1/gift-cards",
          "GET /api/v1/sales",
          "GET /api/v1/sales/{id}",
          "POST /api/v1/sales/quote",
          "POST /api/v1/sales",
          "POST /api/v1/sales/{id}/void",
        ],
      });
    }

    if (request.method === "GET" && path === "categories") {
      const rows = await sql<{ id: string; name: string; sort_order: number }>`
        select id, name, sort_order from categories where store_id = ${storeId} order by sort_order, name
      `;
      return json({ categories: rows });
    }

    if (request.method === "GET" && path === "discounts") {
      const rows = await sql<Record<string, unknown>>`
        select code, name, type, value, min_subtotal_cents, active
        from discounts where store_id = ${storeId} order by code
      `;
      return json({ discounts: rows });
    }

    if (request.method === "GET" && path === "products") {
      const url = new URL(request.url);
      const q = url.searchParams.get("q")?.trim() ?? "";
      const rows = await sql<Record<string, unknown>>`
        select p.id, p.sku, p.barcode, p.name, p.description, p.price_cents, p.cost_cents,
          p.tax_exempt, p.track_inventory, p.quantity, p.reorder_point, p.active,
          c.name as category
        from products p
        left join categories c on c.id = p.category_id
        where p.store_id = ${storeId}
          and (
            ${q} = ''
            or p.name ilike ${"%" + q + "%"}
            or p.sku ilike ${"%" + q + "%"}
            or coalesce(p.barcode, '') ilike ${"%" + q + "%"}
          )
        order by p.name
        limit 500
      `;
      return json({ products: rows });
    }

    if (request.method === "GET" && segments[0] === "products" && segments[1]) {
      const sku = decodeURIComponent(segments[1]);
      const rows = await sql<Record<string, unknown>>`
        select p.id, p.sku, p.barcode, p.name, p.description, p.price_cents, p.cost_cents,
          p.tax_exempt, p.track_inventory, p.quantity, p.reorder_point, p.active,
          c.name as category
        from products p
        left join categories c on c.id = p.category_id
        where p.store_id = ${storeId} and (p.sku = ${sku} or p.barcode = ${sku})
        limit 1
      `;
      if (!rows[0]) return json({ error: "Product not found" }, 404);
      return json({ product: rows[0] });
    }

    if (request.method === "POST" && path === "products") {
      const body = (await request.json()) as Record<string, unknown>;
      const sku = String(body.sku ?? "").trim();
      const name = String(body.name ?? "").trim();
      const price = Number(body.price_cents);
      if (!sku || !name || !Number.isInteger(price) || price < 0) {
        return json({ error: "sku, name, and integer price_cents are required" }, 400);
      }
      let categoryId: string | null = null;
      const catName = typeof body.category === "string" ? body.category.trim() : "";
      if (catName) {
        const cat = await sql<{ id: string }>`
          select id from categories where store_id = ${storeId} and lower(name) = ${catName.toLowerCase()}
        `;
        if (cat[0]) categoryId = cat[0].id;
        else {
          categoryId = newId();
          await sql`
            insert into categories (id, store_id, name, sort_order)
            values (${categoryId}, ${storeId}, ${catName}, 99)
          `;
        }
      }
      const id = newId();
      const qty = Number.isInteger(Number(body.quantity)) ? Number(body.quantity) : 0;
      await sql`
        insert into products (
          id, store_id, category_id, sku, barcode, name, description,
          price_cents, cost_cents, tax_exempt, track_inventory, quantity, reorder_point, active
        ) values (
          ${id}, ${storeId}, ${categoryId}, ${sku},
          ${typeof body.barcode === "string" ? body.barcode : null},
          ${name},
          ${typeof body.description === "string" ? body.description : null},
          ${price},
          ${Number.isInteger(Number(body.cost_cents)) ? Number(body.cost_cents) : 0},
          ${Boolean(body.tax_exempt)},
          ${body.track_inventory === false ? false : true},
          ${qty},
          ${Number.isInteger(Number(body.reorder_point)) ? Number(body.reorder_point) : 5},
          ${body.active === false ? false : true}
        )
      `;
      if (qty !== 0) {
        await sql`
          insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
          values (${newId()}, ${storeId}, ${id}, ${qty}, 'receive', 'API create', ${actorId})
        `;
      }
      return json({ product: { id, sku, name, price_cents: price, quantity: qty } }, 201);
    }

    if (request.method === "PATCH" && segments[0] === "products" && segments[1]) {
      const sku = decodeURIComponent(segments[1]);
      const body = (await request.json()) as Record<string, unknown>;
      const existing = await sql<{ id: string; quantity: number }>`
        select id, quantity from products where store_id = ${storeId} and sku = ${sku}
      `;
      if (!existing[0]) return json({ error: "Product not found" }, 404);
      const sets: string[] = [];
      const args: unknown[] = [];
      const push = (col: string, val: unknown) => {
        sets.push(`${col} = $${sets.length + 1}`);
        args.push(val);
      };
      if (typeof body.name === "string") push("name", body.name.trim());
      if (typeof body.barcode === "string" || body.barcode === null) push("barcode", body.barcode);
      if (typeof body.description === "string" || body.description === null) push("description", body.description);
      if (Number.isInteger(Number(body.price_cents))) push("price_cents", Number(body.price_cents));
      if (Number.isInteger(Number(body.cost_cents))) push("cost_cents", Number(body.cost_cents));
      if (typeof body.tax_exempt === "boolean") push("tax_exempt", body.tax_exempt);
      if (typeof body.track_inventory === "boolean") push("track_inventory", body.track_inventory);
      if (typeof body.active === "boolean") push("active", body.active);
      if (Number.isInteger(Number(body.reorder_point))) push("reorder_point", Number(body.reorder_point));
      if (Number.isInteger(Number(body.quantity))) {
        const nextQty = Number(body.quantity);
        push("quantity", nextQty);
      }
      if (!sets.length) return json({ error: "No fields to update" }, 400);
      await sql.query(
        `update products set ${sets.join(", ")}, updated_at = now() where id = $${sets.length + 1} and store_id = $${sets.length + 2}`,
        [...args, existing[0].id, storeId],
      );
      if (Number.isInteger(Number(body.quantity))) {
        const nextQty = Number(body.quantity);
        const delta = nextQty - n(existing[0].quantity);
        if (delta !== 0) {
          await sql`
            insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
            values (${newId()}, ${storeId}, ${existing[0].id}, ${delta}, 'adjust', 'API patch', ${actorId})
          `;
        }
      }
      return json({ ok: true, sku });
    }

    if (request.method === "GET" && path === "inventory") {
      const rows = await sql<Record<string, unknown>>`
        select sku, name, quantity, reorder_point, track_inventory, active, cost_cents
        from products where store_id = ${storeId}
        order by name
      `;
      return json({ inventory: rows });
    }

    if (request.method === "POST" && (path === "inventory/adjust" || path === "inventory")) {
      const body = (await request.json()) as {
        sku?: string;
        delta?: number;
        reason?: string;
        note?: string;
      };
      const sku = body.sku?.trim();
      const delta = Number(body.delta);
      if (!sku || !Number.isInteger(delta) || delta === 0) {
        return json({ error: "sku and integer delta are required" }, 400);
      }
      const reason = ["receive", "adjust", "waste", "count"].includes(body.reason ?? "")
        ? body.reason
        : "adjust";
      const updated = await sql<{ id: string; quantity: number; sku: string; name: string }>`
        update products
        set quantity = quantity + ${delta}, updated_at = now()
        where store_id = ${storeId} and sku = ${sku} and quantity + ${delta} >= 0
        returning id, quantity, sku, name
      `;
      if (!updated[0]) return json({ error: "Product not found or stock would go negative" }, 400);
      await sql`
        insert into inventory_movements (id, store_id, product_id, delta, reason, note, user_id)
        values (${newId()}, ${storeId}, ${updated[0].id}, ${delta}, ${reason}, ${body.note ?? "API"}, ${actorId})
      `;
      return json({
        sku: updated[0].sku,
        name: updated[0].name,
        quantity: n(updated[0].quantity),
      });
    }

    if (request.method === "GET" && segments[0] === "gift-cards" && segments[1]) {
      const code = decodeURIComponent(segments[1]);
      const rows = await sql<{ code: string; balance_cents: number; status: string; initial_cents: number }>`
        select code, balance_cents, status, initial_cents
        from gift_cards where store_id = ${storeId} and lower(code) = ${code.toLowerCase()}
      `;
      if (!rows[0]) return json({ error: "Gift card not found" }, 404);
      return json({ gift_card: rows[0] });
    }

    if (request.method === "POST" && path === "gift-cards") {
      const body = (await request.json()) as { code?: string; amount_cents?: number };
      const amount = Number(body.amount_cents);
      if (!Number.isInteger(amount) || amount < 100) {
        return json({ error: "amount_cents (integer, min 100) required" }, 400);
      }
      const { randomBytes } = await import("node:crypto");
      const code = (body.code?.trim() || `TILL-${randomBytes(3).toString("hex").toUpperCase()}`).toUpperCase();
      const id = newId();
      await sql`
        insert into gift_cards (id, store_id, code, initial_cents, balance_cents, status)
        values (${id}, ${storeId}, ${code}, ${amount}, ${amount}, 'active')
      `;
      await sql`
        insert into gift_card_ledger (id, gift_card_id, store_id, delta_cents, reason, user_id)
        values (${newId()}, ${id}, ${storeId}, ${amount}, 'issue', ${actorId})
      `;
      return json({ gift_card: { id, code, balance_cents: amount } }, 201);
    }

    if (request.method === "GET" && path === "sales") {
      const rows = await sql<Record<string, unknown>>`
        select s.id, s.receipt_number, s.cashier_name, s.status,
          s.subtotal_cents, s.tax_cents, s.discount_cents, s.total_cents, s.created_at,
          (select count(*)::int from sale_items i where i.sale_id = s.id) as item_count
        from sales s
        where s.store_id = ${storeId}
        order by s.created_at desc
        limit 100
      `;
      return json({ sales: rows });
    }

    if (request.method === "GET" && segments[0] === "sales" && segments[1] && !segments[2]) {
      const id = decodeURIComponent(segments[1]);
      const rows = await sql<Record<string, unknown>>`
        select id, receipt_number, cashier_name, status, discount_code,
          subtotal_cents, tax_cents, discount_cents, total_cents,
          tendered_cents, change_cents, note, created_at
        from sales where store_id = ${storeId} and (id = ${id} or receipt_number::text = ${id})
        limit 1
      `;
      if (!rows[0]) return json({ error: "Sale not found" }, 404);
      const items = await sql<Record<string, unknown>>`
        select sku, name, quantity, unit_price_cents, tax_cents, line_total_cents
        from sale_items where sale_id = ${String(rows[0].id)}
      `;
      const payments = await sql<Record<string, unknown>>`
        select method, amount_cents, gift_card_code from payments where sale_id = ${String(rows[0].id)}
      `;
      return json({ sale: { ...rows[0], items, payments } });
    }

    if (request.method === "POST" && path === "sales/quote") {
      const body = (await request.json()) as SaleBody;
      const parsed = await parseSale(sql, storeId, { ...body, payments: body.payments?.length ? body.payments : [{ method: "card", amount_cents: 1 }] });
      parsed.payments = body.payments?.length
        ? parsed.payments
        : [{ method: "card", amountCents: 1, giftCardCode: null }];
      const result = await completeSaleInternal(actorId, parsed, { viaApi: true, dryRun: true });
      return json({ quote: salePayload(result) });
    }

    if (request.method === "POST" && path === "sales") {
      const body = (await request.json()) as SaleBody;
      if (!body.payments?.length) return json({ error: "payments required" }, 400);
      const parsed = await parseSale(sql, storeId, body);
      const result = await completeSaleInternal(actorId, parsed, { viaApi: true });
      return json({ sale: salePayload(result) }, 201);
    }

    if (request.method === "POST" && segments[0] === "sales" && segments[1] && segments[2] === "void") {
      const id = decodeURIComponent(segments[1]);
      const found = await sql<{ id: string }>`
        select id from sales
        where store_id = ${storeId} and (id = ${id} or receipt_number::text = ${id})
        limit 1
      `;
      if (!found[0]) return json({ error: "Sale not found" }, 404);
      await voidSaleInternal(actorId, found[0].id);
      return json({ ok: true, id: found[0].id });
    }

    return json({ error: `Unknown route /api/v1/${path}` }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Server error";
    const status = message === "You do not have permission to do that." ? 403 : 400;
    return json({ error: message }, status);
  }
}
