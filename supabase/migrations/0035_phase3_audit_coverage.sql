-- Phase 3: extend the generic audit_log trigger (0001) to skus and
-- order_returns. Both are financially/operationally significant and
-- currently invisible to audit_log - a SKU's cost price or buffer stock
-- can be edited with no trace of who changed it or what it was before,
-- and a return's expected/actual refund the same. inventory_ledger is
-- append-only (never mutated) so it doesn't need this - every row IS an
-- audit event already.

create trigger trg_audit_skus after insert or update or delete on skus
  for each row execute function log_audit_event();
create trigger trg_audit_order_returns after insert or update or delete on order_returns
  for each row execute function log_audit_event();
