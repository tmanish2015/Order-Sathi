-- Phase 3: pricing management. Append-only price history - a new price is
-- always a new row, never an update, so "what did we charge on date X"
-- stays answerable. channel_id null = base/internal price; warehouse_id
-- null = applies to all warehouses. Current price for any scope is simply
-- the latest row (by effective_from) matching that scope.
--
-- Promotions/discounts are a separate concern (different Phase 3 task) -
-- this table is list/selling price only, not promotional pricing.
-- Customer-specific pricing is out of scope: there is no customer master
-- table yet (Customer Intelligence is derived from order history only),
-- so a real customer_id FK isn't possible without inventing one.

create table sku_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sku_id uuid not null references skus(id),
  channel_id uuid references channels(id),
  warehouse_id uuid references warehouses(id),
  price numeric(12,2) not null,
  min_selling_price numeric(12,2),
  effective_from date not null default current_date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index on sku_prices (organization_id, sku_id, channel_id, effective_from desc);

alter table sku_prices enable row level security;

create policy sku_prices_read on sku_prices for select using (organization_id = auth_org_id());
create policy sku_prices_write on sku_prices for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
-- Append-only: no update/delete, so price history can never be silently rewritten.
revoke update, delete on sku_prices from authenticated, anon;
