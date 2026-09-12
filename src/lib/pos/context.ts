import { getSql, type Sql } from "@/lib/db";
import { newId } from "@/lib/utils";
import { assertCan, type Permission, type Role } from "./roles";
import { seedStore } from "./seed";
import type { Member, Store } from "./types";

type UserRow = { id: string; email: string | null; name: string | null };

async function loadAuthUser(sql: Sql, userId: string): Promise<UserRow> {
  const rows = await sql<UserRow>`
    select id, email, name from "user" where id = ${userId} limit 1
  `;
  if (rows[0]) return rows[0];
  return { id: userId, email: `${userId}@till.local`, name: "Owner" };
}

function mapStore(row: {
  id: string;
  name: string;
  legal_name: string | null;
  address: string | null;
  phone: string | null;
  tax_rate_bps: number;
  currency: string;
  receipt_footer: string | null;
}): Store {
  return {
    id: row.id,
    name: row.name,
    legalName: row.legal_name,
    address: row.address,
    phone: row.phone,
    taxRateBps: Number(row.tax_rate_bps),
    currency: row.currency,
    receiptFooter: row.receipt_footer,
  };
}

function mapMember(row: {
  id: string;
  store_id: string;
  user_id: string;
  email: string;
  display_name: string;
  role: Role;
  active: boolean;
}): Member {
  return {
    id: row.id,
    storeId: row.store_id,
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
  };
}

export type PosCtx = {
  sql: Sql;
  store: Store;
  member: Member;
  seeded: boolean;
};

export async function requirePos(userId: string, permission?: Permission): Promise<PosCtx> {
  const sql = await getSql();
  const { member, store, seeded } = await ensureMembership(sql, userId);
  if (!member.active) throw new Error("This account is disabled.");
  if (permission) assertCan(member.role, permission);
  return { sql, store, member, seeded };
}

async function attachCustomer(
  sql: Sql,
  userId: string,
  email: string,
  displayName: string,
  storeRow: {
    id: string;
    name: string;
    legal_name: string | null;
    address: string | null;
    phone: string | null;
    tax_rate_bps: number;
    currency: string;
    receipt_footer: string | null;
  },
) {
  const memberId = newId();
  await sql`
    insert into store_members (id, store_id, user_id, email, display_name, role, active)
    values (${memberId}, ${storeRow.id}, ${userId}, ${email || `${userId}@till.local`}, ${displayName}, ${"customer"}, true)
  `;
  if (email) {
    await sql`
      insert into customers (id, store_id, user_id, name, email)
      values (${newId()}, ${storeRow.id}, ${userId}, ${displayName}, ${email})
      on conflict do nothing
    `;
  }
  return {
    seeded: false,
    member: mapMember({
      id: memberId,
      store_id: storeRow.id,
      user_id: userId,
      email: email || `${userId}@till.local`,
      display_name: displayName,
      role: "customer",
      active: true,
    }),
    store: mapStore(storeRow),
  };
}

async function ensureMembership(sql: Sql, userId: string) {
  const existing = await sql<{
    id: string;
    store_id: string;
    user_id: string;
    email: string;
    display_name: string;
    role: Role;
    active: boolean;
    store_name: string;
    legal_name: string | null;
    address: string | null;
    phone: string | null;
    tax_rate_bps: number;
    currency: string;
    receipt_footer: string | null;
  }>`
    select
      m.id, m.store_id, m.user_id, m.email, m.display_name, m.role, m.active,
      s.name as store_name, s.legal_name, s.address, s.phone,
      s.tax_rate_bps, s.currency, s.receipt_footer
    from store_members m
    join stores s on s.id = m.store_id
    where m.user_id = ${userId}
    limit 1
  `;

  if (existing[0]) {
    const row = existing[0];
    return {
      seeded: false,
      member: mapMember(row),
      store: mapStore({
        id: row.store_id,
        name: row.store_name,
        legal_name: row.legal_name,
        address: row.address,
        phone: row.phone,
        tax_rate_bps: row.tax_rate_bps,
        currency: row.currency,
        receipt_footer: row.receipt_footer,
      }),
    };
  }

  const user = await loadAuthUser(sql, userId);
  const email = (user.email ?? "").trim().toLowerCase();
  const displayName = user.name?.trim() || email.split("@")[0] || "Guest";

  if (email) {
    const invite = await sql<{
      id: string;
      store_id: string;
      email: string;
      display_name: string;
      role: Role;
    }>`
      select id, store_id, email, display_name, role
      from staff_invites
      where lower(email) = ${email}
      limit 1
    `;
    if (invite[0]) {
      const inv = invite[0];
      const memberId = newId();
      await sql`
        insert into store_members (id, store_id, user_id, email, display_name, role, active)
        values (${memberId}, ${inv.store_id}, ${userId}, ${email}, ${inv.display_name}, ${inv.role}, true)
      `;
      await sql`delete from staff_invites where id = ${inv.id}`;
      const storeRows = await sql<{
        id: string;
        name: string;
        legal_name: string | null;
        address: string | null;
        phone: string | null;
        tax_rate_bps: number;
        currency: string;
        receipt_footer: string | null;
      }>`
        select id, name, legal_name, address, phone, tax_rate_bps, currency, receipt_footer
        from stores where id = ${inv.store_id}
      `;
      const store = storeRows[0];
      if (!store) throw new Error("Store missing for invite.");
      return {
        seeded: false,
        member: mapMember({
          id: memberId,
          store_id: inv.store_id,
          user_id: userId,
          email,
          display_name: inv.display_name,
          role: inv.role,
          active: true,
        }),
        store: mapStore(store),
      };
    }
  }

  const stores = await sql<{
    id: string;
    name: string;
    legal_name: string | null;
    address: string | null;
    phone: string | null;
    tax_rate_bps: number;
    currency: string;
    receipt_footer: string | null;
  }>`
    select id, name, legal_name, address, phone, tax_rate_bps, currency, receipt_footer
    from stores
    order by created_at asc
    limit 1
  `;
  if (stores[0]) {
    return attachCustomer(sql, userId, email, displayName, stores[0]);
  }

  const storeId = newId();
  const storeName = displayName.endsWith("s") ? `${displayName}' Market` : `${displayName}'s Market`;

  await sql`
    insert into stores (id, owner_user_id, name, receipt_footer, tax_rate_bps, currency)
    values (
      ${storeId}, ${userId}, ${storeName},
      ${"Thank you for shopping with us."}, 825, ${"USD"}
    )
  `;
  await sql`
    insert into store_counters (store_id, next_receipt) values (${storeId}, 1001)
  `;
  const memberId = newId();
  await sql`
    insert into store_members (id, store_id, user_id, email, display_name, role, active)
    values (${memberId}, ${storeId}, ${userId}, ${email || `${userId}@till.local`}, ${displayName}, ${"admin"}, true)
  `;
  await seedStore(sql, storeId, userId);

  return {
    seeded: true,
    member: mapMember({
      id: memberId,
      store_id: storeId,
      user_id: userId,
      email: email || `${userId}@till.local`,
      display_name: displayName,
      role: "admin",
      active: true,
    }),
    store: mapStore({
      id: storeId,
      name: storeName,
      legal_name: null,
      address: null,
      phone: null,
      tax_rate_bps: 825,
      currency: "USD",
      receipt_footer: "Thank you for shopping with us.",
    }),
  };
}

export function n(value: unknown) {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

export function asText(value: unknown) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}
