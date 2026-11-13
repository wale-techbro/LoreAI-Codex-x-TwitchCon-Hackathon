import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getCanonicalAppHomeUrl,
  validateAppOrigin,
  validateTwitchCallbackUri
} from "../src/lib/server/app-origin.ts";

async function withEnvironment(values, run) {
  const original = new Map(Object.keys(values).map((name) => [name, process.env[name]]));
  try {
    for (const [name, value] of Object.entries(values)) {
      if (value === null) delete process.env[name];
      else process.env[name] = value;
    }
    await run();
  } finally {
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("canonical origin requires HTTPS in production and permits local HTTP in development", () => {
  assert.equal(validateAppOrigin("https://lore.example.test", "production"), "https://lore.example.test");
  assert.equal(validateAppOrigin("http://localhost:3000", "development"), "http://localhost:3000");
  assert.throws(() => validateAppOrigin("http://lore.example.test", "production"), /HTTPS/);
});

test("canonical origin rejects missing values, credentials, and non-origin URL parts", () => {
  for (const value of [undefined, "", "not a URL", "https://user:pass@lore.example.test", "https://lore.example.test/path", "https://lore.example.test/?q=x", "https://lore.example.test/#fragment"]) {
    assert.throws(() => validateAppOrigin(value, "production"));
  }
});

test("Twitch callback must use the canonical origin and exact callback path", () => {
  const canonical = "https://lore.example.test";
  const callback = "https://lore.example.test/api/auth/twitch/callback";
  assert.equal(validateTwitchCallbackUri(callback, canonical), callback);
  assert.throws(() => validateTwitchCallbackUri("https://other.example.test/api/auth/twitch/callback", canonical));
  assert.throws(() => validateTwitchCallbackUri("https://lore.example.test/other", canonical));
  assert.throws(() => validateTwitchCallbackUri(`${callback}?next=https://other.example.test`, canonical));
});

test("OAuth home redirects use APP_ORIGIN, never the incoming request origin", async () => {
  await withEnvironment({ APP_ORIGIN: "https://canonical.example.test", NODE_ENV: "production" }, async () => {
    const target = getCanonicalAppHomeUrl("failed");
    assert.equal(target.origin, "https://canonical.example.test");
    assert.equal(target.searchParams.get("connect"), "failed");
  });

  const source = await readFile("src/app/api/auth/twitch/callback/route.ts", "utf8");
  assert.match(source, /getCanonicalAppHomeUrl/);
  assert.doesNotMatch(source, /new URL\("\/",\s*url\.origin\)/);
});
