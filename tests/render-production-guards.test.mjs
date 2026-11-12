import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionSupabaseConfigured } from "../src/lib/server/store.ts";
import { decryptTwitchToken, encryptTwitchToken } from "../src/lib/server/token-crypto.ts";
import { createCreatorTwitchAuth, REQUIRED_TWITCH_SCOPES } from "../src/lib/server/twitch-oauth.ts";

async function withEnvironment(values, run) {
  const originals = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === null) delete process.env[key];
      else process.env[key] = value;
    }
    await run();
  } finally {
    for (const [key, value] of originals) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("Twitch OAuth requests reader and sender chat scopes", () => {
  assert.deepEqual(REQUIRED_TWITCH_SCOPES, ["user:read:chat", "user:write:chat"]);
});

test("creator Twitch tokens encrypt and decrypt with the configured 256-bit key", async () => {
  const key = "0123456789abcdef".repeat(4);
  await withEnvironment({ TWITCH_TOKEN_ENCRYPTION_KEY: key }, async () => {
    const token = "unit-test-twitch-access-token";
    const encrypted = encryptTwitchToken(token);
    assert.notEqual(encrypted, token);
    assert.equal(encrypted.includes(token), false);
    assert.equal(decryptTwitchToken(encrypted), token);
  });
});

test("production requires both Supabase variables and keeps the local mode available", async () => {
  await withEnvironment({ NODE_ENV: "production", SUPABASE_URL: null, SUPABASE_SECRET_KEY: null }, async () => {
    assert.throws(assertProductionSupabaseConfigured, /SUPABASE_URL and SUPABASE_SECRET_KEY/);
    process.env.SUPABASE_URL = "https://unit-test.supabase.invalid";
    assert.throws(assertProductionSupabaseConfigured, /SUPABASE_SECRET_KEY/);
    process.env.SUPABASE_SECRET_KEY = "unit-test-secret";
    assert.doesNotThrow(assertProductionSupabaseConfigured);
  });

  await withEnvironment({ NODE_ENV: "development", SUPABASE_URL: null, SUPABASE_SECRET_KEY: null }, async () => {
    assert.doesNotThrow(assertProductionSupabaseConfigured);
  });
});

test("Twitch refresh validates creator identity and persists the rotated encrypted token pair", async () => {
  const originalFetch = globalThis.fetch;
  const envNames = ["NODE_ENV", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_TOKEN_ENCRYPTION_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY"];
  const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  const encryptionKey = "abcdef0123456789".repeat(4);
  let creator;
  const rpcCalls = [];

  try {
    process.env.NODE_ENV = "test";
    process.env.TWITCH_CLIENT_ID = "test-client-id";
    process.env.TWITCH_CLIENT_SECRET = "test-client-secret";
    process.env.TWITCH_TOKEN_ENCRYPTION_KEY = encryptionKey;
    process.env.SUPABASE_URL = "https://unit-test.supabase.invalid";
    process.env.SUPABASE_SECRET_KEY = "unit-test-service-key";
    creator = {
      accountId: "unit-test-creator-account",
      twitchUserId: "unit-test-creator-id",
      twitchLogin: "test_creator",
      scopes: ["user:read:chat", "user:write:chat"],
      expiresAt: null,
      connectionVersion: 4,
      accessTokenEncrypted: encryptTwitchToken("expired-test-access"),
      refreshTokenEncrypted: encryptTwitchToken("old-test-refresh")
    };

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/oauth2/validate")) {
        const authorization = new Headers(init?.headers).get("Authorization");
        if (authorization === "OAuth expired-test-access") return new Response(null, { status: 401 });
        assert.equal(authorization, "OAuth rotated-test-access");
        return new Response(JSON.stringify({
          client_id: "test-client-id",
          user_id: "unit-test-creator-id",
          login: "test_creator",
          scopes: ["user:read:chat", "user:write:chat"],
          expires_in: 3600
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/oauth2/token")) {
        const form = new URLSearchParams(String(init?.body));
        assert.equal(form.get("refresh_token"), "old-test-refresh");
        return new Response(JSON.stringify({
          access_token: "rotated-test-access",
          refresh_token: "rotated-test-refresh",
          expires_in: 3600,
          scope: ["user:read:chat", "user:write:chat"],
          token_type: "bearer"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/rest/v1/rpc/update_twitch_creator_tokens")) {
        const body = JSON.parse(String(init?.body));
        rpcCalls.push(body);
        return new Response(null, { status: 204 });
      }
      throw new Error("Unexpected request in token refresh test.");
    };

    const twitchAuth = await createCreatorTwitchAuth(creator);
    const validation = await twitchAuth.validateOrRefresh();
    assert.equal(validation.user_id, "unit-test-creator-id");
    assert.equal(await twitchAuth.getAccessToken(), "rotated-test-access");
    assert.equal(rpcCalls.length, 1);
    assert.equal(rpcCalls[0].p_creator_account_id, creator.accountId);
    assert.equal(rpcCalls[0].p_connection_version, creator.connectionVersion);
    assert.equal(decryptTwitchToken(rpcCalls[0].p_access_token_encrypted), "rotated-test-access");
    assert.equal(decryptTwitchToken(rpcCalls[0].p_refresh_token_encrypted), "rotated-test-refresh");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
