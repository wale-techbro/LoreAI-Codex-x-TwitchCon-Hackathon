import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  getAdminAccess,
  readAdminSessionCookie,
  verifyAdminSessionToken,
  visibleLoreEntries
} from "../src/lib/server/moderation-auth.ts";
import { assertProductionSupabaseConfigured } from "../src/lib/server/store.ts";
import { createTwitchAuth } from "../worker/twitch-auth.ts";

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

test("moderation sessions are signed, expire, and do not expose the admin secret", async () => {
  const secret = "test-only-admin-secret-with-more-than-32-characters";
  const now = 1_800_000_000_000;
  const token = createAdminSessionToken(secret, now);

  assert.equal(verifyAdminSessionToken(token, secret, now), true);
  assert.equal(verifyAdminSessionToken(token, "different-test-secret-with-more-than-32-characters", now), false);
  assert.equal(verifyAdminSessionToken(token, secret, now + (ADMIN_SESSION_TTL_SECONDS + 1) * 1000), false);
  assert.equal(verifyAdminSessionToken(`${token}tampered`, secret, now), false);
  assert.equal(readAdminSessionCookie(`other=value; lore_admin_session=${token}`), token);
  assert.equal(token.includes(secret), false);
});
test("production moderation requires a configured secret while local development stays unlocked", async () => {
  await withEnvironment({ NODE_ENV: "production", LORE_ADMIN_SECRET: null }, async () => {
    assert.deepEqual(getAdminAccess(null), { configured: false, authorized: false });
    process.env.LORE_ADMIN_SECRET = "test-only-admin-secret-with-more-than-32-characters";
    assert.deepEqual(getAdminAccess(null), { configured: true, authorized: false });
    const cookie = createAdminSessionToken(process.env.LORE_ADMIN_SECRET);
    assert.deepEqual(getAdminAccess(cookie), { configured: true, authorized: true });
  });

  await withEnvironment({ NODE_ENV: "development", LORE_ADMIN_SECRET: null }, async () => {
    assert.deepEqual(getAdminAccess(null), { configured: false, authorized: true });
  });
});

test("anonymous lore readers see approved entries but not moderation queue entries", () => {
  const entries = [
    { id: "approved", status: "approved" },
    { id: "proposed", status: "proposed" },
    { id: "rejected", status: "rejected" }
  ];
  assert.deepEqual(visibleLoreEntries(entries, false), [entries[0]]);
  assert.deepEqual(visibleLoreEntries(entries, true), entries);
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

test("Twitch refresh saves the rotated token pair at the configured token-state path", async () => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lore-twitch-token-state-"));
  const originalCwd = process.cwd();
  const originalFetch = globalThis.fetch;
  const envNames = ["NODE_ENV", "TWITCH_CLIENT_ID", "TWITCH_CLIENT_SECRET", "TWITCH_TOKEN_STATE_PATH"];
  const originalEnv = new Map(envNames.map((name) => [name, process.env[name]]));
  const statePath = path.join(temporaryDirectory, "render-disk", "token-state.json");

  try {
    await mkdir(path.dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify({ accessToken: "expired-test-access", refreshToken: "old-test-refresh" }), "utf8");
    process.chdir(temporaryDirectory);
    process.env.NODE_ENV = "test";
    process.env.TWITCH_CLIENT_ID = "test-client-id";
    process.env.TWITCH_CLIENT_SECRET = "test-client-secret";
    process.env.TWITCH_TOKEN_STATE_PATH = statePath;

    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith("/oauth2/validate")) {
        const authorization = new Headers(init?.headers).get("Authorization");
        if (authorization === "OAuth expired-test-access") return new Response(null, { status: 401 });
        assert.equal(authorization, "OAuth rotated-test-access");
        return new Response(JSON.stringify({
          client_id: "test-client-id",
          user_id: "test-chat-reader-id",
          login: "test_chat_reader",
          scopes: ["user:read:chat"],
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
          scope: ["user:read:chat"],
          token_type: "bearer"
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      throw new Error("Unexpected request in token refresh test.");
    };

    const twitchAuth = await createTwitchAuth();
    const validation = await twitchAuth.validateOrRefresh();
    const saved = JSON.parse(await readFile(statePath, "utf8"));
    assert.equal(validation.user_id, "test-chat-reader-id");
    assert.deepEqual(saved, { accessToken: "rotated-test-access", refreshToken: "rotated-test-refresh" });
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    for (const [name, value] of originalEnv) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
