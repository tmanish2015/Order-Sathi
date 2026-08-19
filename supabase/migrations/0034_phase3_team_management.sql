-- Phase 3: role & permission management for already-active team members.
-- approve_team_member (0001) only covers the initial pending->active
-- transition. This adds the missing counterpart: an admin changing an
-- active member's role, or deactivating them (back to 'pending', which
-- already means "no data access" everywhere in the app). Same
-- security-definer + same-org + admin-only guard as approve_team_member.
-- Self-target is blocked so an admin can't accidentally lock themselves out.

create function update_team_member(p_user_id uuid, p_role user_role, p_status user_status)
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
    raise exception 'only admins can manage team members';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'cannot change your own role or status here';
  end if;

  select organization_id into target_org from profiles where id = p_user_id;
  if target_org is null or target_org is distinct from caller_org then
    raise exception 'user not found in your organization';
  end if;

  update profiles set role = p_role, status = p_status where id = p_user_id;
end;
$$;

revoke execute on function update_team_member(uuid, user_role, user_status) from public, anon;
grant execute on function update_team_member(uuid, user_role, user_status) to authenticated;
