-- Security Batch 2
-- 1. No more hardcoded organization id anywhere data gets written from -
--    the signup trigger now resolves it dynamically instead of a literal.
-- 2. Demo/production data separation: is_demo flag on every content table,
--    backfilled true for the existing seed data, defaulting false so
--    anything a real user creates from here on is unambiguously real.
-- 3. client_error_log: a persistent record of failed writes surfaced to
--    users, not just a console.error that vanishes when the tab closes.

-- ── 1. No hardcoded org id in the signup trigger ─────────────────────────

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  target_org uuid;
begin
  -- Single-tenant today: resolve the one organization that exists rather
  -- than embedding its id as a literal. Once invites carry an explicit
  -- org id this becomes `select org_id from invites where token = ...`.
  select id into target_org from organizations order by created_at limit 1;

  insert into public.profiles (id, organization_id, email, full_name, role)
  values (
    new.id,
    target_org,
    new.email,
    new.raw_user_meta_data->>'full_name',
    'sales'
  );
  return new;
end;
$$;

-- ── 2. Demo/production data separation ───────────────────────────────────

alter table customers add column is_demo boolean not null default false;
alter table plans add column is_demo boolean not null default false;
alter table subscriptions add column is_demo boolean not null default false;
alter table invoices add column is_demo boolean not null default false;
alter table leads add column is_demo boolean not null default false;
alter table campaigns add column is_demo boolean not null default false;
alter table campaign_posts add column is_demo boolean not null default false;
alter table opportunities add column is_demo boolean not null default false;
alter table tasks add column is_demo boolean not null default false;

-- everything currently in these tables is the seed dataset from earlier
-- sessions - flag it now so it's structurally distinguishable and
-- purgeable once real customers are entered.
update customers set is_demo = true;
update plans set is_demo = true;
update subscriptions set is_demo = true;
update invoices set is_demo = true;
update leads set is_demo = true;
update campaigns set is_demo = true;
update campaign_posts set is_demo = true;
update opportunities set is_demo = true;
update tasks set is_demo = true;

create index on customers (organization_id, is_demo);

-- ── 3. Persistent client-side error log ──────────────────────────────────

create table client_error_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id uuid references profiles(id),
  context text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create index on client_error_log (organization_id, created_at);

alter table client_error_log enable row level security;

create policy client_error_log_insert on client_error_log for insert
  with check (organization_id = auth_org_id());

create policy client_error_log_read on client_error_log for select
  using (organization_id = auth_org_id() and auth_role() = 'admin');
