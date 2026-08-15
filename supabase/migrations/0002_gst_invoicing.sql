-- GST invoice generation: seller's own GST details, a per-org sequential
-- invoice number, and a private storage bucket to hold the rendered PDFs.

alter table organizations add column state text;
alter table organizations add column address text;
alter table organizations add column invoice_seq int not null default 0;

-- 0001 only granted read on organizations; admins need to set state/GST/address.
create policy org_write on organizations for update
  using (id = auth_org_id() and auth_role() = 'admin');

-- Row-locking increment so two simultaneous invoice generations in the same
-- org can never land on the same number.
create function next_invoice_number() returns text
language plpgsql security definer set search_path = public as $$
declare
  org uuid;
  seq int;
  yr text;
begin
  org := auth_org_id();
  if org is null then
    raise exception 'not authorized';
  end if;

  update organizations set invoice_seq = invoice_seq + 1
  where id = org
  returning invoice_seq into seq;

  yr := to_char(now(), 'YYYY');
  return 'INV-' || yr || '-' || lpad(seq::text, 5, '0');
end;
$$;

revoke execute on function next_invoice_number() from public, anon;
grant execute on function next_invoice_number() to authenticated;

-- ── Invoice PDF storage ───────────────────────────────────────────────────
-- Objects are keyed "{organization_id}/{invoice_number}.pdf"; RLS checks the
-- leading path segment matches the caller's own org.

insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create policy invoices_bucket_read on storage.objects for select
  using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth_org_id()::text);

create policy invoices_bucket_write on storage.objects for insert
  with check (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth_org_id()::text and auth_role() in ('admin', 'finance'));
