import nextEnv from "@next/env";
import { resetSeed } from "../src/lib/server/store.ts";

nextEnv.loadEnvConfig(process.cwd());

resetSeed().then(() => {
  console.log("LORE seed data loaded.");
}).catch((error: unknown) => {
  console.error("Could not load seed data:", error);
  process.exitCode = 1;
});
