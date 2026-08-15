-- Security Batch 3: database integrity + auditability.
-- Verified against live data before writing this migration: zero existing
-- duplicates on every column below (profiles.email, customers email/gst per
-- org, plans name per org, razorpay_subscription_id, razorpay_payment_id) -
-- these constraints are safe to add without breaking current rows.

-- ── 1. Unique constraints on business-critical identifiers ──────────────

-- one login per email, globally (mirrors auth.users' own uniqueness)
create unique index profiles_email_key on profiles (email);

-- no two customers in the same org sharing an email or a GST number
create unique index customers_org_email_key on customers (organization_id, lower(email)) where email is not null;
create unique index customers_org_gst_key on customers (organization_id, gst_number) where gst_number is not null;

-- no two plans in the same org sharing a name
create unique index plans_org_name_key on plans (organization_id, name);

-- external payment-provider identifiers must map 1:1 to our records, or a
-- retried webhook silently creates a duplicate subscription/invoice
create unique index subscriptions_razorpay_id_key on subscriptions (razorpay_subscription_id) where razorpay_subscription_id is not null;
create unique index invoices_razorpay_payment_id_key on invoices (razorpay_payment_id) where razorpay_payment_id is not null;

-- ── 2. Expand audit logging beyond subscription status ───────────────────

drop trigger if exists trg_subscription_audit on subscriptions;
drop function if exists log_subscription_status_change();

create or replace function log_audit_event() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  org uuid;
begin
  if tg_op = 'DELETE' then
    org := old.organization_id;
  else
    org := new.organization_id;
  end if;

  insert into audit_log (organization_id, table_name, record_id, action, old_value, new_value, changed_by)
  values (
    org,
    tg_table_name,
    coalesce(new.id, old.id),
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    auth.uid()
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke execute on function log_audit_event() from public, anon, authenticated;

-- customers: who created/edited/deleted a customer record
create trigger trg_audit_customers
  after insert or update or delete on customers
  for each row execute function log_audit_event();

-- subscriptions: full row history, not just status (plan changes, renewal
-- date edits, failed-charge-count bumps all matter for billing disputes)
create trigger trg_audit_subscriptions
  after insert or update or delete on subscriptions
  for each row execute function log_audit_event();

-- invoices: billing history is the thing most likely to be disputed
create trigger trg_audit_invoices
  after insert or update or delete on invoices
  for each row execute function log_audit_event();

-- plans: pricing/category changes affect every customer on that plan
create trigger trg_audit_plans
  after insert or update or delete on plans
  for each row execute function log_audit_event();

-- profiles: team membership and role changes (who approved whom, role
-- escalations/demotions) - the most security-sensitive table in the app
create trigger trg_audit_profiles
  after insert or update or delete on profiles
  for each row execute function log_audit_event();

-- ── 3. Immutable audit trail ──────────────────────────────────────────────

-- audit_log already has no INSERT/UPDATE/DELETE policy for authenticated/anon
-- (only the admin/finance-only SELECT policy from earlier), so RLS already
-- denies direct writes. Make that explicit and defense-in-depth at the grant
-- level too, so it holds even if a future migration ever adds a write policy
-- by mistake: only the trigger, running as the table owner (which bypasses
-- RLS by default), can ever populate this table.
revoke insert, update, delete on audit_log from authenticated, anon;
