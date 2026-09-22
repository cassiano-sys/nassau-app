-- Nassau App Database Schema
-- Paste this in Supabase SQL Editor and run

-- Rounds table
create table if not exists rounds (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  format      text not null default 'nassau',
  course_name text not null default 'Campo',
  course_id   text,
  played_at   timestamptz not null default now(),
  bet_values  jsonb,
  num_players int not null default 4,
  created_at  timestamptz default now()
);

-- Round players table
create table if not exists round_players (
  id           uuid default gen_random_uuid() primary key,
  round_id     uuid references rounds(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  player_name  text not null,
  handicap     int not null default 0,
  gross_scores jsonb,
  money_result numeric default 0,
  team         text default 'A',
  created_at   timestamptz default now()
);

-- Round matchups table (individual and team head-to-head results per round,
-- used for the exact H2H ranking; needed by round_matchups inserts in
-- ScorecardScreen.jsx and reads in HistoryScreen.jsx's RankingScreen)
create table if not exists round_matchups (
  id          uuid default gen_random_uuid() primary key,
  round_id    uuid references rounds(id) on delete cascade,
  type        text not null default 'individual', -- 'individual' | 'team'
  player_a    text not null,
  player_b    text not null,
  team_a      text,  -- only set when type = 'team' (e.g. "Ana/Bruno")
  team_b      text,  -- only set when type = 'team'
  result_a    numeric default 0,  -- amount A won from B (negative = A lost)
  result_b    numeric default 0,  -- always -result_a
  front_a     numeric default 0,
  back_a      numeric default 0,
  total_a     numeric default 0,
  created_at  timestamptz default now()
);

-- Enable Row Level Security
alter table rounds          enable row level security;
alter table round_players   enable row level security;
alter table round_matchups  enable row level security;

-- Visibility rule: a round is visible to a user if they created it (rounds
-- .user_id = auth.uid(), so whoever entered/owns the scorecard can always see
-- and manage it, even for rounds where they only typed in other people's
-- names) OR if their own first name matches one of the players recorded in
-- that round (so someone else's round they actually played in also shows up
-- for them, even if a friend was the one holding the phone). Rounds/players/
-- matchups that don't meet either condition are invisible — this is what
-- keeps Ranking and History scoped to "people you've actually played with"
-- instead of every round ever entered by any app user.
--
-- This check is done through a SECURITY DEFINER helper function rather than
-- each table's policy directly querying the other table. A first attempt had
-- rounds' policy query round_players and round_players' policy query rounds
-- back — Postgres detects that mutual reference as recursive ("infinite
-- recursion detected in policy", error 42P17) and refuses the query entirely
-- (this is what caused Ranking/History to briefly show nothing for everyone,
-- including the round's own owner). A SECURITY DEFINER function runs with
-- its owner's privileges, and table owners bypass RLS by default in Postgres,
-- so the function's internal queries don't re-trigger these same policies —
-- breaking the cycle.

drop policy if exists "Anyone can read rounds" on rounds;
drop policy if exists "Anyone can read round_players" on round_players;
drop policy if exists "Anyone authenticated can read matchups" on round_matchups;
drop policy if exists "Anyone can read round_matchups" on round_matchups;

create or replace function public.can_see_round(target_round_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from rounds r
    where r.id = target_round_id and r.user_id = auth.uid()
  )
  or exists (
    select 1 from round_players rp
    where rp.round_id = target_round_id
      and lower(split_part(rp.player_name, ' ', 1))
        = lower(split_part(coalesce(auth.jwt() -> 'user_metadata' ->> 'full_name', ''), ' ', 1))
  );
$$;

grant execute on function public.can_see_round(uuid) to authenticated, anon;

create policy "Read rounds you created or played in"
  on rounds for select using ( public.can_see_round(id) );

create policy "Users can insert their rounds"
  on rounds for insert with check (auth.uid() = user_id);

create policy "Read round_players of rounds you created or played in"
  on round_players for select using ( public.can_see_round(round_id) );

create policy "Users can insert round_players"
  on round_players for insert with check (
    exists (select 1 from rounds where id = round_id and user_id = auth.uid())
  );

create policy "Read round_matchups of rounds you created or played in"
  on round_matchups for select using ( public.can_see_round(round_id) );

create policy "Users can insert round_matchups"
  on round_matchups for insert with check (
    exists (select 1 from rounds where id = round_id and user_id = auth.uid())
  );

-- Indexes for performance
create index if not exists idx_rounds_user_id    on rounds(user_id);
create index if not exists idx_rounds_played_at  on rounds(played_at desc);
create index if not exists idx_rp_round_id       on round_players(round_id);
create index if not exists idx_rp_user_id        on round_players(user_id);
create index if not exists idx_rp_player_name    on round_players(player_name);
create index if not exists idx_rm_round_id       on round_matchups(round_id);
create index if not exists idx_rm_type           on round_matchups(type);
