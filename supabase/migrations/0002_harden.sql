-- Hardening from Supabase's security advisor (run after 0001_init.sql)

-- 1. Fixed search_path on every function (all names inside are schema-qualified)
alter function public.can_read(uuid)                     set search_path = '';
alter function public.can_write(uuid)                    set search_path = '';
alter function public.is_paid(uuid, text)                set search_path = '';
alter function public.guard_paid_month()                 set search_path = '';
alter function public.guard_rate_change()                set search_path = '';
alter function public.touch()                            set search_path = '';
alter function public.row_key(text, jsonb)               set search_path = '';
alter function public.ping()                             set search_path = '';

-- 2. SECURITY DEFINER functions: nobody signed out may call them
--    trigger functions are only ever run by their triggers
revoke execute on function public.tombstone()   from public, anon, authenticated;
revoke execute on function public.untombstone() from public, anon, authenticated;
--    sign-in-only actions (they also check auth.uid() themselves)
revoke execute on function public.create_household(text, text) from public, anon;
revoke execute on function public.join_household(text)         from public, anon;
revoke execute on function public.new_invite_code(uuid)        from public, anon;
revoke execute on function public.has_role(uuid, public.member_role[]) from public, anon;
grant  execute on function public.create_household(text, text) to authenticated;
grant  execute on function public.join_household(text)         to authenticated;
grant  execute on function public.new_invite_code(uuid)        to authenticated;
grant  execute on function public.has_role(uuid, public.member_role[]) to authenticated;
-- the keep-alive ping stays public (it only returns the time)
