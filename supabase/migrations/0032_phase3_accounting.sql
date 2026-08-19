-- Phase 3: accounting integration foundation (Tally, BUSY). Architecture
-- only - connector config + field-mapping layer, same honest pattern as
-- non-Amazon channels in Integrations: a connection record exists, but
-- there is no live sync connector built here. Never claim live without
-- actual credentials and a tested connection.

create type accounting_provider as enum ('tally', 'busy');
create type accounting_mapping_type as enum ('sales', 'purchase', 'customer', 'supplier', 'tax', 'credit_note', 'debit_note', 'payment');

create table accounting_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  provider accounting_provider not null,
  display_name text not null,
  config jsonb not null default '{}', -- company name, ledger group defaults, host/port for Tally's XML gateway, etc.
  status text not null default 'not_configured', -- not_configured | configured | connected | error
  sync_status text not null default 'idle', -- idle | running | success | partial | failed
  last_success_at timestamptz,
  last_failure_at timestamptz,
  enabled boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create unique index accounting_connections_org_provider_key on accounting_connections (organization_id, provider);

create table accounting_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  connection_id uuid not null references accounting_connections(id) on delete cascade,
  mapping_type accounting_mapping_type not null,
  internal_field text not null, -- e.g. 'gst_invoices', 'skus.category', 'channels.<id>'
  external_ledger_name text not null, -- the Tally/BUSY ledger or voucher type this maps to
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index on accounting_mappings (organization_id, connection_id);

alter table accounting_connections enable row level security;
alter table accounting_mappings enable row level security;

create policy accounting_connections_read on accounting_connections for select using (organization_id = auth_org_id());
create policy accounting_connections_write on accounting_connections for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));
create policy accounting_mappings_read on accounting_mappings for select using (organization_id = auth_org_id());
create policy accounting_mappings_write on accounting_mappings for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));
