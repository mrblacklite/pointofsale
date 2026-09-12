import { z } from "zod";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { n, requirePos } from "./context";
import { chargeCard } from "./card-processor";
import { deliverReceipt, renderReceiptText } from "./receipts";
import type { CompleteSaleInput, SaleResult } from "./types";

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
  const tipCents = Math.max(0, Number(data.tipCents ?? 0));
  const customerEmail = data.customerEmail?.trim() || null;
  const customerPhone = data.customerPhone?.trim() || null;
  const total = discountedSubtotal + taxCents + tipCents;

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
      tipCents,
      customerEmail,
      customerPhone,
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
      tendered_cents, change_cents, note, tip_cents, customer_email, customer_phone
    ) values (
      ${saleId}, ${store.id}, ${receiptNumber}, ${member.userId}, ${member.displayName}, ${"completed"},
      ${discountCode}, ${discountCents}, ${discountedSubtotal}, ${taxCents}, ${total},
      ${tendered}, ${change}, ${data.note ?? null}, ${tipCents}, ${customerEmail}, ${customerPhone}
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
    let processor: string | null = null;
    let processorRef: string | null = null;
    let last4: string | null = null;
    let status = "captured";
    if (pmt.method === "card") {
      const charged = await chargeCard({
        amountCents: pmt.amountCents,
        currency: store.currency,
        storeName: store.name,
        saleNote: data.note,
        paymentMethodId: pmt.paymentMethodId,
        cardToken: pmt.cardToken,
      });
      processor = charged.processor;
      processorRef = charged.processorRef;
      last4 = charged.last4;
      status = charged.status;
    }
    await sql`
      insert into payments (id, sale_id, store_id, method, amount_cents, gift_card_code, processor, processor_ref, last4, status)
      values (${newId()}, ${saleId}, ${store.id}, ${pmt.method}, ${pmt.amountCents}, ${pmt.giftCardCode ?? null}, ${processor}, ${processorRef}, ${last4}, ${status})
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
    tipCents,
    customerEmail,
    customerPhone,
    items: built,
    cashierName: member.displayName,
    storeName: store.name,
    receiptFooter: store.receiptFooter,
    createdAt: new Date().toISOString(),
  };
}

export const sendSaleReceipt = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      saleId: z.string(),
      channel: z.enum(["email", "sms"]),
      destination: z.string().trim().min(3).max(120),
    }),
  )
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "pos");
    const sale = await sql<{
      id: string;
      receipt_number: number;
      total_cents: number;
      tip_cents: number;
      receipt_footer: string | null;
    }>`
      select s.id, s.receipt_number, s.total_cents, coalesce(s.tip_cents, 0)::int as tip_cents,
        st.receipt_footer
      from sales s
      join stores st on st.id = s.store_id
      where s.id = ${data.saleId} and s.store_id = ${store.id}
    `;
    if (!sale[0]) throw new Error("Sale not found.");
    const items = await sql<{ quantity: number; name: string; line_total_cents: number }>`
      select quantity, name, line_total_cents from sale_items where sale_id = ${data.saleId}
    `;
    const payload = {
      storeName: store.name,
      receiptNumber: n(sale[0].receipt_number),
      totalCents: n(sale[0].total_cents),
      tipCents: n(sale[0].tip_cents),
      currency: store.currency,
      footer: sale[0].receipt_footer,
      lines: items.map((i) => ({
        quantity: n(i.quantity),
        name: i.name,
        lineTotalCents: n(i.line_total_cents),
      })),
    };
    const result = await deliverReceipt({
      channel: data.channel,
      destination: data.destination,
      payload,
    });
    await sql`
      insert into receipt_deliveries (
        id, store_id, sale_id, channel, destination, status, provider, provider_ref, error
      ) values (
        ${newId()}, ${store.id}, ${data.saleId}, ${data.channel}, ${data.destination},
        ${result.status}, ${result.provider}, ${result.providerRef}, ${result.error}
      )
    `;
    if (data.channel === "email") {
      await sql`update sales set customer_email = ${data.destination} where id = ${data.saleId}`;
    } else {
      await sql`update sales set customer_phone = ${data.destination} where id = ${data.saleId}`;
    }
    if (result.status === "failed") throw new Error(result.error || "Receipt delivery failed.");
    return { ...result, preview: renderReceiptText(payload) };
  });
