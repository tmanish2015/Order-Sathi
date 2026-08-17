-- Phase 3: cycle count / stock audit.
-- Scheduled -> Counting -> Pending Approval -> Approved (posts variance to
-- the ledger as a manual_adjustment) or Rejected (no stock movement).
-- system_qty is snapshotted at creation time so a slow count doesn't drift
-- against a moving ledger; physical_qty is entered by the counter.

create type cycle_count_status as enum ('scheduled', 'counting', 'pending_approval', 'approved', 'rejected');

alter table organizations add column cycle_count_seq int not null default 0;

create function next_cycle_count_number() returns text
language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  seq int;
  yr text;
begin
  org := auth_org_id();
  if org is null then raise exception 'not authorized'; end if;
  update organizations set cycle_count_seq = cycle_count_seq + 1 where id = org returning cycle_count_seq into seq;
  yr := to_char(now(), 'YYYY');
  return 'CC-' || yr || '-' || lpad(seq::text, 5, '0');
end;
$$;

revoke execute on function next_cycle_count_number() from public, anon;
grant execute on function next_cycle_count_number() to authenticated;

create table cycle_counts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  count_number text not null,
  warehouse_id uuid not null references warehouses(id),
  bin_id uuid references bins(id),
  status cycle_count_status not null default 'scheduled',
  scheduled_date date,
  notes text,
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index cycle_counts_org_number_key on cycle_counts (organization_id, count_number);

create table cycle_count_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  cycle_count_id uuid not null references cycle_counts(id) on delete cascade,
  sku_id uuid not null references skus(id),
  system_qty int not null default 0,
  physical_qty int,
  created_at timestamptz not null default now()
);

create index on cycle_count_items (organization_id, cycle_count_id);

alter table cycle_counts enable row level security;
alter table cycle_count_items enable row level security;

create policy cycle_counts_read on cycle_counts for select using (organization_id = auth_org_id());
create policy cycle_counts_write on cycle_counts for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
create policy cycle_count_items_read on cycle_count_items for select using (organization_id = auth_org_id());
create policy cycle_count_items_write on cycle_count_items for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create trigger cycle_counts_audit after insert or update or delete on cycle_counts
  for each row execute function log_audit_event();
