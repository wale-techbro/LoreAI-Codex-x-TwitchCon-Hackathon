import { createHash, randomBytes } from "node:crypto";
import { getSupabaseAdmin } from "./supabase.ts";

export const CREATOR_SESSION_COOKIE = "lore_creator_session";
export const CREATOR_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type CreatorContext = {
  accountId: string;
  twitchUserId: string;
  twitchLogin: string;
  channelId: string;
  channelLogin: string;
  scopes: string[];
  connectedAt: string | null;
};

function sessionHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function readCookie(cookieHeader: string | null, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== cookieName) continue;
    return part.slice(separator + 1).trim() || null;
  }
  return null;
}

export async function createCreatorSession(accountId: string): Promise<string> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Creator sessions require Supabase.");

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + CREATOR_SESSION_TTL_SECONDS * 1000).toISOString();
  const { error } = await client.from("creator_sessions").insert({
    creator_account_id: accountId,
    session_hash: sessionHash(token),
    expires_at: expiresAt
  });
  if (error) throw new Error(`Could not create the creator session: ${error.message}`);
  return token;
}

export async function getCreatorContext(token: string | null | undefined): Promise<CreatorContext | null> {
  if (!token) return null;
  const client = getSupabaseAdmin();
  if (!client) return null;

  const { data: session, error: sessionError } = await client.from("creator_sessions")
    .select("creator_account_id")
    .eq("session_hash", sessionHash(token))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (sessionError) throw new Error(`Could not load the creator session: ${sessionError.message}`);
  if (!session) return null;

  const { data: account, error: accountError } = await client.from("creator_accounts")
    .select("id,twitch_user_id,twitch_login,scopes,connected_at,access_token_encrypted")
    .eq("id", session.creator_account_id)
    .maybeSingle();
  if (accountError) throw new Error(`Could not load the creator account: ${accountError.message}`);
  if (!account || !account.access_token_encrypted) return null;

  const { data: channel, error: channelError } = await client.from("channels")
    .select("id,login")
    .eq("creator_account_id", account.id)
    .maybeSingle();
  if (channelError) throw new Error(`Could not load the creator channel: ${channelError.message}`);
  if (!channel) return null;

  return {
    accountId: account.id as string,
    twitchUserId: account.twitch_user_id as string,
    twitchLogin: account.twitch_login as string,
    channelId: channel.id as string,
    channelLogin: channel.login as string,
    scopes: (account.scopes ?? []) as string[],
    connectedAt: (account.connected_at as string | null) ?? null
  };
}

export async function getCreatorContextFromRequest(request: Request): Promise<CreatorContext | null> {
  return getCreatorContext(readCookie(request.headers.get("cookie"), CREATOR_SESSION_COOKIE));
}

export async function getCreatorContextFromCookieHeader(cookieHeader: string | null): Promise<CreatorContext | null> {
  return getCreatorContext(readCookie(cookieHeader, CREATOR_SESSION_COOKIE));
}

export async function revokeCreatorSession(token: string | null | undefined): Promise<void> {
  if (!token) return;
  const client = getSupabaseAdmin();
  if (!client) return;
  const { error } = await client.from("creator_sessions").delete().eq("session_hash", sessionHash(token));
  if (error) throw new Error(`Could not revoke the creator session: ${error.message}`);
}

export async function revokeAllCreatorSessions(accountId: string): Promise<void> {
  const client = getSupabaseAdmin();
  if (!client) throw new Error("Creator sessions require Supabase.");
  const { error } = await client.from("creator_sessions").delete().eq("creator_account_id", accountId);
  if (error) throw new Error(`Could not revoke creator sessions: ${error.message}`);
}

export function getCreatorSessionToken(request: Request): string | null {
  return readCookie(request.headers.get("cookie"), CREATOR_SESSION_COOKIE);
}

export async function getPublicChannelByLogin(login: string): Promise<{ id: string; login: string } | null> {
  const canonicalLogin = login.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,25}$/.test(canonicalLogin)) return null;
  const client = getSupabaseAdmin();
  if (!client) return null;
  const { data, error } = await client.from("channels").select("id,login").eq("login", canonicalLogin).maybeSingle();
  if (error) throw new Error(`Could not load the public creator channel: ${error.message}`);
  return data ? { id: data.id as string, login: data.login as string } : null;
}
