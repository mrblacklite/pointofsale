-- Card charges, tips, and receipt delivery.

alter table sales
  add column if not exists tip_cents integer not null default 0,
  add column if not exists customer_email text,
  add column if not exists customer_phone text;

alter table payments
  add column if not exists processor text,
  add column if not exists processor_ref text,
  add column if not exists last4 text,
  add column if not exists status text not null default 'captured';

create table if not exists receipt_deliveries (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  sale_id text not null references sales(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  destination text not null,
  status text not null check (status in ('queued', 'sent', 'simulated', 'failed')),
  provider text,
  provider_ref text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists receipt_deliveries_sale_idx on receipt_deliveries (sale_id, created_at desc);
