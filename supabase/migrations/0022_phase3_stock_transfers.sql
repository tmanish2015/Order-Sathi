-- Phase 3: stock transfer management.
-- Workflow: requested -> approved -> dispatched -> in_transit -> received
-- (or rejected before dispatch). Ledger only moves stock on dispatch
-- (transfer_out from source) and receive (transfer_in at destination) -
-- same additive-ledger pattern as GRN, never a direct stock edit.

alter table organizations add column transfer_seq int not null default 0;

create function next_transfer_number() returns text
language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  seq int;
  yr text;
begin
  org := auth_org_id();
  if org is null then raise exception 'not authorized'; end if;
  update organizations set transfer_seq = transfer_seq + 1 where id = org returning transfer_seq into seq;
  yr := to_char(now(), 'YYYY');
  return 'TRF-' || yr || '-' || lpad(seq::text, 5, '0');
end;
$$;

revoke execute on function next_transfer_number() from public, anon;
grant execute on function next_transfer_number() to authenticated;

create table stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  transfer_number text not null,
  source_warehouse_id uuid not null references warehouses(id),
  destination_warehouse_id uuid not null references warehouses(id),
  status transfer_status not null default 'requested',
  notes text,
  requested_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  dispatched_by uuid references profiles(id),
  dispatched_at timestamptz,
  received_by uuid references profiles(id),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  check (source_warehouse_id <> destination_warehouse_id)
);

create unique index stock_transfers_org_number_key on stock_transfers (organization_id, transfer_number);

create table stock_transfer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  transfer_id uuid not null references stock_transfers(id) on delete cascade,
  sku_id uuid not null references skus(id),
  requested_qty int not null default 0,
  dispatched_qty int not null default 0,
  received_qty int not null default 0,
  damaged_qty int not null default 0,
  created_at timestamptz not null default now()
);

create index on stock_transfer_items (organization_id, transfer_id);

alter table stock_transfers enable row level security;
alter table stock_transfer_items enable row level security;

create policy stock_transfers_read on stock_transfers for select using (organization_id = auth_org_id());
create policy stock_transfers_write on stock_transfers for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
create policy stock_transfer_items_read on stock_transfer_items for select using (organization_id = auth_org_id());
create policy stock_transfer_items_write on stock_transfer_items for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create trigger stock_transfers_audit after insert or update or delete on stock_transfers
  for each row execute function log_audit_event();
