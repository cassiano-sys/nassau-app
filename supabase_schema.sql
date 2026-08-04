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

-- Enable Row Level Security
alter table rounds        enable row level security;
alter table round_players enable row level security;

-- Policies: anyone authenticated can read all rounds (for ranking)
create policy "Anyone can read rounds"
  on rounds for select using (auth.role() = 'authenticated');

create policy "Users can insert their rounds"
  on rounds for insert with check (auth.uid() = user_id);

create policy "Anyone can read round_players"
  on round_players for select using (auth.role() = 'authenticated');

create policy "Users can insert round_players"
  on round_players for insert with check (
    exists (select 1 from rounds where id = round_id and user_id = auth.uid())
  );

-- Indexes for performance
create index if not exists idx_rounds_user_id    on rounds(user_id);
create index if not exists idx_rounds_played_at  on rounds(played_at desc);
create index if not exists idx_rp_round_id       on round_players(round_id);
create index if not exists idx_rp_user_id        on round_players(user_id);
create index if not exists idx_rp_player_name    on round_players(player_name);
