-- Customers, held tickets, returns, shifts, discount windows, unique barcodes.

create table if not exists customers (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  loyalty_points integer not null default 0,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists customers_store_idx on customers (store_id, name);

alter table sales add column if not exists customer_id text references customers(id) on delete set null;
alter table sales add column if not exists held boolean not null default false;
alter table sales add column if not exists return_of_sale_id text references sales(id) on delete set null;

create unique index if not exists products_store_barcode_unique
  on products (store_id, barcode) where barcode is not null and barcode <> '';

alter table discounts add column if not exists starts_at timestamptz;
alter table discounts add column if not exists ends_at timestamptz;
alter table discounts add column if not exists max_redemptions integer;
alter table gift_cards add column if not exists expires_at timestamptz;

create table if not exists held_tickets (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  payload jsonb not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists shifts (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  user_id text not null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cents integer not null default 0,
  closing_cents integer,
  declared_cents integer,
  note text
);
create index if not exists shifts_store_open_idx on shifts (store_id, closed_at);

create table if not exists time_clock (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  user_id text not null,
  clocked_in_at timestamptz not null default now(),
  clocked_out_at timestamptz
);
