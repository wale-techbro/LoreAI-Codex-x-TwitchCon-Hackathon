import type { CreatorTokenRecord } from "./creator-store.ts";
import { connectTwitchCreator, persistTwitchCreatorTokens } from "./creator-store.ts";
import { decryptTwitchToken, encryptTwitchToken } from "./token-crypto.ts";
import { getTwitchCallbackUri } from "./app-origin.ts";

export const REQUIRED_TWITCH_SCOPES = ["user:read:chat", "user:write:chat"] as const;

type TwitchTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: string;
};

type TwitchValidation = {
  client_id: string;
  user_id: string;
  login: string;
  scopes: string[];
  expires_in: number;
};

function appConfig(requireRedirectUri = false) {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.TWITCH_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = requireRedirectUri ? getTwitchCallbackUri() : "";
  const missing = [
    ["TWITCH_CLIENT_ID", clientId],
    ["TWITCH_CLIENT_SECRET", clientSecret]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Twitch OAuth is not configured. Set ${missing.join(", ")}.`);
  return { clientId, clientSecret, redirectUri };
}

function parseTokenResponse(value: unknown): TwitchTokenResponse {
  if (typeof value !== "object" || value === null) throw new Error("Twitch returned an invalid token response.");
  const data = value as Partial<TwitchTokenResponse>;
  if (
    typeof data.access_token !== "string" || !data.access_token ||
    typeof data.refresh_token !== "string" || !data.refresh_token ||
    typeof data.expires_in !== "number" ||
    !Array.isArray(data.scope) || !data.scope.every((scope) => typeof scope === "string")
  ) throw new Error("Twitch returned an invalid token response.");
  return data as TwitchTokenResponse;
}

async function validateToken(accessToken: string): Promise<TwitchValidation | null> {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
    cache: "no-store"
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(`Twitch token validation failed (${response.status}).`);
  const value: unknown = await response.json();
  if (typeof value !== "object" || value === null) throw new Error("Twitch returned an invalid token validation response.");
  const validation = value as Partial<TwitchValidation>;
  if (
    typeof validation.client_id !== "string" ||
    typeof validation.user_id !== "string" ||
    typeof validation.login !== "string" ||
    !Array.isArray(validation.scopes) || !validation.scopes.every((scope) => typeof scope === "string") ||
    typeof validation.expires_in !== "number"
  ) throw new Error("Twitch returned an invalid token validation response.");
  return validation as TwitchValidation;
}

function validateIdentity(validation: TwitchValidation, expectedUserId?: string) {
  const { clientId } = appConfig();
  if (validation.client_id !== clientId) throw new Error("The Twitch token belongs to a different Twitch application.");
  if (!validation.user_id || !validation.login) throw new Error("Twitch did not return an authenticated user identity.");
  if (expectedUserId && validation.user_id !== expectedUserId) {
    throw new Error("The Twitch token identity does not match its connected creator account.");
  }
  if (!validation.scopes.includes("user:read:chat")) {
    throw new Error("The Twitch connection is missing the user:read:chat permission.");
  }
  if (!validation.scopes.includes("user:write:chat")) {
    throw new Error("The Twitch connection is missing the user:write:chat permission.");
  }
  return validation;
}

export async function exchangeTwitchAuthorizationCode(code: string) {
  const config = appConfig(true);
  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: config.redirectUri!
    }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error(`Twitch authorization code exchange failed (${response.status}).`);
  const tokens = parseTokenResponse(await response.json());
  const validation = await validateToken(tokens.access_token);
  if (!validation) throw new Error("Twitch returned an invalid access token.");
  const identity = validateIdentity(validation);
  const missingScopes = REQUIRED_TWITCH_SCOPES.filter((scope) => !identity.scopes.includes(scope));
  if (missingScopes.length) throw new Error(`Twitch authorization is missing the ${missingScopes.join(" and ")} permission. Reconnect and approve both requested permissions.`);

  const account = await connectTwitchCreator({
    twitchUserId: identity.user_id,
    twitchLogin: identity.login,
    accessTokenEncrypted: encryptTwitchToken(tokens.access_token),
    refreshTokenEncrypted: encryptTwitchToken(tokens.refresh_token),
    scopes: identity.scopes,
    expiresAt: new Date(Date.now() + identity.expires_in * 1000).toISOString()
  });
  return { account, login: identity.login, twitchUserId: identity.user_id, scopes: identity.scopes };
}

export type CreatorTwitchAuth = ReturnType<typeof createCreatorTwitchAuth> extends Promise<infer T> ? T : never;

export async function createCreatorTwitchAuth(record: CreatorTokenRecord) {
  const config = appConfig();
  let accessToken = decryptTwitchToken(record.accessTokenEncrypted);
  let refreshToken = decryptTwitchToken(record.refreshTokenEncrypted);
  let refreshInProgress: Promise<void> | null = null;

  async function persistTokens(tokens: TwitchTokenResponse, validation: TwitchValidation) {
    accessToken = tokens.access_token;
    refreshToken = tokens.refresh_token;
    await persistTwitchCreatorTokens({
      accountId: record.accountId,
      connectionVersion: record.connectionVersion,
      accessTokenEncrypted: encryptTwitchToken(accessToken),
      refreshTokenEncrypted: encryptTwitchToken(refreshToken),
      scopes: validation.scopes,
      expiresAt: new Date(Date.now() + validation.expires_in * 1000).toISOString()
    });
  }

  async function refreshTokens() {
    if (!refreshToken) throw new Error("The Twitch creator connection has no refresh token. Reconnect Twitch.");
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken
      }),
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Twitch token refresh failed (${response.status}). Reconnect the creator account if this continues.`);
    const tokens = parseTokenResponse(await response.json());
    const validation = await validateToken(tokens.access_token);
    if (!validation) throw new Error("The refreshed Twitch access token is invalid.");
    const identity = validateIdentity(validation, record.twitchUserId);
    await persistTokens(tokens, identity);
  }

  async function refreshAccessToken() {
    if (!refreshInProgress) {
      refreshInProgress = refreshTokens().finally(() => { refreshInProgress = null; });
    }
    await refreshInProgress;
  }

  async function validateOrRefresh() {
    let validation = await validateToken(accessToken);
    if (!validation) {
      await refreshAccessToken();
      validation = await validateToken(accessToken);
    }
    if (!validation) throw new Error("The Twitch access token is invalid after refresh.");
    return validateIdentity(validation, record.twitchUserId);
  }

  async function getAccessToken() {
    return accessToken;
  }

  return { getAccessToken, refreshAccessToken, validateOrRefresh };
}

export async function revokeTwitchAccessToken(accessToken: string): Promise<void> {
  const clientId = appConfig().clientId;
  const response = await fetch("https://id.twitch.tv/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, token: accessToken }),
    cache: "no-store"
  });
  if (response.ok || response.status === 400) return;
  throw new Error(`Twitch token revocation failed (${response.status}).`);
}
