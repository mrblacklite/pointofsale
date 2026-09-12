alter table products add column if not exists sold_by text not null default 'each';
alter table products add column if not exists image_url text;

create table if not exists product_options (
  id text primary key,
  store_id text not null references stores(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  kind text not null check (kind in ('variant', 'modifier')),
  name text not null,
  price_delta_cents integer not null default 0
);
create index if not exists product_options_product_idx on product_options (product_id);
