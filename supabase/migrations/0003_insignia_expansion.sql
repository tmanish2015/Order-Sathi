-- INSIGNIA Control Centre expansion: agency-model campaigns, service delivery,
-- upsell/cross-sell tracking, employee task assignment.

alter table campaigns add column customer_id uuid references customers(id) on delete set null;
create index on campaigns (customer_id);

alter table plans add column deliverable_qty int;
alter table plans add column deliverable_unit text;

-- ── Opportunities (upsell / cross-sell pipeline) ─────────────────────────

create type opportunity_type as enum ('upsell', 'cross_sell');
create type opportunity_status as enum ('identified', 'contacted', 'proposed', 'won', 'dismissed');

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id uuid not null references customers(id) on delete cascade,
  type opportunity_type not null,
  suggested_plan_id uuid references plans(id),
  status opportunity_status not null default 'identified',
  notes text,
  assigned_to uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create index on opportunities (organization_id, status);

alter table opportunities enable row level security;

create policy opportunities_read on opportunities for select
  using (organization_id = auth_org_id());
create policy opportunities_write on opportunities for all
  using (organization_id = auth_org_id() and auth_role() in ('admin','sales','marketing'));

-- ── Tasks (employee assignment) ──────────────────────────────────────────

create type task_status as enum ('todo', 'in_progress', 'done');
create type task_priority as enum ('P0', 'P1', 'P2');

create table tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  title text not null,
  description text,
  customer_id uuid references customers(id) on delete set null,
  assigned_to uuid references profiles(id),
  status task_status not null default 'todo',
  priority task_priority not null default 'P2',
  due_date date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index on tasks (organization_id, status);
create index on tasks (assigned_to);

alter table tasks enable row level security;

create policy tasks_read on tasks for select
  using (organization_id = auth_org_id());
create policy tasks_write on tasks for insert
  with check (organization_id = auth_org_id() and auth_role() in ('admin','sales','marketing','finance'));
create policy tasks_update on tasks for update
  using (organization_id = auth_org_id() and (auth_role() in ('admin','sales','marketing','finance') or assigned_to = auth.uid()));
create policy tasks_delete on tasks for delete
  using (organization_id = auth_org_id() and auth_role() = 'admin');

-- ── Rebrand seed org ──────────────────────────────────────────────────────

update organizations set name = 'INSIGNIA' where id = '00000000-0000-0000-0000-000000000001';
