-- Bundle/combo: a bundle SKU doesn't hold its own stock - selling one
-- deducts each component's stock instead. One level deep only; a
-- component that is itself a bundle is treated as a plain stocked item
-- (not expanded further) - documented limitation, not a bug.

alter table skus add column is_bundle boolean not null default false;

create table bundle_components (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  bundle_sku_id uuid not null references skus(id) on delete cascade,
  component_sku_id uuid not null references skus(id),
  quantity int not null check (quantity > 0),
  created_at timestamptz not null default now(),
  check (bundle_sku_id <> component_sku_id)
);

create unique index bundle_components_pair_key on bundle_components (bundle_sku_id, component_sku_id);

alter table bundle_components enable row level security;

create policy bundle_components_read on bundle_components for select
  using (organization_id = auth_org_id());
create policy bundle_components_write on bundle_components for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
