-- Single store: later sign-ups join as customers, not new owners.

alter table store_members drop constraint if exists store_members_role_check;
alter table store_members add constraint store_members_role_check
  check (role in ('admin', 'supervisor', 'cashier', 'stocker', 'customer'));

alter table customers add column if not exists user_id text;
create unique index if not exists customers_store_user_idx
  on customers (store_id, user_id) where user_id is not null;
