import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { n, requirePos } from "./context";

export const listCustomers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ q: z.string().optional() }).optional())
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "sales");
    const q = data?.q?.trim() ?? "";
    const rows = await sql<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      loyalty_points: number;
    }>`
      select id, name, email, phone, loyalty_points
      from customers
      where store_id = ${store.id}
        and (${q} = '' or name ilike ${"%" + q + "%"} or coalesce(email,'') ilike ${"%" + q + "%"} or coalesce(phone,'') ilike ${"%" + q + "%"})
      order by name
      limit 100
    `;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      loyaltyPoints: n(r.loyalty_points),
    }));
  });

export const saveCustomer = createServerFn({ method: "POST" })
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
    const { sql, store } = await requirePos(context.userId, "sales");
    if (data.id) {
      await sql`
        update customers set name = ${data.name}, email = ${data.email ?? null}, phone = ${data.phone ?? null}, note = ${data.note ?? null}
        where id = ${data.id} and store_id = ${store.id}
      `;
      return { id: data.id };
    }
    const id = newId();
    await sql`
      insert into customers (id, store_id, name, email, phone, note)
      values (${id}, ${store.id}, ${data.name}, ${data.email ?? null}, ${data.phone ?? null}, ${data.note ?? null})
    `;
    return { id };
  });

export const holdTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ name: z.string().trim().min(1).max(40), payload: z.unknown() }))
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "pos");
    const id = newId();
    await sql`
      insert into held_tickets (id, store_id, name, payload, created_by)
      values (${id}, ${store.id}, ${data.name}, ${JSON.stringify(data.payload)}::jsonb, ${member.userId})
    `;
    return { id };
  });

export const listHeldTickets = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store } = await requirePos(context.userId, "pos");
    const rows = await sql<{ id: string; name: string; payload: unknown; created_at: unknown }>`
      select id, name, payload, created_at from held_tickets where store_id = ${store.id} order by created_at desc
    `;
    return rows;
  });

export const releaseHeldTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ id: z.string() }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "pos");
    const rows = await sql<{ payload: unknown }>`
      delete from held_tickets where id = ${data.id} and store_id = ${store.id} returning payload
    `;
    if (!rows[0]) throw new Error("Held ticket not found.");
    return { payload: rows[0].payload };
  });

export const openShift = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ openingCents: z.number().int().min(0) }))
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "pos");
    const open = await sql<{ id: string }>`
      select id from shifts where store_id = ${store.id} and user_id = ${member.userId} and closed_at is null
    `;
    if (open[0]) throw new Error("You already have an open shift.");
    const id = newId();
    await sql`
      insert into shifts (id, store_id, user_id, opening_cents)
      values (${id}, ${store.id}, ${member.userId}, ${data.openingCents})
    `;
    return { id };
  });

export const closeShift = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ declaredCents: z.number().int().min(0), note: z.string().optional() }))
  .handler(async ({ context, data }) => {
    const { sql, store, member } = await requirePos(context.userId, "pos");
    const open = await sql<{ id: string; opening_cents: number }>`
      select id, opening_cents from shifts
      where store_id = ${store.id} and user_id = ${member.userId} and closed_at is null
    `;
    if (!open[0]) throw new Error("No open shift.");
    const sales = await sql<{ cash: number }>`
      select coalesce(sum(p.amount_cents), 0)::int as cash
      from payments p
      join sales s on s.id = p.sale_id
      join shifts sh on sh.id = ${open[0].id}
      where p.store_id = ${store.id} and p.method = 'cash' and s.status = 'completed'
        and s.created_at >= sh.opened_at
    `;
    const expected = n(open[0].opening_cents) + n(sales[0]?.cash);
    await sql`
      update shifts set closed_at = now(), closing_cents = ${expected}, declared_cents = ${data.declaredCents}, note = ${data.note ?? null}
      where id = ${open[0].id}
    `;
    return { expectedCents: expected, differenceCents: data.declaredCents - expected };
  });

export const salesReport = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store } = await requirePos(context.userId, "reports");
    const byDay = await sql<{ day: string; cents: number; count: number }>`
      select created_at::date::text as day, coalesce(sum(total_cents),0)::int as cents, count(*)::int as count
      from sales
      where store_id = ${store.id} and status = 'completed' and created_at >= now() - interval '30 days'
      group by 1 order by 1
    `;
    const bySku = await sql<{ sku: string; name: string; qty: number; cents: number }>`
      select i.sku, i.name, sum(i.quantity)::int as qty, sum(i.line_total_cents)::int as cents
      from sale_items i
      join sales s on s.id = i.sale_id
      where s.store_id = ${store.id} and s.status = 'completed' and s.created_at >= now() - interval '30 days'
      group by 1, 2 order by cents desc limit 50
    `;
    const byCashier = await sql<{ cashier_name: string; cents: number; count: number }>`
      select cashier_name, coalesce(sum(total_cents),0)::int as cents, count(*)::int as count
      from sales
      where store_id = ${store.id} and status = 'completed' and created_at >= now() - interval '30 days'
      group by 1 order by cents desc
    `;
    const tax = await sql<{ tax: number }>`
      select coalesce(sum(tax_cents),0)::int as tax
      from sales where store_id = ${store.id} and status = 'completed' and created_at >= now() - interval '30 days'
    `;
    return {
      byDay: byDay.map((r) => ({ day: r.day, cents: n(r.cents), count: n(r.count) })),
      bySku: bySku.map((r) => ({ sku: r.sku, name: r.name, qty: n(r.qty), cents: n(r.cents) })),
      byCashier: byCashier.map((r) => ({ name: r.cashier_name, cents: n(r.cents), count: n(r.count) })),
      taxCents: n(tax[0]?.tax),
    };
  });
