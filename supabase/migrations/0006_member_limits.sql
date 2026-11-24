-- What members (role 'editor') may do vs the owner.
--   Members: log NEW days, and add/change review bonuses and Account Day info.
--   Owner only: change or delete a saved day log; workers & rates; OT offers; month settings;
--               marking months paid; the shared settings (peso rate, lunch, presets…).
create or replace function public.is_owner(hh uuid) returns boolean language sql stable set search_path = '' as
  $$ select public.has_role(hh, array['owner']::public.member_role[]) $$;

-- saved day logs: anyone in the organization can add; only the owner can change or delete
drop policy if exists entries_update on public.entries;
drop policy if exists entries_delete on public.entries;
create policy entries_update on public.entries for update to authenticated
  using ((select public.is_owner(household_id))) with check ((select public.is_owner(household_id)));
create policy entries_delete on public.entries for delete to authenticated using ((select public.is_owner(household_id)));

-- management tables: owner only for every change
do $$
declare t text;
begin
  foreach t in array array['workers','worker_rates','ot_offers','schedules','payouts'] loop
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('drop policy if exists %1$s_delete on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check ((select public.is_owner(household_id)))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using ((select public.is_owner(household_id))) with check ((select public.is_owner(household_id)))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using ((select public.is_owner(household_id)))', t);
  end loop;
end $$;

-- shared settings: owner only again (members see them, the app shows them read-only)
drop policy if exists hh_update on public.households;
create policy hh_update on public.households for update to authenticated
  using ((select public.is_owner(id))) with check ((select public.is_owner(id)));

revoke execute on function public.is_owner(uuid) from public, anon;
grant execute on function public.is_owner(uuid) to authenticated;
