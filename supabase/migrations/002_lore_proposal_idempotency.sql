create or replace function public.create_lore_proposal_once(
  p_channel_id uuid,
  p_twitch_message_id text,
  p_title text,
  p_summary text,
  p_source_message_ids uuid[]
)
returns setof public.lore_entries
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_source_message_id uuid;
  v_existing public.lore_entries%rowtype;
begin
  if p_twitch_message_id is null or pg_catalog.btrim(p_twitch_message_id) = '' then
    raise exception 'Twitch message ID is required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_channel_id::text || ':' || p_twitch_message_id, 0)
  );

  select message.id
    into v_source_message_id
    from public.chat_messages as message
   where message.channel_id = p_channel_id
     and message.twitch_message_id = p_twitch_message_id;

  if not found then
    raise exception 'Source chat message was not saved';
  end if;

  if not (coalesce(p_source_message_ids, array[]::uuid[]) @> array[v_source_message_id]::uuid[]) then
    raise exception 'Source message list must include the triggering Twitch message';
  end if;

  select entry.*
    into v_existing
    from public.lore_entries as entry
   where entry.channel_id = p_channel_id
     and entry.source_message_ids @> array[v_source_message_id]::uuid[]
   order by entry.created_at, entry.id
   limit 1;

  if found then
    return next v_existing;
    return;
  end if;

  insert into public.lore_entries (
    channel_id,
    title,
    summary,
    status,
    source_message_ids
  ) values (
    p_channel_id,
    p_title,
    p_summary,
    'proposed',
    coalesce(p_source_message_ids, array[]::uuid[])
  ) returning * into v_existing;

  return next v_existing;
end;
$function$;

revoke all on function public.create_lore_proposal_once(uuid, text, text, text, uuid[]) from public;
revoke all on function public.create_lore_proposal_once(uuid, text, text, text, uuid[]) from anon, authenticated;
grant execute on function public.create_lore_proposal_once(uuid, text, text, text, uuid[]) to service_role;
