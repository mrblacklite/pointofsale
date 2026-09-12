import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { asText, n, requirePos } from "./context";

export type CustomerPurchase = {
  id: string;
  receiptNumber: number;
  totalCents: number;
  status: string;
  createdAt: string;
  itemCount: number;
};

export type CustomerAccount = {
  id: string;
  name: string;
  email: string | null;
  creditCents: number;
  spentCents: number;
  ticketCount: number;
  purchases: CustomerPurchase[];
};

async function loadAccount(userId: string): Promise<CustomerAccount> {
  const { sql, store, member } = await requirePos(userId);
  let rows = await sql<{
    id: string;
    name: string;
    email: string | null;
    credit_cents: number;
  }>`
    select id, name, email, coalesce(credit_cents, 0)::int as credit_cents
    from customers
    where store_id = ${store.id} and user_id = ${userId}
    limit 1
  `;
  if (!rows[0] && member.email) {
    rows = await sql<{
      id: string;
      name: string;
      email: string | null;
      credit_cents: number;
    }>`
      select id, name, email, coalesce(credit_cents, 0)::int as credit_cents
      from customers
      where store_id = ${store.id} and lower(email) = ${member.email.toLowerCase()}
      limit 1
    `;
  }
  if (!rows[0]) {
    return {
      id: "",
      name: member.displayName,
      email: member.email,
      creditCents: 0,
      spentCents: 0,
      ticketCount: 0,
      purchases: [],
    };
  }
  const cust = rows[0];
  const totals = await sql<{ spent: number; tickets: number }>`
    select coalesce(sum(total_cents), 0)::int as spent, count(*)::int as tickets
    from sales
    where store_id = ${store.id}
      and customer_id = ${cust.id}
      and status = 'completed'
  `;
  const purchases = await sql<{
    id: string;
    receipt_number: number;
    total_cents: number;
    status: string;
    created_at: unknown;
    item_count: number;
  }>`
    select s.id, s.receipt_number, s.total_cents, s.status, s.created_at,
      (select count(*)::int from sale_items i where i.sale_id = s.id) as item_count
    from sales s
    where s.store_id = ${store.id} and s.customer_id = ${cust.id}
    order by s.created_at desc
    limit 50
  `;
  return {
    id: cust.id,
    name: cust.name,
    email: cust.email,
    creditCents: n(cust.credit_cents),
    spentCents: n(totals[0]?.spent),
    ticketCount: n(totals[0]?.tickets),
    purchases: purchases.map((p) => ({
      id: p.id,
      receiptNumber: n(p.receipt_number),
      totalCents: n(p.total_cents),
      status: p.status,
      createdAt: asText(p.created_at),
      itemCount: n(p.item_count),
    })),
  };
}

export const getMyAccount = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => loadAccount(context.userId));

export const listStoreCustomers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store } = await requirePos(context.userId, "staff");
    const rows = await sql<{
      id: string;
      name: string;
      email: string | null;
      phone: string | null;
      credit_cents: number;
      user_id: string | null;
    }>`
      select id, name, email, phone, coalesce(credit_cents, 0)::int as credit_cents, user_id
      from customers
      where store_id = ${store.id}
      order by name
      limit 200
    `;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      phone: r.phone,
      creditCents: n(r.credit_cents),
      userId: r.user_id,
    }));
  });

export const setCustomerCredit = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ customerId: z.string(), creditCents: z.number().int().min(0).max(10000000) }))
  .handler(async ({ context, data }) => {
    const { sql, store } = await requirePos(context.userId, "staff");
    const updated = await sql<{ id: string }>`
      update customers
      set credit_cents = ${data.creditCents}
      where id = ${data.customerId} and store_id = ${store.id}
      returning id
    `;
    if (!updated[0]) throw new Error("Customer not found.");
    return { ok: true };
  });
