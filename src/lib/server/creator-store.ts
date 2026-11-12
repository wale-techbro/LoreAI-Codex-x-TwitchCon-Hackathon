import { getSupabaseAdmin } from "./supabase.ts";

export type CreatorTokenRecord = {
  accountId: string;
  twitchUserId: string;
  twitchLogin: string;
  scopes: string[];
  expiresAt: string | null;
  connectionVersion: number;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
};

export type ConnectedCreatorChannel = CreatorTokenRecord & {
  channelId: string;
  channelLogin: string;
};

export async function connectTwitchCreator(input: {
  twitchUserId: string;
  twitchLogin: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  scopes: string[];
  expiresAt: string;
}): Promise<{ accountId: string; channelId: string }> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Twitch connections require Supabase.");
  const { data, error } = await client.rpc("connect_twitch_creator", {
    p_twitch_user_id: input.twitchUserId,
    p_twitch_login: input.twitchLogin,
    p_access_token_encrypted: input.accessTokenEncrypted,
    p_refresh_token_encrypted: input.refreshTokenEncrypted,
    p_scopes: input.scopes,
    p_expires_at: input.expiresAt
  });
  if (error) throw new Error(`Could not save the Twitch creator connection: ${error.message}`);
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.creator_account_id || !result?.channel_id) {
    throw new Error("Could not save the Twitch creator connection: the database returned no account.");
  }
  return { accountId: result.creator_account_id as string, channelId: result.channel_id as string };
}

export async function getCreatorTokenRecord(accountId: string): Promise<CreatorTokenRecord | null> {
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client.from("creator_accounts")
    .select("id,twitch_user_id,twitch_login,scopes,expires_at,connection_version,access_token_encrypted,refresh_token_encrypted")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error(`Could not load the Twitch creator connection: ${error.message}`);
  if (!data?.access_token_encrypted || !data.refresh_token_encrypted) return null;
  return {
    accountId: data.id as string,
    twitchUserId: data.twitch_user_id as string,
    twitchLogin: data.twitch_login as string,
    scopes: (data.scopes ?? []) as string[],
    expiresAt: (data.expires_at as string | null) ?? null,
    connectionVersion: Number(data.connection_version),
    accessTokenEncrypted: data.access_token_encrypted as string,
    refreshTokenEncrypted: data.refresh_token_encrypted as string
  };
}

export async function persistTwitchCreatorTokens(input: {
  accountId: string;
  connectionVersion: number;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string;
  scopes: string[];
  expiresAt: string;
}): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Twitch token storage requires Supabase.");
  const { error } = await client.rpc("update_twitch_creator_tokens", {
    p_creator_account_id: input.accountId,
    p_connection_version: input.connectionVersion,
    p_access_token_encrypted: input.accessTokenEncrypted,
    p_refresh_token_encrypted: input.refreshTokenEncrypted,
    p_scopes: input.scopes,
    p_expires_at: input.expiresAt
  });
  if (error) throw new Error(`Could not rotate the Twitch creator tokens: ${error.message}`);
}

export async function disconnectTwitchCreator(accountId: string): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Twitch connections require Supabase.");
  const { error } = await client.rpc("disconnect_twitch_creator", { p_creator_account_id: accountId });
  if (error) throw new Error(`Could not disconnect the Twitch creator: ${error.message}`);
}

export async function getConnectedCreatorChannels(): Promise<ConnectedCreatorChannel[]> {
  const client = getSupabaseAdmin();
  if (!client) return [];
  const { data: creators, error: creatorsError } = await client.from("creator_accounts")
    .select("id,twitch_user_id,twitch_login,scopes,expires_at,connection_version,access_token_encrypted,refresh_token_encrypted")
    .not("access_token_encrypted", "is", null)
    .not("refresh_token_encrypted", "is", null);
  if (creatorsError) throw new Error(`Could not list connected Twitch creators: ${creatorsError.message}`);

  const channels: ConnectedCreatorChannel[] = [];
  for (const creator of creators ?? []) {
    const { data: channel, error: channelError } = await client.from("channels")
      .select("id,login")
      .eq("creator_account_id", creator.id)
      .maybeSingle();
    if (channelError) throw new Error(`Could not load a connected creator channel: ${channelError.message}`);
    if (!channel) continue;
    channels.push({
      accountId: creator.id as string,
      twitchUserId: creator.twitch_user_id as string,
      twitchLogin: creator.twitch_login as string,
      scopes: (creator.scopes ?? []) as string[],
      expiresAt: (creator.expires_at as string | null) ?? null,
      connectionVersion: Number(creator.connection_version),
      accessTokenEncrypted: creator.access_token_encrypted as string,
      refreshTokenEncrypted: creator.refresh_token_encrypted as string,
      channelId: channel.id as string,
      channelLogin: channel.login as string
    });
  }
  return channels;
}

export async function claimAskLoreRequest(input: {
  channelId: string;
  chatterUserId: string;
  twitchMessageId: string;
}): Promise<boolean> {
  const client = getSupabaseAdmin();
  if (!client) return true;
  const { data, error } = await client.rpc("claim_asklore_request", {
    p_channel_id: input.channelId,
    p_chatter_user_id: input.chatterUserId,
    p_twitch_message_id: input.twitchMessageId
  });
  if (error) throw new Error(`Could not claim the !asklore request: ${error.message}`);
  return data === true;
}
