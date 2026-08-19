-- Phase 3: extend the generic audit_log trigger (0001) to skus. A SKU's
-- cost price or buffer stock can be edited with no trace of who changed
-- it or what it was before. (order_returns is already covered by 0006.
-- inventory_ledger is append-only so it doesn't need this - every row IS
-- an audit event already.)

create trigger trg_audit_skus after insert or update or delete on skus
  for each row execute function log_audit_event();
