-- Till POS schema. Money is integer cents. IDs are text UUIDs.

create table if not exists stores (
  id text primary key,
  owner_user_id text not null,
  name text not null,
  legal_name text,
  address text,
  phone text,
  tax_rate_bps integer not null default 825,
  currency text not null default 'USD',
  receipt_footer text,
  created_at timestamptz not null default now()
);

create table if not exists store_members (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  user_id text not null,
  email text not null,
  display_name text not null,
  role text not null check (role in ('admin', 'supervisor', 'cashier', 'stocker')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, user_id)
);

create unique index if not exists store_members_user_id_idx on store_members (user_id);
create index if not exists store_members_store_id_idx on store_members (store_id);

create table if not exists staff_invites (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  email text not null,
  display_name text not null,
  role text not null check (role in ('admin', 'supervisor', 'cashier', 'stocker')),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (store_id, email)
);

create table if not exists categories (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists categories_store_id_idx on categories (store_id);

create table if not exists products (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  category_id text references categories(id) on delete set null,
  sku text not null,
  barcode text,
  name text not null,
  description text,
  price_cents integer not null,
  cost_cents integer not null default 0,
  tax_exempt boolean not null default false,
  track_inventory boolean not null default true,
  quantity integer not null default 0,
  reorder_point integer not null default 5,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, sku)
);
create index if not exists products_store_barcode_idx on products (store_id, barcode);
create index if not exists products_store_active_idx on products (store_id, active);

create table if not exists inventory_movements (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  delta integer not null,
  reason text not null,
  note text,
  sale_id text,
  user_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists inventory_movements_store_idx on inventory_movements (store_id, created_at desc);

create table if not exists discounts (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  code text not null,
  name text not null,
  type text not null check (type in ('percent', 'fixed')),
  value integer not null,
  min_subtotal_cents integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (store_id, code)
);

create table if not exists gift_cards (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  code text not null,
  initial_cents integer not null,
  balance_cents integer not null,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  unique (store_id, code)
);

create table if not exists gift_card_ledger (
  id text primary key,
  gift_card_id text not null references gift_cards(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  delta_cents integer not null,
  reason text not null,
  sale_id text,
  user_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists sales (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  receipt_number integer not null,
  cashier_user_id text not null,
  cashier_name text not null,
  status text not null default 'completed' check (status in ('completed', 'voided')),
  discount_code text,
  discount_cents integer not null default 0,
  subtotal_cents integer not null,
  tax_cents integer not null,
  total_cents integer not null,
  tendered_cents integer not null default 0,
  change_cents integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by text,
  unique (store_id, receipt_number)
);
create index if not exists sales_store_created_idx on sales (store_id, created_at desc);

create table if not exists sale_items (
  id text primary key,
  sale_id text not null references sales(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  product_id text,
  sku text not null,
  name text not null,
  quantity integer not null,
  unit_price_cents integer not null,
  tax_cents integer not null default 0,
  line_total_cents integer not null
);
create index if not exists sale_items_sale_idx on sale_items (sale_id);

create table if not exists payments (
  id text primary key,
  sale_id text not null references sales(id) on delete cascade,
  store_id text not null references stores(id) on delete cascade,
  method text not null check (method in ('cash', 'card', 'gift_card')),
  amount_cents integer not null,
  gift_card_code text,
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  last_used_at timestamptz,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked boolean not null default false
);
create index if not exists api_keys_store_idx on api_keys (store_id);

create table if not exists store_counters (
  store_id text primary key references stores(id) on delete cascade,
  next_receipt integer not null default 1
);
