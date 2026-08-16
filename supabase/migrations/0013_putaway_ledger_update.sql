-- inventory_ledger only had an INSERT policy (append-only by design for
-- quantity/movement history). Put-away needs to correct bin_id after the
-- fact without touching quantity - allow update, scoped the same as insert.
create policy inventory_ledger_update on inventory_ledger for update
  using (organization_id = auth_org_id() and auth_role() in ('admin', 'ops'));
