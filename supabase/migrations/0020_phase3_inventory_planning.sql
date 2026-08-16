-- Phase 3: inventory planning fields on skus.
-- Global per-SKU (not per-warehouse), same pattern as the existing
-- buffer_stock column - keeps the additive stock-counter architecture
-- from Phase 1/2 untouched, this just adds planning metadata on top.

alter table skus
  add column reorder_level integer not null default 0,
  add column min_stock integer not null default 0,
  add column max_stock integer,
  add column safety_stock integer not null default 0,
  add column reorder_qty integer not null default 0,
  add column lead_time_days integer not null default 0;
