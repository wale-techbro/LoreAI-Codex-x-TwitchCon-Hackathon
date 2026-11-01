import { randomUUID } from "node:crypto";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

type TwitchValidation = {
  client_id: string;
  user_id: string;
  login: string;
  scopes: string[];
  expires_in: number;
};

type TwitchTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string[];
  token_type: string;
};

type TokenState = {
  accessToken: string;
  refreshToken: string;
};

const tokenStatePath = join(process.cwd(), ".twitch-token-state.json");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function readSavedTokenState(): Promise<TokenState | null> {
  try {
    const contents = await readFile(tokenStatePath, "utf8");
    const value: unknown = JSON.parse(contents);
    if (
      !isRecord(value) ||
      typeof value.accessToken !== "string" ||
      typeof value.refreshToken !== "string" ||
      !value.accessToken ||
      !value.refreshToken
    ) {
      throw new Error("Saved Twitch token state is invalid. Remove the local token state file and configure Twitch tokens again.");
    }
    return { accessToken: value.accessToken, refreshToken: value.refreshToken };
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") return null;
    throw error;
  }
}

async function saveTokenState(state: TokenState): Promise<void> {
  const temporaryPath = `${tokenStatePath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await rename(temporaryPath, tokenStatePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

function parseRefreshResponse(value: unknown): TwitchTokenResponse {
  if (
    !isRecord(value) ||
    typeof value.access_token !== "string" ||
    typeof value.refresh_token !== "string" ||
    typeof value.expires_in !== "number" ||
    !Array.isArray(value.scope) ||
    !value.scope.every((scope) => typeof scope === "string") ||
    typeof value.token_type !== "string"
  ) {
    throw new Error("Twitch token refresh returned an invalid response.");
  }
  return value as TwitchTokenResponse;
}

export async function createTwitchAuth() {
  const clientId = process.env.TWITCH_CLIENT_ID?.trim() ?? "";
  const clientSecret = process.env.TWITCH_CLIENT_SECRET;
  const savedState = await readSavedTokenState();
  let accessToken = savedState?.accessToken ?? process.env.TWITCH_ACCESS_TOKEN?.trim() ?? "";
  let refreshToken = savedState?.refreshToken ?? process.env.TWITCH_REFRESH_TOKEN?.trim() ?? "";
  let refreshInProgress: Promise<void> | null = null;

  if (!clientId) throw new Error("TWITCH_CLIENT_ID is required.");
  if (refreshToken && !clientSecret) {
    throw new Error("TWITCH_CLIENT_SECRET is required when TWITCH_REFRESH_TOKEN is configured.");
  }

  async function persistCurrentTokens(): Promise<void> {
    await saveTokenState({ accessToken, refreshToken });
  }

  async function performTokenRefresh(): Promise<void> {
    if (!refreshToken) throw new Error("Twitch access token is invalid and TWITCH_REFRESH_TOKEN is not configured.");
    if (!clientSecret) throw new Error("TWITCH_CLIENT_SECRET is required to refresh the Twitch access token.");

    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken
    });
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      throw new Error(`Twitch token refresh failed (${response.status}). Reauthorize the broadcaster account.`);
    }

    const refreshed = parseRefreshResponse(await response.json());
    accessToken = refreshed.access_token;
    refreshToken = refreshed.refresh_token;
    await persistCurrentTokens();
  }

  async function refreshAccessToken(): Promise<void> {
    if (!refreshInProgress) {
      refreshInProgress = performTokenRefresh().finally(() => {
        refreshInProgress = null;
      });
    }
    await refreshInProgress;
  }

  async function validateAccessToken(): Promise<TwitchValidation | null> {
    if (!accessToken) return null;
    const response = await fetch("https://id.twitch.tv/oauth2/validate", {
      headers: { Authorization: `OAuth ${accessToken}` }
    });
    if (response.status === 401) return null;
    if (!response.ok) throw new Error(`Twitch token validation failed (${response.status}).`);
    const value: unknown = await response.json();
    if (
      !isRecord(value) ||
      typeof value.client_id !== "string" ||
      typeof value.user_id !== "string" ||
      typeof value.login !== "string" ||
      !Array.isArray(value.scopes) ||
      !value.scopes.every((scope) => typeof scope === "string") ||
      typeof value.expires_in !== "number"
    ) {
      throw new Error("Twitch token validation returned an invalid response.");
    }
    return value as TwitchValidation;
  }

  function validateIdentity(validation: TwitchValidation): void {
    if (validation.client_id !== clientId) {
      throw new Error("TWITCH_ACCESS_TOKEN belongs to a different Twitch application than TWITCH_CLIENT_ID.");
    }
    if (!validation.scopes.includes("user:read:chat")) {
      throw new Error("TWITCH_ACCESS_TOKEN needs the user:read:chat scope.");
    }
  }

  async function validateOrRefresh(): Promise<TwitchValidation> {
    let validation = await validateAccessToken();
    if (!validation) {
      await refreshAccessToken();
      validation = await validateAccessToken();
    }
    if (!validation) throw new Error("Twitch access token is still invalid after refresh.");
    validateIdentity(validation);
    return validation;
  }

  async function getAccessToken(): Promise<string> {
    if (!accessToken) await refreshAccessToken();
    return accessToken;
  }

  return { getAccessToken, refreshAccessToken, validateOrRefresh };
}
