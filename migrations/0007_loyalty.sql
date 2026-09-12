alter table sales add column if not exists loyalty_points_earned integer not null default 0;
alter table sales add column if not exists loyalty_points_redeemed integer not null default 0;
