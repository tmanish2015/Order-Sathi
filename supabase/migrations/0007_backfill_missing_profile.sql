-- One-off data fix: tmanish2015@gmail.com's auth.users row predates the
-- handle_new_user() trigger (added in Batch 1), so no profiles row was ever
-- created for it. This is a direct, admin-only data insert - it does not
-- touch auth code, RLS policies, or the approval gate. The account is set
-- active + admin here explicitly (a deliberate admin action), not via any
-- self-service path; the public signup flow still defaults new accounts to
-- status='pending' / role='sales' as before, unchanged.

insert into profiles (id, organization_id, email, full_name, role, status)
select
  u.id,
  '00000000-0000-0000-0000-000000000001',
  u.email,
  u.raw_user_meta_data->>'full_name',
  'admin',
  'active'
from auth.users u
where u.email = 'tmanish2015@gmail.com'
  and not exists (select 1 from profiles p where p.id = u.id);
