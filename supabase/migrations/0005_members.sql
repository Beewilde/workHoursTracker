-- See who is in the organization (Organization → Members), and let the owner remove someone.
-- Emails live in auth.users, which the app can't read directly, so these run as security definer
-- and only ever return members of an organization the caller belongs to.
create or replace function public.list_members(p_household uuid)
returns table (user_id uuid, email text, role public.member_role, joined_at timestamptz, last_sign_in_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.joined_at, u.last_sign_in_at
  from public.household_members m
  join auth.users u on u.id = m.user_id
  where m.household_id = p_household and public.can_read(p_household)
  order by (m.role <> 'owner'), m.joined_at
$$;

create or replace function public.remove_member(p_household uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_household, array['owner']::public.member_role[]) then raise exception 'Only the owner can remove members'; end if;
  if p_user = auth.uid() then raise exception 'You can''t remove yourself'; end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
end $$;

revoke execute on function public.list_members(uuid) from public, anon;
revoke execute on function public.remove_member(uuid, uuid) from public, anon;
grant execute on function public.list_members(uuid) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
