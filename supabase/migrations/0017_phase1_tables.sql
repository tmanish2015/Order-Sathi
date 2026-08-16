-- Phase 1 continued: run this AFTER 0016 (separate transaction, so the new
-- order_status enum values from 0016 are safe to use here and in the app).

-- ── Orders: fields the workflow/UI needs that don't exist yet ───────────
alter table orders add column customer_name text;
alter table orders add column payment_type text; -- 'COD' | 'Prepaid' - free text, Amazon's own vocabulary varies

-- ── order_line_items: workflow counters (see architecture note in 0016) ─
alter table order_line_items add column allocated_qty int not null default 0;
alter table order_line_items add column picked_qty int not null default 0;
alter table order_line_items add column packed_qty int not null default 0;
alter table order_line_items add column shipped_qty int not null default 0;
alter table order_line_items add column warehouse_id uuid references warehouses(id); -- warehouse this line was allocated from

-- ── Order status audit trail ─────────────────────────────────────────────
create table order_status_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id) on delete cascade,
  previous_status order_status,
  new_status order_status not null,
  reason text,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);

create index on order_status_history (organization_id, order_id);

create function log_order_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.order_status is distinct from new.order_status then
    insert into order_status_history (organization_id, order_id, previous_status, new_status, changed_by)
    values (new.organization_id, new.id, old.order_status, new.order_status, auth.uid());
  elsif tg_op = 'INSERT' then
    insert into order_status_history (organization_id, order_id, previous_status, new_status, changed_by)
    values (new.organization_id, new.id, null, new.order_status, auth.uid());
  end if;
  return new;
end;
$$;

create trigger trg_order_status_history after insert or update on orders
  for each row execute function log_order_status_change();

alter table order_status_history enable row level security;
create policy order_status_history_read on order_status_history for select
  using (organization_id = auth_org_id());
revoke insert, update, delete on order_status_history from authenticated, anon;

-- ── GRN / Inward ──────────────────────────────────────────────────────────
create type grn_status as enum ('draft', 'confirmed');

alter table organizations add column grn_seq int not null default 0;

create function next_grn_number() returns text
language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  seq int;
  yr text;
begin
  org := auth_org_id();
  if org is null then raise exception 'not authorized'; end if;
  update organizations set grn_seq = grn_seq + 1 where id = org returning grn_seq into seq;
  yr := to_char(now(), 'YYYY');
  return 'GRN-' || yr || '-' || lpad(seq::text, 5, '0');
end;
$$;

revoke execute on function next_grn_number() from public, anon;
grant execute on function next_grn_number() to authenticated;

create table grns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  grn_number text not null,
  warehouse_id uuid not null references warehouses(id),
  supplier_name text,
  reference_po text,
  status grn_status not null default 'draft',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

create unique index grns_org_number_key on grns (organization_id, grn_number);

create table grn_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  grn_id uuid not null references grns(id) on delete cascade,
  sku_id uuid not null references skus(id),
  ordered_qty int not null default 0,
  received_qty int not null default 0,
  accepted_qty int not null default 0,
  rejected_qty int not null default 0,
  reason text,
  batch text,
  expiry date,
  remarks text,
  created_at timestamptz not null default now()
);

create index on grn_line_items (organization_id, grn_id);

alter table grns enable row level security;
alter table grn_line_items enable row level security;

create policy grns_read on grns for select using (organization_id = auth_org_id());
create policy grns_write on grns for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
create policy grn_line_items_read on grn_line_items for select using (organization_id = auth_org_id());
create policy grn_line_items_write on grn_line_items for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

-- ── inventory_ledger: generic reference (GRN/picklist/shipment/etc), not
--    just order_id, so the movement ledger can point at whatever caused it
alter table inventory_ledger add column reference_type text;
alter table inventory_ledger add column reference_id uuid;

-- ── Picklist workflow: created -> assigned -> picking -> picked -> completed
alter type picklist_status rename value 'open' to 'created';
alter type picklist_status add value 'assigned' after 'created';
alter type picklist_status add value 'picking' after 'assigned';
alter type picklist_status add value 'picked' after 'picking';

alter table picklists add column assigned_to uuid references profiles(id);
-- Which orders contributed to this aggregated SKU line, so a partial pick
-- can be distributed back to specific order_line_items (FIFO by order date).
alter table picklist_items add column order_ids uuid[] not null default '{}';
alter table picklist_items add column picked_qty int not null default 0;

-- ── Packing ───────────────────────────────────────────────────────────────
create table packages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  package_count int not null default 1,
  weight_kg numeric(8,3),
  length_cm numeric(8,2),
  width_cm numeric(8,2),
  height_cm numeric(8,2),
  packed_by uuid references profiles(id),
  packed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index packages_order_key on packages (order_id);

alter table packages enable row level security;
create policy packages_read on packages for select using (organization_id = auth_org_id());
create policy packages_write on packages for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create trigger trg_audit_packages after insert or update or delete on packages
  for each row execute function log_audit_event();
