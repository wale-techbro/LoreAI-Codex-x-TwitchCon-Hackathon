create extension if not exists pgcrypto;

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  twitch_user_id text not null unique,
  login text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  twitch_message_id text not null unique,
  user_login text not null,
  user_name text not null,
  message_text text not null,
  sent_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_channel_sent_at_idx
  on public.chat_messages (channel_id, sent_at desc);

create table if not exists public.lore_entries (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete cascade,
  title text not null,
  summary text not null,
  status text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  source_message_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists lore_entries_channel_status_idx
  on public.lore_entries (channel_id, status, created_at desc);

alter table public.channels enable row level security;
alter table public.chat_messages enable row level security;
alter table public.lore_entries enable row level security;

-- Service-role access is server-only. Do not expose SUPABASE_SERVICE_ROLE_KEY to browser code.
