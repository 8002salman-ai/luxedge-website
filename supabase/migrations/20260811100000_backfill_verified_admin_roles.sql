-- Promote verified allowlisted users deterministically during writes and
-- backfill accounts that were confirmed before this hardened trigger existed.
create or replace function public.apply_verified_admin_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
    and exists (
      select 1
      from public.admin_email_allowlist a
      where a.email = lower(new.email)
    )
  then
    new.raw_app_meta_data := jsonb_set(
      coalesce(new.raw_app_meta_data, '{}'::jsonb),
      '{role}',
      '"admin"'::jsonb,
      true
    );
  end if;

  return new;
end;
$$;

drop trigger if exists apply_verified_admin_role on auth.users;

create trigger apply_verified_admin_role
  before insert or update of email, email_confirmed_at, raw_app_meta_data
  on auth.users
  for each row execute function public.apply_verified_admin_allowlist();

update auth.users as u
set raw_app_meta_data = jsonb_set(
  coalesce(u.raw_app_meta_data, '{}'::jsonb),
  '{role}',
  '"admin"'::jsonb,
  true
)
where u.email_confirmed_at is not null
  and coalesce(u.raw_app_meta_data ->> 'role', '') <> 'admin'
  and exists (
    select 1
    from public.admin_email_allowlist a
    where a.email = lower(u.email)
  );

revoke execute on function public.apply_verified_admin_allowlist()
  from public, anon, authenticated;
