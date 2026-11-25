-- Telegram verification, for Cloudflare D1 and SQLite. Safe to run again.
-- npx wrangler d1 execute <db> --remote --file=tg-verify.sql

create table if not exists telegram_accounts (
  tg_id integer primary key,
  user_id text not null unique,
  first_name text,
  last_name text,
  username text,
  language_code text,
  is_premium integer not null default 0,
  phone text,
  phone_shared_at text,
  linked_via text not null default 'signup' check (linked_via in ('signup', 'link')),
  ip text,
  country text,
  city text,
  device text,
  verified_at text not null,
  last_seen_at text not null
);
create index if not exists telegram_accounts_verified_idx on telegram_accounts(verified_at desc);

create table if not exists tg_logins (
  id text primary key,
  token_hash text not null unique,
  poll_hash text not null,
  fin_hash text unique,
  purpose text not null check (purpose in ('auth', 'reset', 'link')),
  user_id text,
  code integer not null,
  options text not null,
  status text not null default 'new' check (status in ('new', 'asked', 'join', 'phone', 'verified', 'done', 'denied')),
  why text,
  tries integer not null default 0,
  tg_id integer,
  tg text,
  phone text,
  ip text,
  country text,
  city text,
  device text,
  created_at text not null,
  expires_at text not null,
  verified_at text,
  done_at text
);
create index if not exists tg_logins_recent_idx on tg_logins(created_at desc);
create index if not exists tg_logins_tg_idx on tg_logins(tg_id, created_at desc);
create index if not exists tg_logins_ip_idx on tg_logins(ip, created_at desc);

create table if not exists tg_config (
  key text primary key,
  value text not null default ''
);
