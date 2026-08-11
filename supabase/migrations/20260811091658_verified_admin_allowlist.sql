-- Bootstrap administrators only after Supabase has verified ownership of an
-- explicitly allowlisted email address. This avoids hardcoded passwords and
-- prevents public signup metadata from granting elevated access.
create table public.admin_email_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);

alter table public.admin_email_allowlist enable row level security;
revoke all on public.admin_email_allowlist from anon, authenticated;

insert into public.admin_email_allowlist (email)
values ('8002salman@gmail.com');

create or replace function public.apply_verified_admin_allowlist()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null
    and exists (
      select 1 from public.admin_email_allowlist a
      where a.email = lower(new.email)
    )
  then
    update auth.users
      set raw_app_meta_data = jsonb_set(
        coalesce(raw_app_meta_data, '{}'::jsonb),
        '{role}',
        '"admin"'::jsonb,
        true
      )
      where id = new.id
        and coalesce(raw_app_meta_data ->> 'role', '') <> 'admin';
  end if;
  return new;
end;
$$;

create trigger apply_verified_admin_role
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.apply_verified_admin_allowlist();

comment on table public.admin_email_allowlist is
  'Server-only bootstrap allowlist. Matching users become admins only after email verification.';
