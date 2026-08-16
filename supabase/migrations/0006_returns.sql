-- RTO (return to origin) and customer returns, tracked per line item so
-- restocking is SKU-accurate. Mirrors the reconciliation pattern: an
-- expected amount computed by the app, an actual amount entered once the
-- refund lands, and a visible mismatch rather than a silently accepted one.

create type return_type as enum ('customer_return', 'rto');
create type return_status as enum ('initiated', 'received', 'refunded');

create table order_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  order_id uuid not null references orders(id),
  order_line_item_id uuid not null references order_line_items(id),
  sku_id uuid not null references skus(id),
  return_type return_type not null,
  quantity int not null,
  reason text,
  status return_status not null default 'initiated',
  expected_refund numeric(12,2) not null default 0,
  actual_refund numeric(12,2),
  restocked boolean not null default false,
  reviewed_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index on order_returns (organization_id, status);
create index on order_returns (organization_id, order_id);

alter table order_returns enable row level security;

create policy order_returns_read on order_returns for select
  using (organization_id = auth_org_id());
create policy order_returns_write on order_returns for all
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops', 'finance'));

create trigger trg_audit_order_returns after insert or update or delete on order_returns
  for each row execute function log_audit_event();
