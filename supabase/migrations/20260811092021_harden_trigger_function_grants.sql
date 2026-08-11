-- Trigger functions are invoked by Postgres, not directly through the Data API.
-- Remove default function EXECUTE grants flagged by the Security Advisor.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.apply_verified_admin_allowlist() from public;
revoke execute on function public.apply_verified_admin_allowlist() from anon;
revoke execute on function public.apply_verified_admin_allowlist() from authenticated;

do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end;
$$;
