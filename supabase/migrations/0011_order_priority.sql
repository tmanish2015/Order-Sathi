-- SLA/priority: sla_due_at is the ship-by deadline (from Amazon's
-- LatestShipDate for synced orders, or set manually) - overdue is computed
-- client-side from status + sla_due_at, not stored, since it changes
-- with the clock.

create type order_priority as enum ('normal', 'high', 'urgent');

alter table orders add column priority order_priority not null default 'normal';
alter table orders add column sla_due_at timestamptz;

create index on orders (organization_id, sla_due_at) where sla_due_at is not null;
