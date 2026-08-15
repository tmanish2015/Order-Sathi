-- Order Sathi: initial schema
-- Amazon-only OMS. Multi-tenant ready (organization_id on every table).

create extension if not exists "pgcrypto";

-- ── Organizations & Users ──────────────────────────────────────────────

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  gst_number text,
  created_at timestamptz not null default now()
);

create type user_role as enum ('admin', 'ops', 'finance');
create type user_status as enum ('pending', 'active');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  full_name text,
  email text not null,
  role user_role not null default 'ops',
  status user_status not null default 'pending',
  created_at timestamptz not null default now()
);

create unique index profiles_email_key on profiles (email);

-- seed default org (rename via Supabase dashboard once seller signs up)
insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Order Sathi Seller');

-- ── Helper functions (used by RLS policies) ────────────────────────────
-- Return null for anyone not yet approved, which makes every org-scoped
-- RLS policy deny access automatically.

create function auth_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid() and status = 'active';
$$;

create function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active';
$$;

-- ── Signup: auto-create profile row, land pending until admin approves ──

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target_org uuid;
begin
  select id into target_org from organizations order by created_at limit 1;
  insert into public.profiles (id, organization_id, email, full_name, role)
  values (new.id, target_org, new.email, new.raw_user_meta_data->>'full_name', 'ops');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

create function approve_team_member(p_user_id uuid, p_role user_role)
returns void
language plpgsql security definer set search_path = public as $$
declare
  caller_role user_role;
  caller_org uuid;
  target_org uuid;
begin
  select role, organization_id into caller_role, caller_org
  from profiles where id = auth.uid() and status = 'active';

  if caller_role is distinct from 'admin' then
    raise exception 'only admins can approve team members';
  end if;

  select organization_id into target_org from profiles where id = p_user_id;
  if target_org is null or target_org is distinct from caller_org then
    raise exception 'user not found in your organization';
  end if;

  update profiles set status = 'active', role = p_role where id = p_user_id;
end;
$$;

revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function auth_org_id() from public, anon;
revoke execute on function auth_role() from public, anon;
grant execute on function auth_org_id() to authenticated;
grant execute on function auth_role() to authenticated;
revoke execute on function approve_team_member(uuid, user_role) from public, anon;
grant execute on function approve_team_member(uuid, user_role) to authenticated;

revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

-- ── Sales Channels (Amazon only for now) ─────────────────────────────────

create table channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  marketplace_id text not null,
  seller_id text not null,
  display_name text not null,
  sp_api_refresh_token_secret_id uuid, -- opaque ref into Supabase Vault, never plaintext
  connected_by uuid references profiles(id),
  connected_at timestamptz,
  status text not null default 'disconnected', -- disconnected | connected | error
  created_at timestamptz not null default now()
);

-- ── Inventory ─────────────────────────────────────────────────────────────

create table skus (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sku text not null,
  asin text,
  title text not null,
  hsn_code text,
  gst_rate numeric(5,2) not null default 18.00,
  buffer_stock int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index skus_org_sku_key on skus (organization_id, sku);

-- append-only ledger; current stock = sum(quantity_delta) per sku, never
-- mutated in place, so every stock change has a traceable reason.
create type inventory_movement_type as enum ('order_deduction', 'manual_adjustment', 'restock', 'return');

create table inventory_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  sku_id uuid not null references skus(id) on delete cascade,
  movement_type inventory_movement_type not null,
  quantity_delta int not null,
  order_id uuid, -- set when movement_type = order_deduction (fk added after orders table)
  note text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index on inventory_ledger (organization_id, sku_id);

-- ── Orders ────────────────────────────────────────────────────────────────

create type order_status as enum ('pending', 'shipped', 'delivered', 'cancelled', 'returned');

create table orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  channel_id uuid not null references channels(id),
  amazon_order_id text not null,
  order_status order_status not null default 'pending',
  order_date timestamptz not null,
  buyer_state text, -- for GST place-of-supply (CGST+SGST vs IGST)
  ship_state text,
  gross_amount numeric(12,2) not null,
  raw_payload jsonb, -- verbatim SP-API order response, for audit/debug
  created_at timestamptz not null default now()
);

create unique index orders_org_amazon_id_key on orders (organization_id, channel_id, amazon_order_id);
create index on orders (organization_id, order_status);
create index on orders (organization_id, order_date);

alter table inventory_ledger add constraint inventory_ledger_order_id_fkey
  foreign key (order_id) references orders(id) on delete set null;

create table order_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id) on delete cascade,
  sku_id uuid not null references skus(id),
  quantity int not null,
  unit_price numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create index on order_line_items (organization_id, order_id);

-- ── GST Invoices ──────────────────────────────────────────────────────────

create type gst_invoice_type as enum ('intra_state', 'inter_state'); -- CGST+SGST vs IGST

create table gst_invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  invoice_number text not null,
  invoice_type gst_invoice_type not null,
  taxable_value numeric(12,2) not null,
  cgst_amount numeric(12,2) not null default 0,
  sgst_amount numeric(12,2) not null default 0,
  igst_amount numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null,
  pdf_url text,
  issued_at timestamptz not null default now()
);

create unique index gst_invoices_org_number_key on gst_invoices (organization_id, invoice_number);
create unique index gst_invoices_order_key on gst_invoices (order_id);

-- ── MTR Import & Reconciliation ──────────────────────────────────────────
-- Two separate downstream paths that never get merged directly:
--   revenue ledger        -> uses reconciliation_entries.gross_sales only
--   settlement reconciliation -> uses actual_settlement vs expected_settlement

create table mtr_imports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  channel_id uuid not null references channels(id),
  filename text not null,
  period_start date,
  period_end date,
  row_count int not null default 0,
  uploaded_by uuid references profiles(id),
  uploaded_at timestamptz not null default now()
);

-- raw parsed rows kept verbatim for audit trail, never overwritten
create table mtr_line_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  mtr_import_id uuid not null references mtr_imports(id) on delete cascade,
  amazon_order_id text not null,
  raw_row jsonb not null,
  created_at timestamptz not null default now()
);

create index on mtr_line_items (organization_id, amazon_order_id);

create type reconciliation_status as enum ('matched', 'mismatch', 'pending_review');

create table reconciliation_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  mtr_line_item_id uuid references mtr_line_items(id),
  gross_sales numeric(12,2) not null, -- pushed to Tally as revenue, never the settlement amount
  commission numeric(12,2) not null default 0,
  tcs_cgst numeric(12,2) not null default 0,
  tcs_sgst numeric(12,2) not null default 0,
  tcs_igst numeric(12,2) not null default 0,
  tds_194o numeric(12,2) not null default 0,
  other_fees numeric(12,2) not null default 0,
  expected_settlement numeric(12,2) not null,
  actual_settlement numeric(12,2),
  status reconciliation_status not null default 'pending_review',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index reconciliation_entries_order_key on reconciliation_entries (order_id);
create index on reconciliation_entries (organization_id, status);

-- ── Sync & Error Logs ─────────────────────────────────────────────────────
-- Every error shown to the seller must state: what failed, why (if known),
-- who is responsible (amazon | order_sathi | seller_data), and when.

create type log_fault as enum ('amazon', 'order_sathi', 'seller_data', 'unknown');
create type log_status as enum ('success', 'failed', 'partial');

create table sync_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  channel_id uuid references channels(id),
  operation text not null, -- e.g. 'order_pull', 'inventory_push', 'mtr_import'
  status log_status not null,
  fault log_fault,
  message text not null,
  detail jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index on sync_logs (organization_id, started_at);

-- ── Generic audit log (who changed what) ─────────────────────────────────

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  changed_by uuid references profiles(id),
  changed_at timestamptz not null default now()
);

create function log_audit_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  org uuid;
begin
  if tg_op = 'DELETE' then
    org := old.organization_id;
  else
    org := new.organization_id;
  end if;

  insert into audit_log (organization_id, table_name, record_id, action, old_value, new_value, changed_by)
  values (
    org, tg_table_name, coalesce(new.id, old.id), lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    auth.uid()
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke execute on function log_audit_event() from public, anon, authenticated;

create trigger trg_audit_orders after insert or update or delete on orders
  for each row execute function log_audit_event();
create trigger trg_audit_gst_invoices after insert or update or delete on gst_invoices
  for each row execute function log_audit_event();
create trigger trg_audit_reconciliation after insert or update or delete on reconciliation_entries
  for each row execute function log_audit_event();
create trigger trg_audit_profiles after insert or update or delete on profiles
  for each row execute function log_audit_event();

-- ── Row Level Security ────────────────────────────────────────────────────

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table channels enable row level security;
alter table skus enable row level security;
alter table inventory_ledger enable row level security;
alter table orders enable row level security;
alter table order_line_items enable row level security;
alter table gst_invoices enable row level security;
alter table mtr_imports enable row level security;
alter table mtr_line_items enable row level security;
alter table reconciliation_entries enable row level security;
alter table sync_logs enable row level security;
alter table audit_log enable row level security;

create policy org_read on organizations for select using (id = auth_org_id());

create policy profiles_read on profiles for select using (organization_id = auth_org_id());
create policy profiles_read_self on profiles for select using (id = auth.uid());
create policy profiles_self_update on profiles for update using (id = auth.uid());

create policy channels_read on channels for select using (organization_id = auth_org_id());
create policy channels_write on channels for all
  using (organization_id = auth_org_id() and auth_role() = 'admin');

create policy skus_read on skus for select using (organization_id = auth_org_id());
create policy skus_write on skus for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create policy inventory_ledger_read on inventory_ledger for select using (organization_id = auth_org_id());
create policy inventory_ledger_write on inventory_ledger for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create policy orders_read on orders for select using (organization_id = auth_org_id());
create policy orders_write on orders for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create policy order_line_items_read on order_line_items for select using (organization_id = auth_org_id());
create policy order_line_items_write on order_line_items for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));

create policy gst_invoices_read on gst_invoices for select using (organization_id = auth_org_id());
create policy gst_invoices_write on gst_invoices for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));

create policy mtr_imports_read on mtr_imports for select using (organization_id = auth_org_id());
create policy mtr_imports_write on mtr_imports for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));

create policy mtr_line_items_read on mtr_line_items for select using (organization_id = auth_org_id());
create policy mtr_line_items_write on mtr_line_items for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));

create policy reconciliation_entries_read on reconciliation_entries for select using (organization_id = auth_org_id());
create policy reconciliation_entries_write on reconciliation_entries for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));

create policy sync_logs_read on sync_logs for select using (organization_id = auth_org_id());

create policy audit_log_read on audit_log for select
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'finance'));
revoke insert, update, delete on audit_log from authenticated, anon;
