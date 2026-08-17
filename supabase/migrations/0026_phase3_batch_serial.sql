-- Phase 3: batch/serial/expiry tracking. Configurable per SKU
-- (tracking_mode), never forced - most SKUs stay 'none'.
--
-- grn_line_items.batch/expiry already existed (Phase 1) for capturing
-- what arrived on a GRN. This adds a persistent batches table so expiry
-- can be tracked/alerted on after the GRN is confirmed, and a serials
-- table for unit-level tracking. Neither table is a second stock
-- ledger: inventory_ledger stays the sole source of truth for
-- quantities. batches.received_qty is a receipt record for expiry
-- visibility (FEFO ordering, expiring-soon/expired flags), not a
-- consumption-tracked balance - precise remaining-per-batch would need
-- FIFO-matched consumption, out of scope here per the "keep it simple"
-- instruction.

create type sku_tracking_mode as enum ('none', 'batch', 'serial');
create type serial_status as enum ('in_stock', 'allocated', 'shipped', 'returned', 'damaged');

alter table skus add column tracking_mode sku_tracking_mode not null default 'none';

-- Raw newline-separated serial numbers captured at draft time, materialized
-- into the serials table only on GRN confirm (same draft-then-confirm
-- timing as when stock itself actually posts). manufacturing_date pairs
-- with the pre-existing batch/expiry columns for batch-tracked SKUs.
alter table grn_line_items add column serials text;
alter table grn_line_items add column manufacturing_date date;

create table batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sku_id uuid not null references skus(id),
  warehouse_id uuid not null references warehouses(id),
  batch_number text not null,
  manufacturing_date date,
  expiry_date date,
  received_qty int not null default 0,
  grn_line_item_id uuid references grn_line_items(id),
  created_at timestamptz not null default now()
);

create index on batches (organization_id, sku_id);
create index on batches (organization_id, expiry_date) where expiry_date is not null;

create table serials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sku_id uuid not null references skus(id),
  warehouse_id uuid not null references warehouses(id),
  serial_number text not null,
  status serial_status not null default 'in_stock',
  order_id uuid references orders(id),
  grn_line_item_id uuid references grn_line_items(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index serials_org_serial_key on serials (organization_id, serial_number);
create index on serials (organization_id, sku_id);

alter table batches enable row level security;
alter table serials enable row level security;

create policy batches_read on batches for select using (organization_id = auth_org_id());
create policy batches_write on batches for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
create policy serials_read on serials for select using (organization_id = auth_org_id());
create policy serials_write on serials for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create trigger serials_audit after insert or update or delete on serials
  for each row execute function log_audit_event();
