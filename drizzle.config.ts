import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  // Inspection-only output dir. The canonical D1 migrations live in ./migrations
  // and are hand-authored SQL (no drizzle _journal.json); never let drizzle-kit
  // generate/push mutate them or it would corrupt the deploy artifact.
  out: "./drizzle",
  dialect: "sqlite",
});
