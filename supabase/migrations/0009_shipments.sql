-- Shipping/3PL: manual AWB entry works today (no courier account needed).
-- courier-sync edge function (deployed separately) is the future real
-- integration point, same "needs the seller's own API creds" pattern as
-- sp-api-sync.

create type shipment_status as enum ('booked', 'in_transit', 'delivered', 'rto', 'failed');

create table shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  courier_name text not null,
  awb_number text not null,
  status shipment_status not null default 'booked',
  shipped_at timestamptz not null default now(),
  tracking_url text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index shipments_order_key on shipments (order_id);
create index on shipments (organization_id, status);

alter table shipments enable row level security;

create policy shipments_read on shipments for select
  using (organization_id = auth_org_id());
create policy shipments_write on shipments for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create trigger trg_audit_shipments after insert or update or delete on shipments
  for each row execute function log_audit_event();
