-- Auto-create profile row on signup; lock down RLS helper function grants;
-- add plan category (erp vs marketing subscriptions).

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, organization_id, email, full_name, role)
  values (
    new.id,
    '00000000-0000-0000-0000-000000000001',
    new.email,
    new.raw_user_meta_data->>'full_name',
    'sales'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

revoke execute on function handle_new_user() from public, anon, authenticated;
revoke execute on function auth_org_id() from public, anon;
revoke execute on function auth_role() from public, anon;
revoke execute on function log_subscription_status_change() from public, anon, authenticated;
grant execute on function auth_org_id() to authenticated;
grant execute on function auth_role() to authenticated;

create type plan_category as enum ('erp', 'marketing');
alter table plans add column category plan_category not null default 'erp';
