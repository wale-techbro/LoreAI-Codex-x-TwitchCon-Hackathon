create table if not exists public.creator_accounts (
  id uuid primary key default gen_random_uuid(),
  twitch_user_id text not null unique,
  twitch_login text not null,
  access_token_encrypted text,
  refresh_token_encrypted text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  connected_at timestamptz,
  connection_version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint creator_accounts_token_pair_check check (
    (access_token_encrypted is null) = (refresh_token_encrypted is null)
  )
);

alter table public.channels
  add column if not exists creator_account_id uuid;

insert into public.creator_accounts (twitch_user_id, twitch_login)
select channel.twitch_user_id, channel.login
  from public.channels as channel
on conflict (twitch_user_id) do nothing;

update public.channels as channel
   set creator_account_id = creator.id
  from public.creator_accounts as creator
 where creator.twitch_user_id = channel.twitch_user_id
   and channel.creator_account_id is null;

do $migration$
begin
  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conname = 'channels_creator_account_id_fkey'
       and conrelid = 'public.channels'::regclass
  ) then
    alter table public.channels
      add constraint channels_creator_account_id_fkey
      foreign key (creator_account_id)
      references public.creator_accounts(id)
      on delete restrict;
  end if;
end;
$migration$;

alter table public.channels
  alter column creator_account_id set not null;

create unique index if not exists channels_creator_account_id_key
  on public.channels (creator_account_id);

alter table public.chat_messages
  add column if not exists chatter_user_id text;

create index if not exists chat_messages_channel_chatter_sent_at_idx
  on public.chat_messages (channel_id, chatter_user_id, sent_at desc);

create table if not exists public.creator_sessions (
  id uuid primary key default gen_random_uuid(),
  creator_account_id uuid not null references public.creator_accounts(id) on delete cascade,
  session_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists creator_sessions_account_expiry_idx
  on public.creator_sessions (creator_account_id, expires_at desc);

create table if not exists public.asklore_requests (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels(id) on delete restrict,
  chatter_user_id text not null,
  twitch_message_id text not null unique,
  created_at timestamptz not null default now()
);

create index if not exists asklore_requests_channel_created_at_idx
  on public.asklore_requests (channel_id, created_at desc);

create index if not exists asklore_requests_chatter_created_at_idx
  on public.asklore_requests (channel_id, chatter_user_id, created_at desc);

alter table public.creator_accounts enable row level security;
alter table public.creator_sessions enable row level security;
alter table public.asklore_requests enable row level security;

revoke all on table public.creator_accounts, public.creator_sessions, public.asklore_requests
  from anon, authenticated;
grant all on table public.creator_accounts, public.creator_sessions, public.asklore_requests
  to service_role;
revoke all on table public.channels, public.chat_messages, public.lore_entries
  from anon, authenticated;
grant all on table public.channels, public.chat_messages, public.lore_entries
  to service_role;

create or replace function public.connect_twitch_creator(
  p_twitch_user_id text,
  p_twitch_login text,
  p_access_token_encrypted text,
  p_refresh_token_encrypted text,
  p_scopes text[],
  p_expires_at timestamptz
)
returns table (creator_account_id uuid, channel_id uuid)
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_creator_id uuid;
  v_channel_id uuid;
begin
  insert into public.creator_accounts as creator (
    twitch_user_id,
    twitch_login,
    access_token_encrypted,
    refresh_token_encrypted,
    scopes,
    expires_at,
    connected_at,
    connection_version,
    updated_at
  ) values (
    p_twitch_user_id,
    p_twitch_login,
    p_access_token_encrypted,
    p_refresh_token_encrypted,
    coalesce(p_scopes, array[]::text[]),
    p_expires_at,
    pg_catalog.now(),
    1,
    pg_catalog.now()
  )
  on conflict (twitch_user_id) do update set
    twitch_login = excluded.twitch_login,
    access_token_encrypted = excluded.access_token_encrypted,
    refresh_token_encrypted = excluded.refresh_token_encrypted,
    scopes = excluded.scopes,
    expires_at = excluded.expires_at,
    connected_at = pg_catalog.now(),
    connection_version = creator.connection_version + 1,
    updated_at = pg_catalog.now()
  returning id into v_creator_id;

  insert into public.channels (twitch_user_id, login, creator_account_id)
  values (p_twitch_user_id, p_twitch_login, v_creator_id)
  on conflict (twitch_user_id) do update set
    login = excluded.login,
    creator_account_id = excluded.creator_account_id
  returning id into v_channel_id;

  return query select v_creator_id, v_channel_id;
end;
$function$;

create or replace function public.update_twitch_creator_tokens(
  p_creator_account_id uuid,
  p_connection_version bigint,
  p_access_token_encrypted text,
  p_refresh_token_encrypted text,
  p_scopes text[],
  p_expires_at timestamptz
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.creator_accounts
     set access_token_encrypted = p_access_token_encrypted,
         refresh_token_encrypted = p_refresh_token_encrypted,
         scopes = coalesce(p_scopes, array[]::text[]),
         expires_at = p_expires_at,
         updated_at = pg_catalog.now()
   where id = p_creator_account_id
     and connection_version = p_connection_version;
  if not found then
    raise exception 'Twitch creator account was not found';
  end if;
end;
$function$;

create or replace function public.disconnect_twitch_creator(
  p_creator_account_id uuid
)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update public.creator_accounts
     set access_token_encrypted = null,
         refresh_token_encrypted = null,
         scopes = array[]::text[],
         expires_at = null,
         connected_at = null,
         connection_version = connection_version + 1,
         updated_at = pg_catalog.now()
   where id = p_creator_account_id;
  if not found then
    raise exception 'Twitch creator account was not found';
  end if;
end;
$function$;

create or replace function public.claim_asklore_request(
  p_channel_id uuid,
  p_chatter_user_id text,
  p_twitch_message_id text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_request_id uuid;
  v_channel_count integer;
  v_chatter_count integer;
begin
  if not exists (
    select 1
      from public.chat_messages as message
     where message.channel_id = p_channel_id
       and message.twitch_message_id = p_twitch_message_id
       and message.chatter_user_id = p_chatter_user_id
  ) then
    raise exception 'Source chat message was not saved for this channel and chatter';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('asklore-rate:' || p_channel_id::text, 0)
  );

  insert into public.asklore_requests (channel_id, chatter_user_id, twitch_message_id)
  values (p_channel_id, p_chatter_user_id, p_twitch_message_id)
  on conflict (twitch_message_id) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    return false;
  end if;

  select pg_catalog.count(*)::integer,
         pg_catalog.count(*) filter (where request.chatter_user_id = p_chatter_user_id)::integer
    into v_channel_count, v_chatter_count
    from public.asklore_requests as request
   where request.channel_id = p_channel_id
     and request.created_at > pg_catalog.now() - interval '1 minute';

  return v_channel_count <= 20 and v_chatter_count <= 3;
end;
$function$;

revoke all on function public.connect_twitch_creator(text, text, text, text, text[], timestamptz)
  from public, anon, authenticated;
revoke all on function public.update_twitch_creator_tokens(uuid, bigint, text, text, text[], timestamptz)
  from public, anon, authenticated;
revoke all on function public.disconnect_twitch_creator(uuid)
  from public, anon, authenticated;
revoke all on function public.claim_asklore_request(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.connect_twitch_creator(text, text, text, text, text[], timestamptz)
  to service_role;
grant execute on function public.update_twitch_creator_tokens(uuid, bigint, text, text, text[], timestamptz)
  to service_role;
grant execute on function public.disconnect_twitch_creator(uuid)
  to service_role;
grant execute on function public.claim_asklore_request(uuid, text, text)
  to service_role;
