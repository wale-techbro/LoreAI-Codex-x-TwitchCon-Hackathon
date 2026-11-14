import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { logWorkerError } from "../worker/safe-logging.ts";

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(entryPath));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

test("Supabase server module has the server-only guard and client components do not import server modules", async () => {
  const supabase = await readFile("src/lib/server/supabase.ts", "utf8");
  assert.match(supabase, /^import ["']server-only["'];/m);

  for (const file of await sourceFiles("src")) {
    const source = await readFile(file, "utf8");
    if (/^["']use client["'];/m.test(source)) {
      assert.doesNotMatch(source, /(?:from|import\s*\()\s*["'][^"']*lib\/server[^"']*["']/);
    }
  }
});

test("direct Node server entry points activate React server conditions", async () => {
  const packageJson = JSON.parse(await readFile("package.json", "utf8"));
  assert.match(packageJson.scripts.worker, /--conditions=react-server/);
  assert.match(packageJson.scripts.seed, /--conditions=react-server/);
});

test("API route failures do not return raw exception messages", async () => {
  for (const file of await sourceFiles("src/app/api")) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\berror\.message\b/);
  }

  const expectedMessages = new Map([
    ["src/app/api/ask/route.ts", "LORE couldn't answer just now."],
    ["src/app/api/lore/route.ts", "Could not load the lorebook."],
    ["src/app/api/lore/[id]/route.ts", "Could not update the lore entry."],
    ["src/app/api/status/route.ts", "Could not load service status."]
  ]);
  for (const [file, safeMessage] of expectedMessages) {
    const source = await readFile(file, "utf8");
    assert.doesNotMatch(source, /\berror\.message\b/);
    assert.ok(source.includes(safeMessage), `${file} should return its generic error message`);
  }
});

test("worker error logs are structured and exclude exception text and credential-like values", () => {
  const sentinels = [
    "ACCESS_TOKEN_SENTINEL",
    "REFRESH_TOKEN_SENTINEL",
    "ENCRYPTION_KEY_SENTINEL",
    "COOKIE_SENTINEL",
    "AUTHORIZATION_HEADER_SENTINEL"
  ];
  const originalError = console.error;
  const output = [];
  console.error = (...values) => output.push(values.join(" "));
  try {
    const error = new Error(sentinels.join(" "));
    error.name = sentinels[0];
    logWorkerError("creator_poll_failed", error, "123e4567-e89b-42d3-a456-426614174000", 503);
  } finally {
    console.error = originalError;
  }

  assert.equal(output.length, 1);
  const line = output[0];
  for (const secret of sentinels) assert.equal(line.includes(secret), false);
  assert.deepEqual(JSON.parse(line), {
    level: "error",
    service: "lore-eventsub-worker",
    event: "creator_poll_failed",
    errorType: "Error",
    creatorId: "123e4567-e89b-42d3-a456-426614174000",
    httpStatus: 503
  });
});
