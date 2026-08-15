-- Security Batch 1
-- 1. Signup approval gate: new accounts land 'pending' with no data access until
--    an admin approves them (assigning a role in the process).
-- 2. Meta tokens moved out of plaintext columns into Supabase Vault; the table
--    only ever holds an opaque secret reference.

-- ── 1. Signup approval gate ──────────────────────────────────────────────

create type user_status as enum ('pending', 'active');

alter table profiles add column status user_status not null default 'pending';

-- existing accounts (pre-dating this gate) keep working
update profiles set status = 'active';

-- auth_org_id()/auth_role() now return null for anyone not yet approved,
-- which makes every org-scoped RLS policy deny access automatically.
create or replace function auth_org_id() returns uuid
language sql stable security definer set search_path = public as $$
  select organization_id from profiles where id = auth.uid() and status = 'active';
$$;

create or replace function auth_role() returns user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and status = 'active';
$$;

-- a pending user still needs to read their own row (to render the
-- "awaiting approval" screen) even though auth_org_id() returns null for them.
create policy profiles_read_self on profiles for select
  using (id = auth.uid());

-- lock self-service profile updates down to full_name only: role/status/
-- organization_id must never be settable by the row owner, or the approval
-- gate above is just cosmetic (self-approve via PATCH).
revoke update on profiles from authenticated;
grant update (full_name) on profiles to authenticated;

-- the only path to change role/status: an admin, explicitly, in-org.
create or replace function approve_team_member(p_user_id uuid, p_role user_role)
returns void
language plpgsql security definer set search_path = public as $$
declare
  caller_role user_role;
  caller_org uuid;
  target_org uuid;
begin
  select role, organization_id into caller_role, caller_org
  from profiles where id = auth.uid() and status = 'active';

  if caller_role is distinct from 'admin' then
    raise exception 'only admins can approve team members';
  end if;

  select organization_id into target_org from profiles where id = p_user_id;
  if target_org is null or target_org is distinct from caller_org then
    raise exception 'user not found in your organization';
  end if;

  update profiles set status = 'active', role = p_role where id = p_user_id;
end;
$$;

revoke execute on function approve_team_member(uuid, user_role) from public, anon;
grant execute on function approve_team_member(uuid, user_role) to authenticated;

-- ── 2. Vault-backed Meta tokens ───────────────────────────────────────────

alter table social_accounts drop column access_token;
alter table social_accounts drop column refresh_token;
alter table social_accounts add column access_token_secret_id uuid;
