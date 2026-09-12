import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { n, requirePos } from "./context";
import { lineRefundCents, returnableQty } from "./ops-math";

export const returnSale = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      saleId: z.string(),
      lines: z.array(z.object({ saleItemId: z.string(), quantity: z.number().int().min(1) })).min(1),
      method: z.enum(["cash", "card", "gift_card"]),
      giftCardCode: z.string().trim().max(32).optional(),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "sales");
    const sale = await sql<{
      id: string;
      status: string;
      receipt_number: number;
      return_of_sale_id: string | null;
    }>`
      select id, status, receipt_number, return_of_sale_id
      from sales where id = ${data.saleId} and store_id = ${store.id}
    `;
    if (!sale[0]) throw new Error("Sale not found.");
    if (sale[0].status !== "completed") throw new Error("Only completed tickets can be returned.");
    if (sale[0].return_of_sale_id) throw new Error("Cannot return a return ticket.");

    const items = await sql<{
      id: string;
      product_id: string | null;
      sku: string;
      name: string;
      quantity: number;
      unit_price_cents: number;
      tax_cents: number;
      line_total_cents: number;
    }>`
      select id, product_id, sku, name, quantity, unit_price_cents, tax_cents, line_total_cents
      from sale_items where sale_id = ${sale[0].id}
    `;
    const byId = new Map(items.map((i) => [i.id, i]));

    const prior = await sql<{ product_id: string | null; sku: string; qty: number }>`
      select si.product_id, si.sku, coalesce(sum(si.quantity),0)::int as qty
      from sale_items si
      join sales s on s.id = si.sale_id
      where s.store_id = ${store.id}
        and s.return_of_sale_id = ${sale[0].id}
        and s.status = 'completed'
      group by si.product_id, si.sku
    `;
    const priorQty = (productId: string | null, sku: string) => {
      const row = prior.find((p) => (productId && p.product_id === productId) || p.sku === sku);
      return n(row?.qty);
    };

    const built: Array<{
      productId: string | null;
      sku: string;
      name: string;
      quantity: number;
      unitPriceCents: number;
      taxCents: number;
      lineTotalCents: number;
    }> = [];

    for (const req of data.lines) {
      const item = byId.get(req.saleItemId);
      if (!item) throw new Error("Line is not on this ticket.");
      const sold = n(item.quantity);
      const allowed = returnableQty(sold, priorQty(item.product_id, item.sku));
      if (req.quantity > allowed) throw new Error(`${item.name}: only ${allowed} left to return.`);
      const merch = lineRefundCents(n(item.line_total_cents), sold, req.quantity);
      const tax = lineRefundCents(n(item.tax_cents), sold, req.quantity);
      built.push({
        productId: item.product_id,
        sku: item.sku,
        name: item.name,
        quantity: req.quantity,
        unitPriceCents: n(item.unit_price_cents),
        taxCents: -tax,
        lineTotalCents: -merch,
      });
    }

    const subtotal = built.reduce((s, l) => s + l.lineTotalCents, 0);
    const taxCents = built.reduce((s, l) => s + l.taxCents, 0);
    const total = subtotal + taxCents;
    if (total >= 0) throw new Error("Nothing to refund.");
    const refundCents = -total;

    let giftCode: string | null = null;
    if (data.method === "gift_card") {
      giftCode = data.giftCardCode?.trim().toUpperCase() || null;
      if (!giftCode) {
        const orig = await sql<{ gift_card_code: string | null }>`
          select gift_card_code from payments
          where sale_id = ${sale[0].id} and method = 'gift_card'
          limit 1
        `;
        giftCode = orig[0]?.gift_card_code ?? null;
      }
      if (!giftCode) throw new Error("Gift card code required for this refund.");
      const card = await sql<{ id: string; status: string }>`
        select id, status from gift_cards
        where store_id = ${store.id} and lower(code) = ${giftCode.toLowerCase()}
      `;
      if (!card[0] || card[0].status !== "active") throw new Error("Gift card is not active.");
    }

    const receiptRows = await sql<{ n: number }>`
      update store_counters set next_receipt = next_receipt + 1
      where store_id = ${store.id}
      returning next_receipt - 1 as n
    `;
    const receiptNumber = n(receiptRows[0]?.n) || 1001;
    const saleId = newId();

    await sql`
      insert into sales (
        id, store_id, receipt_number, cashier_user_id, cashier_name, status,
        discount_cents, subtotal_cents, tax_cents, total_cents,
        tendered_cents, change_cents, note, return_of_sale_id
      ) values (
        ${saleId}, ${store.id}, ${receiptNumber}, ${member.userId}, ${member.displayName}, ${"completed"},
        ${0}, ${subtotal}, ${taxCents}, ${total},
        ${0}, ${0}, ${"Return of ticket #" + sale[0].receipt_number}, ${sale[0].id}
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
      if (line.productId) {
        await sql`
          update products set quantity = quantity + ${line.quantity}, updated_at = now()
          where id = ${line.productId} and store_id = ${store.id} and track_inventory = true
        `;
        await sql`
          insert into inventory_movements (id, store_id, product_id, delta, reason, note, sale_id, user_id)
          values (${newId()}, ${store.id}, ${line.productId}, ${line.quantity}, ${"return"}, ${"Return"}, ${saleId}, ${member.userId})
        `;
      }
    }

    await sql`
      insert into payments (id, sale_id, store_id, method, amount_cents, gift_card_code)
      values (${newId()}, ${saleId}, ${store.id}, ${data.method}, ${-refundCents}, ${giftCode})
    `;

    if (data.method === "gift_card" && giftCode) {
      await sql`
        update gift_cards set balance_cents = balance_cents + ${refundCents}
        where store_id = ${store.id} and lower(code) = ${giftCode.toLowerCase()}
      `;
      const card = await sql<{ id: string }>`
        select id from gift_cards where store_id = ${store.id} and lower(code) = ${giftCode.toLowerCase()}
      `;
      if (card[0]) {
        await sql`
          insert into gift_card_ledger (id, gift_card_id, store_id, delta_cents, reason, sale_id, user_id)
          values (${newId()}, ${card[0].id}, ${store.id}, ${refundCents}, ${"return"}, ${saleId}, ${member.userId})
        `;
      }
    }

    return { id: saleId, receiptNumber, refundCents };
  });
