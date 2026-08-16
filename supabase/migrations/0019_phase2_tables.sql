-- Phase 2 continued: run AFTER 0018.

-- ── Channel master: config/status, not just a name ──────────────────────
alter table channels add column sync_status text not null default 'idle'; -- idle | running | success | partial | failed
alter table channels add column last_success_at timestamptz;
alter table channels add column last_failure_at timestamptz;
alter table channels add column sync_direction text not null default 'inbound'; -- inbound | outbound | both
alter table channels add column enabled boolean not null default true;
alter table channels add column config jsonb not null default '{}';

-- ── SKU / Channel mapping ─────────────────────────────────────────────────
create table sku_channel_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sku_id uuid not null references skus(id) on delete cascade,
  channel_id uuid not null references channels(id) on delete cascade,
  channel_sku text not null,
  channel_product_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index sku_channel_mappings_channel_sku_key on sku_channel_mappings (channel_id, channel_sku);
create unique index sku_channel_mappings_sku_channel_key on sku_channel_mappings (sku_id, channel_id);

alter table sku_channel_mappings enable row level security;
create policy sku_channel_mappings_read on sku_channel_mappings for select
  using (organization_id = auth_org_id());
create policy sku_channel_mappings_write on sku_channel_mappings for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

-- Orders whose SKU couldn't be matched to an internal SKU during import -
-- surfaced as an exception instead of silently dropping the line.
create table unmapped_sku_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  channel_id uuid not null references channels(id),
  channel_order_id text not null,
  channel_sku text not null,
  raw_payload jsonb,
  resolved boolean not null default false,
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index on unmapped_sku_exceptions (organization_id, resolved);

alter table unmapped_sku_exceptions enable row level security;
create policy unmapped_sku_exceptions_read on unmapped_sku_exceptions for select
  using (organization_id = auth_org_id());
create policy unmapped_sku_exceptions_write on unmapped_sku_exceptions for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

-- ── Inventory publish config (what gets pushed to the channel) ──────────
alter table skus add column max_listed_stock int;

-- ── Courier master ────────────────────────────────────────────────────────
create table couriers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  service_type text,
  cod_support boolean not null default false,
  api_status text not null default 'not_configured', -- not_configured | configured | live
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index couriers_org_name_key on couriers (organization_id, name);

alter table couriers enable row level security;
create policy couriers_read on couriers for select using (organization_id = auth_org_id());
create policy couriers_write on couriers for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

-- ── Shipment tracking events (append-only, never overwritten) ───────────
create table shipment_tracking_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  shipment_id uuid not null references shipments(id) on delete cascade,
  status shipment_status not null,
  event_time timestamptz not null default now(),
  location text,
  remarks text,
  created_at timestamptz not null default now()
);

create index on shipment_tracking_events (organization_id, shipment_id, event_time);

alter table shipment_tracking_events enable row level security;
create policy shipment_tracking_events_read on shipment_tracking_events for select
  using (organization_id = auth_org_id());
create policy shipment_tracking_events_write on shipment_tracking_events for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
revoke update, delete on shipment_tracking_events from authenticated, anon;

-- ── NDR ───────────────────────────────────────────────────────────────────
create table ndr_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  shipment_id uuid references shipments(id),
  awb_number text not null,
  ndr_date timestamptz not null default now(),
  reason text,
  attempt_number int not null default 1,
  contact_status text, -- not_contacted | contacted | unreachable
  action_taken text,
  next_attempt_date date,
  outcome text, -- delivered | rto | null (still open)
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on ndr_records (organization_id, outcome);

alter table ndr_records enable row level security;
create policy ndr_records_read on ndr_records for select using (organization_id = auth_org_id());
create policy ndr_records_write on ndr_records for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create trigger trg_audit_ndr_records after insert or update or delete on ndr_records
  for each row execute function log_audit_event();

-- ── Return QC outcome ─────────────────────────────────────────────────────
alter table order_returns add column qc_outcome return_qc_outcome;
alter table order_returns add column qc_notes text;
alter table order_returns add column qc_by uuid references profiles(id);
alter table order_returns add column qc_at timestamptz;

-- ── Settlement import (extends the existing MTR reconciliation model) ───
create table settlement_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  channel_id uuid not null references channels(id),
  settlement_id text not null,
  order_id uuid references orders(id),
  channel_order_id text not null,
  transaction_id text,
  gross_amount numeric(12,2) not null default 0,
  fees numeric(12,2) not null default 0,
  taxes numeric(12,2) not null default 0,
  refunds numeric(12,2) not null default 0,
  adjustments numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  settlement_date date,
  match_status reconciliation_status not null default 'pending_review',
  match_note text,
  created_at timestamptz not null default now()
);

create index on settlement_transactions (organization_id, match_status);
create index on settlement_transactions (organization_id, channel_order_id);

alter table settlement_transactions enable row level security;
create policy settlement_transactions_read on settlement_transactions for select
  using (organization_id = auth_org_id());
create policy settlement_transactions_write on settlement_transactions for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));

-- ── Sync logs: counts, not just a message ────────────────────────────────
alter table sync_logs add column sync_type text; -- order_import | inventory_push | mtr_import | settlement_import | ...
alter table sync_logs add column records_processed int not null default 0;
alter table sync_logs add column records_successful int not null default 0;
alter table sync_logs add column records_failed int not null default 0;
