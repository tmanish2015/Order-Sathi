-- Phase 3: promotions & discounts. Order Sathi is an OMS, not a
-- storefront - there's no live cart/checkout to auto-apply a promo code
-- to. This is a promotion catalog/reference: what's currently running,
-- for planning and reporting, not an auto-applied discount engine.

create type promotion_type as enum ('percentage', 'fixed', 'bxgy');

create table promotions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  promotion_type promotion_type not null,
  discount_value numeric(12,2), -- % or flat amount, meaning depends on promotion_type; null for bxgy
  buy_qty int, -- bxgy only
  get_qty int, -- bxgy only
  sku_id uuid references skus(id), -- null = applies to the whole category/channel scope below
  category text,
  channel_id uuid references channels(id), -- null = all channels
  min_order_value numeric(12,2),
  start_date date not null,
  end_date date not null,
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index on promotions (organization_id, active, start_date, end_date);

alter table promotions enable row level security;

create policy promotions_read on promotions for select using (organization_id = auth_org_id());
create policy promotions_write on promotions for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
