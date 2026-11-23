-- Tidier row-level security (from Supabase's performance advisor):
-- one policy per action, and only for signed-in users, instead of an overlapping
-- "read" + "all" pair on every table. Same rules as before: members read, owner/editor write.
do $$
declare t text;
begin
  foreach t in array array['workers','worker_rates','ot_offers','entries','account_days','schedules','bonuses','payouts'] loop
    execute format('drop policy if exists %1$s_read on public.%1$s', t);
    execute format('drop policy if exists %1$s_write on public.%1$s', t);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using ((select public.can_read(household_id)))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check ((select public.can_write(household_id)))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using ((select public.can_write(household_id))) with check ((select public.can_write(household_id)))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using ((select public.can_write(household_id)))', t);
  end loop;
end $$;

drop policy if exists tomb_read on public.tombstones;
create policy tomb_select on public.tombstones for select to authenticated using ((select public.can_read(household_id)));

drop policy if exists hh_read on public.households;
drop policy if exists hh_update on public.households;
create policy hh_select on public.households for select to authenticated using ((select public.can_read(id)));
create policy hh_update on public.households for update to authenticated
  using ((select public.has_role(id, array['owner']::public.member_role[])))
  with check ((select public.has_role(id, array['owner']::public.member_role[])));

drop policy if exists mem_read on public.household_members;
drop policy if exists mem_admin on public.household_members;
create policy mem_select on public.household_members for select to authenticated using ((select public.can_read(household_id)));
create policy mem_insert on public.household_members for insert to authenticated with check ((select public.has_role(household_id, array['owner']::public.member_role[])));
create policy mem_update on public.household_members for update to authenticated
  using ((select public.has_role(household_id, array['owner']::public.member_role[])))
  with check ((select public.has_role(household_id, array['owner']::public.member_role[])));
create policy mem_delete on public.household_members for delete to authenticated using ((select public.has_role(household_id, array['owner']::public.member_role[])));

-- indexes for foreign keys
create index if not exists bonuses_worker_idx       on public.bonuses (worker_id);
create index if not exists entries_offer_idx        on public.entries (ot_offer_id);
create index if not exists payouts_household_idx    on public.payouts (household_id);
create index if not exists worker_rates_household_idx on public.worker_rates (household_id);
create index if not exists workers_user_idx         on public.workers (user_id);
