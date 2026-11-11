-- manhunt. schema. Run once in the Supabase SQL editor (or `supabase db push`).
-- All tables are private: Row Level Security is enabled with NO policies, so the anon/public key
-- cannot read or write anything. Only the server (DATABASE_URL / service role) touches these tables.

create table if not exists games (
  id          text primary key,
  code        char(6) not null unique,
  simulation  boolean not null default false,
  state       jsonb not null,
  version     integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists games_expires_idx on games (expires_at);

-- Photo hints. Deleted automatically with their game.
create table if not exists photos (
  game_id    text not null references games(id) on delete cascade,
  id         text not null,
  mime       text not null,
  bytes      bytea not null,
  created_at timestamptz not null default now(),
  primary key (game_id, id)
);

create table if not exists rate_limits (
  key          text primary key,
  window_start timestamptz not null,
  count        integer not null
);

alter table games enable row level security;
alter table photos enable row level security;
alter table rate_limits enable row level security;
