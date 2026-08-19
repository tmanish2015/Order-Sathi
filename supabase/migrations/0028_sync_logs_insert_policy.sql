-- sync_logs has had a read policy since 0001 but never an insert policy -
-- reportError() (src/lib/errors.ts) has been silently failing to persist
-- client-side error logs for the entire life of the app, masked because
-- it's intentionally fire-and-forget (a logging failure must never block
-- or surface over the real error). Edge functions never hit this because
-- they run under the service role, which bypasses RLS entirely.
create policy sync_logs_write on sync_logs for insert
  with check (organization_id = auth_org_id());
