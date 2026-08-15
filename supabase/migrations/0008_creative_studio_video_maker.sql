-- Creative Studio (in-app canvas design tool) + Video Maker (template-based,
-- render step gated behind a rendering-service integration not yet connected).

-- ── Creatives (Creative Studio) ──────────────────────────────────────────

create table creatives (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id uuid references customers(id) on delete set null,
  name text not null,
  canvas_data jsonb not null default '{}',
  width int not null default 1080,
  height int not null default 1080,
  thumbnail_url text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_demo boolean not null default false
);

create index on creatives (organization_id, created_at);

alter table campaign_posts add column creative_id uuid references creatives(id) on delete set null;

alter table creatives enable row level security;

create policy creatives_read on creatives for select
  using (organization_id = auth_org_id());
create policy creatives_write on creatives for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'marketing', 'sales'));

create trigger trg_audit_creatives
  after insert or update or delete on creatives
  for each row execute function log_audit_event();

-- ── Videos (Video Maker) ──────────────────────────────────────────────────

create type video_status as enum ('draft', 'pending', 'rendering', 'rendered', 'failed');

create table videos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  customer_id uuid references customers(id) on delete set null,
  name text not null,
  template text not null,
  inputs jsonb not null default '{}',
  status video_status not null default 'draft',
  output_url text,
  error_message text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_demo boolean not null default false
);

create index on videos (organization_id, created_at);

alter table videos enable row level security;

create policy videos_read on videos for select
  using (organization_id = auth_org_id());
create policy videos_write on videos for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'marketing', 'sales'));

create trigger trg_audit_videos
  after insert or update or delete on videos
  for each row execute function log_audit_event();
