import { getEnvPath } from "@takos/config";
import { runHostDev } from "./utils/dev_runner.ts";

async function main() {
  const envPath = getEnvPath();
  await runHostDev(envPath);
}

if (import.meta.main) main();
