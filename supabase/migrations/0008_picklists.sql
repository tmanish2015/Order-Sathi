-- Picklists: a snapshot of what needs picking, aggregated by SKU across
-- every currently-pending order, generated on demand rather than live -
-- so what's on paper in the warehouse doesn't shift while someone's
-- walking the aisles with it.

create type picklist_status as enum ('open', 'completed');

create table picklists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  status picklist_status not null default 'open',
  order_count int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table picklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  picklist_id uuid not null references picklists(id) on delete cascade,
  sku_id uuid not null references skus(id),
  total_quantity int not null,
  picked boolean not null default false,
  created_at timestamptz not null default now()
);

create index on picklist_items (organization_id, picklist_id);

alter table picklists enable row level security;
alter table picklist_items enable row level security;

create policy picklists_read on picklists for select
  using (organization_id = auth_org_id());
create policy picklists_write on picklists for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create policy picklist_items_read on picklist_items for select
  using (organization_id = auth_org_id());
create policy picklist_items_write on picklist_items for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
