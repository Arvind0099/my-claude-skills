-- Telegram verification, for Postgres and Supabase. Run once; safe to run again.
-- user_id is text so it fits any user table. If the users table is in this database, change its type to match and add
-- "references your_users(id) on delete cascade", so deleting a user also removes their Telegram link.

create table if not exists telegram_accounts (
  tg_id bigint primary key,
  user_id text not null unique,
  first_name text,
  last_name text,
  username text,
  language_code text,
  is_premium boolean not null default false,
  phone text,
  phone_shared_at timestamptz,
  linked_via text not null default 'signup' check (linked_via in ('signup', 'link')),
  ip text,
  country text,
  city text,
  device text,
  verified_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists telegram_accounts_verified_idx on telegram_accounts(verified_at desc);

create table if not exists tg_logins (
  id uuid primary key,
  token_hash text not null unique,
  poll_hash text not null,
  fin_hash text unique,
  purpose text not null check (purpose in ('auth', 'reset', 'link')),
  user_id text,
  code smallint not null,
  options text not null,
  status text not null default 'new' check (status in ('new', 'asked', 'join', 'phone', 'verified', 'done', 'denied')),
  why text,
  tries smallint not null default 0,
  tg_id bigint,
  tg text,
  phone text,
  ip text,
  country text,
  city text,
  device text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  done_at timestamptz
);
create index if not exists tg_logins_recent_idx on tg_logins(created_at desc);
create index if not exists tg_logins_tg_idx on tg_logins(tg_id, created_at desc);
create index if not exists tg_logins_ip_idx on tg_logins(ip, created_at desc);

create table if not exists tg_config (
  key text primary key,
  value text not null default ''
);

-- Supabase: with row level security on and no policies, only the server's secret key can read these.
alter table telegram_accounts enable row level security;
alter table tg_logins enable row level security;
alter table tg_config enable row level security;
