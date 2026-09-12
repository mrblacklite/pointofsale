create table if not exists suppliers (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  email text,
  phone text,
  note text,
  created_at timestamptz not null default now()
);
create index if not exists suppliers_store_idx on suppliers (store_id, name);

create table if not exists purchase_orders (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  supplier_id text not null references suppliers(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'received', 'cancelled')),
  note text,
  created_by text not null,
  created_at timestamptz not null default now(),
  received_at timestamptz
);
create index if not exists purchase_orders_store_idx on purchase_orders (store_id, created_at desc);

create table if not exists purchase_order_lines (
  id text primary key,
  po_id text not null references purchase_orders(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  product_id text not null references products(id) on delete restrict,
  quantity integer not null,
  received_qty integer not null default 0,
  cost_cents integer not null default 0
);
