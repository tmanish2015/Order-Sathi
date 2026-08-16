-- Rack/bin: subdivides a warehouse into named locations. bin_id on
-- inventory_ledger is optional - tagging a movement with a bin doesn't
-- change stock math (that's still warehouse-level), it's purely a "where
-- physically" note, so nothing that already writes to the ledger without
-- a bin breaks.

create table bins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  warehouse_id uuid not null references warehouses(id),
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index bins_warehouse_code_key on bins (warehouse_id, code);

alter table inventory_ledger add column bin_id uuid references bins(id);

create index on inventory_ledger (organization_id, bin_id);

alter table bins enable row level security;

create policy bins_read on bins for select
  using (organization_id = auth_org_id());
create policy bins_write on bins for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
