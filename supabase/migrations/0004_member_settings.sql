-- Members (owner + editors) can change the shared settings (lunch, peso rate, presets…).
-- Before this only the owner could, and a member's change silently stayed on their phone.
-- Column privileges keep everything else (name, invite code) owner-only: the owner changes
-- the invite code through new_invite_code().
drop policy if exists hh_update on public.households;
create policy hh_update on public.households for update to authenticated
  using ((select public.can_write(id))) with check ((select public.can_write(id)));
revoke update on public.households from anon, authenticated;
grant update (settings, timezone) on public.households to authenticated;
