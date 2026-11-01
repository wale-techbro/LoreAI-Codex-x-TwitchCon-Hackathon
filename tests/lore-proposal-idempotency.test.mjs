import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const envNames = ["SUPABASE_URL", "SUPABASE_SECRET_KEY", "TWITCH_BROADCASTER_USER_ID", "TWITCH_CHANNEL_LOGIN"];

async function withIsolatedStore(configure, run) {
  const projectRoot = process.cwd();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lore-proposal-idempotency-"));
  const originalValues = new Map(envNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;

  try {
    process.chdir(temporaryDirectory);
    for (const name of envNames) delete process.env[name];
    configure();
    const storeUrl = pathToFileURL(path.join(projectRoot, "src/lib/server/store.ts"));
    storeUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
    const store = await import(storeUrl.href);
    await run(store);
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(projectRoot);
    for (const [name, value] of originalValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const relativeTemporaryPath = path.relative(tmpdir(), temporaryDirectory);
    if (!relativeTemporaryPath || relativeTemporaryPath.startsWith("..") || path.isAbsolute(relativeTemporaryPath)) {
      throw new Error("Refusing to remove a test directory outside the temporary root.");
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test("local fallback creates one proposal for duplicate deliveries of a Twitch message", async () => {
  await withIsolatedStore(() => {}, async (store) => {
    const message = await store.saveChatMessage({
      twitch_message_id: "test-twitch-message-id",
      user_login: "test_viewer",
      user_name: "Test Viewer",
      message_text: "!lore Idempotency test",
      sent_at: new Date().toISOString()
    });
    const input = {
      title: "Idempotency test",
      summary: "A test proposal",
      source_message_ids: [message.id],
      twitch_message_id: message.twitch_message_id
    };

    const [first, duplicate] = await Promise.all([
      store.createLoreProposal(input),
      store.createLoreProposal(input)
    ]);
    const entries = (await store.listLore()).filter((entry) => entry.title === input.title);

    assert.equal(first.id, duplicate.id);
    assert.equal(entries.length, 1);
    assert.deepEqual(entries[0].source_message_ids, [message.id]);
  });
});

test("Supabase proposal path calls the atomic RPC with twitch_message_id", async () => {
  await withIsolatedStore(() => {
    process.env.SUPABASE_URL = "https://unit-test.supabase.invalid";
    process.env.SUPABASE_SECRET_KEY = "unit-test-key";
    process.env.TWITCH_BROADCASTER_USER_ID = "unit-test-broadcaster";
    process.env.TWITCH_CHANNEL_LOGIN = "unit_test_channel";
  }, async (store) => {
    const proposal = {
      id: "unit-test-lore-id",
      channel_id: "unit-test-channel-id",
      title: "RPC idempotency test",
      summary: "Test response",
      status: "proposed",
      source_message_ids: ["11111111-1111-4111-8111-111111111111"],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const calls = [];
    globalThis.fetch = async (input, init) => {
      const requestUrl = typeof input === "string" ? input : input.url;
      const pathname = new URL(requestUrl).pathname;
      if (pathname.endsWith("/channels")) {
        return new Response(JSON.stringify({ id: "unit-test-channel-id" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      if (pathname.endsWith("/rpc/create_lore_proposal_once")) {
        calls.push(JSON.parse(init.body));
        return new Response(JSON.stringify([proposal]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw new Error("Unexpected test request.");
    };

    const result = await store.createLoreProposal({
      title: proposal.title,
      summary: proposal.summary,
      source_message_ids: proposal.source_message_ids,
      twitch_message_id: "unit-test-twitch-message-id"
    });

    assert.equal(result.id, proposal.id);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].p_twitch_message_id, "unit-test-twitch-message-id");
    assert.deepEqual(calls[0].p_source_message_ids, proposal.source_message_ids);
  });
});

test("database migration serializes duplicate keys and reuses a proposal sourced from the message", async () => {
  const migration = await readFile("supabase/migrations/002_lore_proposal_idempotency.sql", "utf8");
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /twitch_message_id\s*=\s*p_twitch_message_id/);
  assert.match(migration, /source_message_ids\s+@>\s+array\[v_source_message_id\]/);
});
