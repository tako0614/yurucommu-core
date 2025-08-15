import { getEnvPath } from "../shared/args.ts";
import { runHostDev } from "./utils/dev_runner.ts";

async function main() {
  const envPath = getEnvPath();
  await runHostDev(envPath);
}

if (import.meta.main) main();
