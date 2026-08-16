-- Manifest: the handover record you give a courier for pickup — which
-- shipments are in this batch. shipments.manifest_id lets you tell "not
-- handed over yet" from "already on a manifest" at a glance.

create table manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  courier_name text not null,
  shipment_count int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

alter table shipments add column manifest_id uuid references manifests(id);

create index on shipments (organization_id, manifest_id);

alter table manifests enable row level security;

create policy manifests_read on manifests for select
  using (organization_id = auth_org_id());
create policy manifests_write on manifests for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
