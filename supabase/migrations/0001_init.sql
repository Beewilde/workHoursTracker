-- Shiftly / workHoursTracker — Supabase schema (v1)
-- Mirrors the in-browser state in web/src/engine.js, but as real tables with
-- constraints, row-level security, and a server-side "paid month" lock.
--
-- Model: one HOUSEHOLD (the family) owns workers, entries, offers, bonuses.
-- App users (auth.users) join a household as owner / editor / viewer.
--
-- Sync: the app works offline on its own copy and syncs with these tables
-- (web/src/sync.js). Every synced table has updated_at (set by the server) and every
-- delete leaves a row in `tombstones`, so phones can ask "what changed since X?".

create extension if not exists btree_gist with schema extensions;

-- ───────────────────────── households & membership ─────────────────────────
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(name) between 1 and 60),
  timezone    text not null default 'Asia/Manila',
  -- presets, lunch rules, default bonus, rd_default ... (same keys as engine.js settings)
  settings    jsonb not null default '{}'::jsonb,
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 8)),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'editor', 'viewer');

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         public.member_role not null default 'viewer',
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on public.household_members (user_id);

-- security definer so RLS policies can call it without recursing into household_members' own RLS
create or replace function public.has_role(hh uuid, roles public.member_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = hh and m.user_id = auth.uid() and m.role = any(roles)
  )
$$;
create or replace function public.can_read(hh uuid) returns boolean language sql stable as
  $$ select public.has_role(hh, array['owner','editor','viewer']::public.member_role[]) $$;
create or replace function public.can_write(hh uuid) returns boolean language sql stable as
  $$ select public.has_role(hh, array['owner','editor']::public.member_role[]) $$;

-- ───────────────────────────── workers & rates ─────────────────────────────
create table public.workers (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name         text not null check (length(trim(name)) between 1 and 40),
  color        text not null default '#4169A1' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  active       boolean not null default true,
  owner        boolean not null default false,                   -- the account owner (e.g. the sister whose job it is)
  user_id      uuid references auth.users(id) on delete set null,  -- optional: the worker's own login
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index workers_name_uq on public.workers (household_id, lower(name));

create table public.worker_rates (
  worker_id      uuid not null references public.workers(id) on delete cascade,
  household_id   uuid not null references public.households(id) on delete cascade,
  effective_from date not null,
  rate           numeric not null check (rate >= 0),
  updated_at     timestamptz not null default now(),
  primary key (worker_id, effective_from)
);

-- ──────────────────────────────── OT offers ────────────────────────────────
create table public.ot_offers (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  start_date     date not null,
  end_date       date not null,
  cap_hours      numeric check (cap_hours between 0.25 and 24),     -- null = no per-day limit
  min_hours      numeric check (min_hours >= 0),                    -- null = hours count toward the MONTH's minimum
  qualified_rate numeric not null check (qualified_rate >= 0),
  below_min_rate numeric check (below_min_rate >= 0),
  tier_mode      text not null default 'whole' check (tier_mode in ('whole','marginal')),
  day_caps       jsonb not null default '{}'::jsonb,    -- {"2026-11-03": 2.5}
  notes          text,
  updated_at     timestamptz not null default now(),
  check (start_date <= end_date),
  -- replaces the JS "These dates overlap the offer ..." check, and can't be raced
  exclude using gist (household_id with =, daterange(start_date, end_date, '[]') with &&)
);

-- ───────────────────────────────── entries ─────────────────────────────────
-- one row per worker per day; (worker_id, date) is the key so two phones that log the
-- same worker/day offline end up editing the same row instead of creating two.
create table public.entries (
  id                   uuid not null default gen_random_uuid(),
  household_id         uuid not null references public.households(id) on delete cascade,
  worker_id            uuid not null references public.workers(id) on delete cascade,
  date                 date not null,
  status               text not null check (status in ('worked','rd','not_worked','training','rdot')),
  time_in              time,
  time_out             time,
  lunch_min            numeric check (lunch_min between 0 and 600),
  ot_hours             numeric not null default 0 check (ot_hours between 0 and 24),
  ot_start             time,
  ot_end               time,
  ot_position          text check (ot_position in ('before','after','custom')),
  ot_offer_id          uuid references public.ot_offers(id) on delete restrict,
  rate_override        numeric check (rate_override >= 0),
  rate_override_reason text,
  remark               text,
  updated_at           timestamptz not null default now(),
  updated_by           uuid default auth.uid(),
  primary key (worker_id, date),
  -- timed statuses need both times; rest/not-worked days must not carry times
  check ((status in ('worked','training','rdot')) = (time_in is not null and time_out is not null)),
  check (time_in is null or time_in <> time_out),
  check (rate_override is null or length(trim(coalesce(rate_override_reason,''))) > 0)
);
create index on public.entries (household_id, date);

create table public.account_days (
  household_id  uuid not null references public.households(id) on delete cascade,
  date          date not null,
  company_hours numeric check (company_hours between 0 and 48),
  lunch_hours   numeric check (lunch_hours between 0 and 12),
  note          text,
  day_off       text check (day_off in ('leave')),                 -- the account did not work (e.g. ate's leave)
  updated_at    timestamptz not null default now(),
  primary key (household_id, date)
);

-- month settings: rest days, shift time, and the month's OT minimum / rate (they change month to month)
create table public.schedules (
  household_id uuid not null references public.households(id) on delete cascade,
  month        char(7) not null check (month ~ '^\d{4}-\d{2}$'),
  weekdays     smallint[] not null check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  shift_start  time,
  shift_end    time,
  ot_min       numeric check (ot_min >= 0),
  ot_rate      numeric check (ot_rate >= 0),
  updated_at   timestamptz not null default now(),
  primary key (household_id, month)
);

create table public.bonuses (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  worker_id    uuid not null references public.workers(id) on delete cascade,
  review_date  date not null,
  pay_month    char(7) not null check (pay_month ~ '^\d{4}-\d{2}$'),
  reference    text,
  note         text,
  chat_time    time,
  amount       numeric not null check (amount between 0 and 10000),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.bonuses (household_id, pay_month);

-- ─────────────────────────── payouts (paid months) ───────────────────────────
-- Replaces S.paid. `snapshot` freezes the month's computed report at the moment it
-- was marked paid, so later rate / offer / lunch-setting changes can't silently
-- rewrite a month that has already been paid out.
create table public.payouts (
  household_id uuid not null references public.households(id) on delete cascade,
  worker_id    uuid not null references public.workers(id) on delete cascade,
  month        char(7) not null check (month ~ '^\d{4}-\d{2}$'),
  total        numeric(12,2) not null,
  snapshot     jsonb not null,
  paid_at      timestamptz not null default now(),
  paid_by      uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  primary key (worker_id, month)
);

-- what was deleted, so other phones can delete it too
create table public.tombstones (
  household_id uuid not null references public.households(id) on delete cascade,
  tbl          text not null,
  key          text not null,
  deleted_at   timestamptz not null default now(),
  primary key (household_id, tbl, key)
);
create index on public.tombstones (household_id, deleted_at);

-- ─────────────────────────────── triggers ───────────────────────────────
create or replace function public.is_paid(w uuid, m text) returns boolean
language sql stable as $$ select exists (select 1 from public.payouts p where p.worker_id = w and p.month = m) $$;

-- entries / bonuses inside a paid month are read-only (server-side version of the JS 409)
create or replace function public.guard_paid_month() returns trigger language plpgsql as $$
declare m text;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.households where id = old.household_id) then return old; end if;
  if tg_op in ('UPDATE','DELETE') then
    if tg_table_name = 'bonuses' then m := old.pay_month; else m := to_char(old.date, 'YYYY-MM'); end if;
    if public.is_paid(old.worker_id, m) then
      raise exception 'Month % is marked paid for this worker. Unmark it to edit.', m using errcode = 'P0409';
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    if tg_table_name = 'bonuses' then m := new.pay_month; else m := to_char(new.date, 'YYYY-MM'); end if;
    if public.is_paid(new.worker_id, m) then
      raise exception 'Month % is marked paid for this worker. Unmark it to edit.', m using errcode = 'P0409';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_table_name = 'entries' then new.updated_by := auth.uid(); end if;
  return new;
end $$;
create trigger entries_paid_guard before insert or update or delete on public.entries
  for each row execute function public.guard_paid_month();
create trigger bonuses_paid_guard before insert or update or delete on public.bonuses
  for each row execute function public.guard_paid_month();

-- a rate change may not reach back into a month that is already paid
create or replace function public.guard_rate_change() returns trigger language plpgsql as $$
declare w uuid := coalesce(new.worker_id, old.worker_id);
        d date := least(coalesce(new.effective_from, old.effective_from), coalesce(old.effective_from, new.effective_from));
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.households where id = old.household_id) then return old; end if;
  if exists (select 1 from public.payouts p where p.worker_id = w and p.month >= to_char(d, 'YYYY-MM')) then
    raise exception 'This rate change would alter a month that is already paid (from %).', d using errcode = 'P0409';
  end if;
  return coalesce(new, old);
end $$;
create trigger worker_rates_paid_guard before insert or update or delete on public.worker_rates
  for each row execute function public.guard_rate_change();

-- updated_at is always the SERVER's clock (phones' clocks can't be trusted for sync)
create or replace function public.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- the key the app uses for each table; must match KEYS in web/src/sync.js
create or replace function public.row_key(t text, r jsonb) returns text language sql immutable as $$
  select case t
    when 'worker_rates' then (r->>'worker_id') || '|' || (r->>'effective_from')
    when 'entries'      then (r->>'worker_id') || '|' || (r->>'date')
    when 'account_days' then r->>'date'
    when 'schedules'    then r->>'month'
    when 'payouts'      then (r->>'month') || '|' || (r->>'worker_id')
    else r->>'id' end
$$;
create or replace function public.tombstone() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- skip when the whole household is being deleted (cascade)
  if not exists (select 1 from households where id = old.household_id) then return old; end if;
  insert into tombstones (household_id, tbl, key) values (old.household_id, tg_table_name, row_key(tg_table_name, to_jsonb(old)))
  on conflict (household_id, tbl, key) do update set deleted_at = now();
  return old;
end $$;
-- re-creating something that was deleted clears its tombstone
create or replace function public.untombstone() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from tombstones where household_id = new.household_id and tbl = tg_table_name and key = row_key(tg_table_name, to_jsonb(new));
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['workers','worker_rates','ot_offers','entries','account_days','schedules','bonuses','payouts'] loop
    execute format('create trigger %1$s_touch before insert or update on public.%1$s for each row execute function public.touch()', t);
    execute format('create trigger %1$s_tomb after delete on public.%1$s for each row execute function public.tombstone()', t);
    execute format('create trigger %1$s_untomb after insert on public.%1$s for each row execute function public.untombstone()', t);
  end loop;
end $$;
create trigger households_touch before update on public.households for each row execute function public.touch();

-- ─────────────────────────── row-level security ───────────────────────────
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.workers           enable row level security;
alter table public.worker_rates      enable row level security;
alter table public.ot_offers         enable row level security;
alter table public.entries           enable row level security;
alter table public.account_days      enable row level security;
alter table public.schedules         enable row level security;
alter table public.bonuses           enable row level security;
alter table public.payouts           enable row level security;
alter table public.tombstones        enable row level security;
create policy tomb_read on public.tombstones for select using (public.can_read(household_id));

create policy hh_read   on public.households for select using (public.can_read(id));
create policy hh_update on public.households for update using (public.has_role(id, array['owner']::public.member_role[]));

create policy mem_read  on public.household_members for select using (public.can_read(household_id));
create policy mem_admin on public.household_members for all
  using (public.has_role(household_id, array['owner']::public.member_role[]))
  with check (public.has_role(household_id, array['owner']::public.member_role[]));

-- same pair of policies on every household-scoped table
do $$
declare t text;
begin
  foreach t in array array['workers','worker_rates','ot_offers','entries','account_days','schedules','bonuses','payouts'] loop
    execute format('create policy %1$s_read  on public.%1$s for select using (public.can_read(household_id))', t);
    execute format('create policy %1$s_write on public.%1$s for all using (public.can_write(household_id)) with check (public.can_write(household_id))', t);
  end loop;
end $$;

-- ─────────────────────────────── RPCs ───────────────────────────────
-- New household + make the caller its owner, in one step (avoids the chicken-and-egg RLS problem).
create or replace function public.create_household(p_name text, p_timezone text default 'Asia/Manila')
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into households (name, timezone) values (p_name, p_timezone) returning id into hh;
  insert into household_members (household_id, user_id, role) values (hh, auth.uid(), 'owner');
  return hh;
end $$;

-- Join a family with the code the owner shares (Settings > Family sync). New members can edit.
create or replace function public.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare hh uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select id into hh from households where invite_code = upper(trim(p_code));
  if hh is null then raise exception 'That code is not valid'; end if;
  insert into household_members (household_id, user_id, role) values (hh, auth.uid(), 'editor')
  on conflict (household_id, user_id) do nothing;
  return hh;
end $$;

-- Owner can issue a new code (e.g. after someone leaves).
create or replace function public.new_invite_code(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text := upper(substr(md5(gen_random_uuid()::text), 1, 8));
begin
  if not has_role(p_household, array['owner']::member_role[]) then raise exception 'Only the owner can do that'; end if;
  update households set invite_code = c where id = p_household;
  return c;
end $$;

-- Keep a free-tier project awake: a scheduled GitHub Action can call this once a day.
create or replace function public.ping() returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.ping() to anon;
