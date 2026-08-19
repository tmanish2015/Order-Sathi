-- Phase 3: notification centre. One row per exception *category* per org
-- (not per individual record - matches how the Dashboard already
-- summarizes them), upserted on visit from the same live exception
-- sources Dashboard already computes. Resolved categories are deleted
-- rather than kept around stale.

create type notification_priority as enum ('low', 'medium', 'high', 'critical');

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  type text not null, -- stock_shortage | sla_breach | unmapped_sku | ndr | rto | reconciliation_mismatch | failed_integration | failed_sync
  priority notification_priority not null default 'medium',
  message text not null,
  action_href text,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index notifications_org_type_key on notifications (organization_id, type);
create index on notifications (organization_id, read);

alter table notifications enable row level security;

create policy notifications_read on notifications for select using (organization_id = auth_org_id());
create policy notifications_write on notifications for all
  using (organization_id = auth_org_id());
