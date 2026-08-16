-- Multi-warehouse: every stock movement now belongs to a warehouse, not
-- just an org. Every org gets a "Main Warehouse" seeded so existing ledger
-- rows have somewhere to backfill into without a manual data-fix step.

create table warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  address text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index warehouses_org_name_key on warehouses (organization_id, name);

-- one default warehouse per existing org, so the backfill below has a target
insert into warehouses (organization_id, name, is_default)
select id, 'Main Warehouse', true from organizations;

alter table inventory_ledger add column warehouse_id uuid references warehouses(id);

update inventory_ledger il set warehouse_id = (
  select w.id from warehouses w where w.organization_id = il.organization_id and w.is_default limit 1
);

alter table inventory_ledger alter column warehouse_id set not null;

create index on inventory_ledger (organization_id, warehouse_id);

alter table warehouses enable row level security;

create policy warehouses_read on warehouses for select
  using (organization_id = auth_org_id());
create policy warehouses_write on warehouses for all
  using (organization_id = auth_org_id() and auth_role() = 'admin');
