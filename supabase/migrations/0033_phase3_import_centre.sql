-- Phase 3: import centre. Logs completed import batches so there's a
-- visible history (what was imported, when, by whom, how many rows
-- succeeded/failed) - the actual row-level work happens client-side
-- (upsert skus / insert inventory_ledger), same as every other bulk
-- import in the app (MTR, bank statement, settlement).

create type import_type as enum ('products', 'opening_stock');

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  import_type import_type not null,
  filename text not null,
  row_count int not null default 0,
  success_count int not null default 0,
  error_count int not null default 0,
  imported_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index on import_batches (organization_id, import_type, created_at);

alter table import_batches enable row level security;

create policy import_batches_read on import_batches for select using (organization_id = auth_org_id());
create policy import_batches_write on import_batches for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
