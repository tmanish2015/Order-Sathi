-- Popular ERP: initial schema
-- Multi-tenant ready (organization_id on every table), single org seeded for now.

create extension if not exists "pgcrypto";

-- ── Organizations & Users ──────────────────────────────────────────────

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create type user_role as enum ('admin', 'sales', 'marketing', 'finance');

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id),
  full_name text,
  email text not null,
  role user_role not null default 'sales',
  created_at timestamptz not null default now()
);

-- seed default org
insert into organizations (id, name) values
  ('00000000-0000-0000-0000-000000000001', 'Popular Printers');

-- ── Helper functions (used by RLS policies) ────────────────────────────

create function auth_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid();
$$;

create function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

-- ── Customers ───────────────────────────────────────────────────────────

create type customer_type as enum ('education', 'healthcare', 'government', 'corporate', 'other');

create table customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  company_name text not null,
  contact_person text,
  email text,
  phone text,
  address text,
  gst_number text,
  has_lut boolean not null default false,
  customer_type customer_type not null default 'other',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ── Plans & Subscriptions ───────────────────────────────────────────────

create type billing_cycle as enum ('monthly', 'quarterly', 'annual');
create type subscription_status as enum ('active', 'paused', 'cancelled', 'past_due');

create table plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  amount numeric(12,2) not null,
  billing_cycle billing_cycle not null,
  razorpay_plan_id text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id uuid not null references customers(id) on delete cascade,
  plan_id uuid not null references plans(id),
  razorpay_customer_id text,
  razorpay_subscription_id text,
  start_date date not null default current_date,
  next_due_date date,
  status subscription_status not null default 'active',
  failed_charge_count int not null default 0,
  created_at timestamptz not null default now()
);

create index on subscriptions (organization_id, status);
create index on subscriptions (next_due_date);

-- ── Invoices & Payment Events ────────────────────────────────────────────

create type invoice_status as enum ('paid', 'pending', 'failed');

create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  subscription_id uuid not null references subscriptions(id) on delete cascade,
  customer_id uuid not null references customers(id),
  amount numeric(12,2) not null,
  razorpay_payment_id text,
  razorpay_invoice_id text,
  status invoice_status not null default 'pending',
  issued_at timestamptz not null default now(),
  paid_at timestamptz
);

create table payment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  subscription_id uuid references subscriptions(id) on delete set null,
  event_type text not null,
  payload jsonb not null,
  received_at timestamptz not null default now()
);

-- ── Audit log (payment / subscription status changes) ───────────────────

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

create function log_subscription_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (tg_op = 'UPDATE' and old.status is distinct from new.status) then
    insert into audit_log (organization_id, table_name, record_id, action, old_value, new_value)
    values (new.organization_id, 'subscriptions', new.id, 'status_change',
            jsonb_build_object('status', old.status), jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

create trigger trg_subscription_audit
  after update on subscriptions
  for each row execute function log_subscription_status_change();

-- ── Social Media ──────────────────────────────────────────────────────────

create type social_platform as enum ('facebook', 'instagram', 'linkedin', 'twitter');

create table social_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  platform social_platform not null,
  account_name text not null,
  access_token text, -- encrypted at rest via Supabase Vault in production
  refresh_token text,
  expires_at timestamptz,
  connected_by uuid references profiles(id),
  connected_at timestamptz not null default now(),
  status text not null default 'active'
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  objective text,
  platforms social_platform[] not null default '{}',
  status text not null default 'draft',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create type post_mode as enum ('auto', 'plan_only');
create type post_status as enum ('draft', 'scheduled', 'posted', 'failed');

create table campaign_posts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  social_account_id uuid references social_accounts(id),
  platform social_platform not null,
  content text,
  media_urls text[] not null default '{}',
  scheduled_at timestamptz not null,
  mode post_mode not null default 'plan_only',
  status post_status not null default 'draft',
  posted_at timestamptz,
  external_post_id text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index on campaign_posts (organization_id, scheduled_at);

create table post_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  campaign_post_id uuid not null references campaign_posts(id) on delete cascade,
  reach int not null default 0,
  engagement int not null default 0,
  clicks int not null default 0,
  fetched_at timestamptz not null default now()
);

-- ── Leads ─────────────────────────────────────────────────────────────────

create type lead_source as enum ('website', 'meta', 'linkedin', 'referral', 'other');
create type lead_status as enum ('new', 'contacted', 'qualified', 'proposal', 'won', 'lost');

create table leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  company text,
  email text,
  phone text,
  source lead_source not null default 'other',
  campaign_id uuid references campaigns(id) on delete set null,
  status lead_status not null default 'new',
  score int not null default 0,
  assigned_to uuid references profiles(id),
  converted_customer_id uuid references customers(id),
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index on leads (organization_id, status);

create table lead_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  lead_id uuid not null references leads(id) on delete cascade,
  activity_type text not null,
  notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- ── Row Level Security ────────────────────────────────────────────────────

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table customers enable row level security;
alter table plans enable row level security;
alter table subscriptions enable row level security;
alter table invoices enable row level security;
alter table payment_events enable row level security;
alter table audit_log enable row level security;
alter table social_accounts enable row level security;
alter table campaigns enable row level security;
alter table campaign_posts enable row level security;
alter table post_metrics enable row level security;
alter table leads enable row level security;
alter table lead_activities enable row level security;

-- organizations: read own org only
create policy org_read on organizations for select
  using (id = auth_org_id());

-- profiles: read within org, self-update
create policy profiles_read on profiles for select
  using (organization_id = auth_org_id());
create policy profiles_self_update on profiles for update
  using (id = auth.uid());

-- customers: org-scoped read for all roles; write for admin/sales/finance
create policy customers_read on customers for select
  using (organization_id = auth_org_id());
create policy customers_write on customers for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin','sales','finance'));
create policy customers_update on customers for update
  using (organization_id = auth_org_id() and auth_role() in ('admin','sales','finance'));
create policy customers_delete on customers for delete
  using (organization_id = auth_org_id() and auth_role() = 'admin');

-- plans: org-scoped read; write admin/finance
create policy plans_read on plans for select
  using (organization_id = auth_org_id());
create policy plans_write on plans for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin','finance'));
create policy plans_update on plans for update
  using (organization_id = auth_org_id() and auth_role() in ('admin','finance'));

-- subscriptions: org-scoped read; write admin/finance/sales
create policy subscriptions_read on subscriptions for select
  using (organization_id = auth_org_id());
create policy subscriptions_write on subscriptions for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin','finance','sales'));
create policy subscriptions_update on subscriptions for update
  using (organization_id = auth_org_id() and auth_role() in ('admin','finance'));

-- invoices: org-scoped read; write admin/finance (typically via service role from webhook)
create policy invoices_read on invoices for select
  using (organization_id = auth_org_id());
create policy invoices_write on invoices for all
  using (organization_id = auth_org_id() and auth_role() in ('admin','finance'));

-- payment_events: finance/admin read only (service role bypasses RLS for inserts from webhook)
create policy payment_events_read on payment_events for select
  using (organization_id = auth_org_id() and auth_role() in ('admin','finance'));

-- audit_log: admin/finance read only
create policy audit_log_read on audit_log for select
  using (organization_id = auth_org_id() and auth_role() in ('admin','finance'));

-- social_accounts: org-scoped read; write admin/marketing
create policy social_accounts_read on social_accounts for select
  using (organization_id = auth_org_id());
create policy social_accounts_write on social_accounts for all
  using (organization_id = auth_org_id() and auth_role() in ('admin','marketing'));

-- campaigns & campaign_posts: org-scoped read; write admin/marketing
create policy campaigns_read on campaigns for select
  using (organization_id = auth_org_id());
create policy campaigns_write on campaigns for all
  using (organization_id = auth_org_id() and auth_role() in ('admin','marketing'));

create policy campaign_posts_read on campaign_posts for select
  using (organization_id = auth_org_id());
create policy campaign_posts_write on campaign_posts for all
  using (organization_id = auth_org_id() and auth_role() in ('admin','marketing'));

create policy post_metrics_read on post_metrics for select
  using (organization_id = auth_org_id());

-- leads & lead_activities: org-scoped read; write admin/sales/marketing
create policy leads_read on leads for select
  using (organization_id = auth_org_id());
create policy leads_write on leads for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin','sales','marketing'));
create policy leads_update on leads for update
  using (organization_id = auth_org_id() and auth_role() in ('admin','sales','marketing'));

create policy lead_activities_read on lead_activities for select
  using (organization_id = auth_org_id());
create policy lead_activities_write on lead_activities for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin','sales','marketing'));
