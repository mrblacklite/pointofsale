import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { newId } from "@/lib/utils";
import { requirePos } from "./context";
import { clockHours } from "./ops-math";

export const myClockStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store, member } = await requirePos(context.userId, "sales");
    const open = await sql<{ id: string; clocked_in_at: unknown }>`
      select id, clocked_in_at from time_clock
      where store_id = ${store.id} and user_id = ${member.userId} and clocked_out_at is null
      order by clocked_in_at desc
      limit 1
    `;
    return {
      clockedIn: Boolean(open[0]),
      entryId: open[0]?.id ?? null,
      clockedInAt: open[0] ? String(open[0].clocked_in_at) : null,
    };
  });

export const clockIn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store, member } = await requirePos(context.userId, "sales");
    const open = await sql<{ id: string }>`
      select id from time_clock
      where store_id = ${store.id} and user_id = ${member.userId} and clocked_out_at is null
    `;
    if (open[0]) throw new Error("Already clocked in.");
    const id = newId();
    await sql`
      insert into time_clock (id, store_id, user_id)
      values (${id}, ${store.id}, ${member.userId})
    `;
    return { id };
  });

export const clockOut = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, store, member } = await requirePos(context.userId, "sales");
    const open = await sql<{ id: string; clocked_in_at: unknown }>`
      select id, clocked_in_at from time_clock
      where store_id = ${store.id} and user_id = ${member.userId} and clocked_out_at is null
    `;
    if (!open[0]) throw new Error("Not clocked in.");
    await sql`update time_clock set clocked_out_at = now() where id = ${open[0].id}`;
    const hours = clockHours(new Date(String(open[0].clocked_in_at)), new Date(), new Date());
    return { id: open[0].id, hours };
  });

export const listTimeClock = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(z.object({ days: z.number().int().min(1).max(90).optional() }).optional())
  .handler(async ({ context }) => {
    const { sql, store, member } = await requirePos(context.userId, "sales");
    const days = 14;
    const staffView = member.role === "admin" || member.role === "supervisor";
    const rows = await sql<{
      id: string;
      user_id: string;
      name: string;
      clocked_in_at: unknown;
      clocked_out_at: unknown | null;
    }>`
      select tc.id, tc.user_id, coalesce(u.name, tc.user_id) as name, tc.clocked_in_at, tc.clocked_out_at
      from time_clock tc
      left join "user" u on u.id = tc.user_id
      where tc.store_id = ${store.id}
        and tc.clocked_in_at >= now() - (${String(days)} || ' days')::interval
        and (${staffView} or tc.user_id = ${member.userId})
      order by tc.clocked_in_at desc
      limit 200
    `;
    const now = new Date();
    return rows.map((r) => {
      const inAt = new Date(String(r.clocked_in_at));
      const outAt = r.clocked_out_at ? new Date(String(r.clocked_out_at)) : null;
      return {
        id: r.id,
        userId: r.user_id,
        name: r.name,
        clockedInAt: String(r.clocked_in_at),
        clockedOutAt: r.clocked_out_at ? String(r.clocked_out_at) : null,
        hours: Math.round(clockHours(inAt, outAt, now) * 100) / 100,
        open: !outAt,
      };
    });
  });
