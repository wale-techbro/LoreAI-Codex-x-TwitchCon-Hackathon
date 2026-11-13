import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("seeded demo answers from relevant approved lore and returns sources", async () => {
  const projectRoot = process.cwd();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "lore-answer-demo-"));
  const environment = new Map(["NODE_ENV", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "OPENAI_API_KEY"].map((name) => [name, process.env[name]]));
  try {
    process.chdir(temporaryDirectory);
    process.env.NODE_ENV = "test";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.OPENAI_API_KEY;
    const moduleUrl = pathToFileURL(path.join(projectRoot, "src/lib/server/answer.ts"));
    moduleUrl.searchParams.set("test", `${Date.now()}-${Math.random()}`);
    const { answerFromLore } = await import(moduleUrl.href);

    const grounded = await answerFromLore("demo-channel", "What was the Banana Incident?");
    assert.equal(grounded.generatedBy, "grounded-demo");
    assert.match(grounded.answer, /banana/i);
    assert.equal(grounded.sources.length, 1);
    assert.equal(grounded.sources[0].title, "The Banana Incident");
    assert.deepEqual(Object.keys(grounded.sources[0]).sort(), ["created_at", "id", "summary", "title"]);
    assert.doesNotMatch(JSON.stringify(grounded), /chat_messages|user_name|message_text/);

    const unknown = await answerFromLore("demo-channel", "What happened to the moon cheese?");
    assert.equal(unknown.answer, "I don't know yet.");
    assert.deepEqual(unknown.sources, []);
  } finally {
    process.chdir(projectRoot);
    for (const [name, value] of environment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    const relativeTemporaryPath = path.relative(tmpdir(), temporaryDirectory);
    if (!relativeTemporaryPath || relativeTemporaryPath.startsWith("..") || path.isAbsolute(relativeTemporaryPath)) {
      throw new Error("Refusing to remove a test directory outside the temporary root.");
    }
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
