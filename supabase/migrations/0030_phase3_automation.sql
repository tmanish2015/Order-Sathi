-- Phase 3: automation rule engine foundation. Kept deliberately small:
-- rule definitions are stored generically (trigger type + jsonb condition/
-- action), but only the inventory_low trigger is actually evaluated by
-- the app (read-only, on the Automation page) in this pass - wiring live
-- evaluation into every existing mutation path (order creation, shipment
-- status change, return QC) is a much bigger, riskier change deferred to
-- a later pass rather than touching those already-stable flows now.

create type automation_trigger as enum ('inventory_low', 'order_value_channel', 'shipping_cod_pincode', 'return_qc_resalable');

create table automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  trigger_type automation_trigger not null,
  conditions jsonb not null default '{}',
  actions jsonb not null default '{}',
  active boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index on automation_rules (organization_id, trigger_type, active);

alter table automation_rules enable row level security;

create policy automation_rules_read on automation_rules for select using (organization_id = auth_org_id());
create policy automation_rules_write on automation_rules for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
