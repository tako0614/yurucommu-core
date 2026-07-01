import { expect, test } from "bun:test";
import { createEntrySource } from "../../../scripts/build-takos-worker.ts";

test("Takosumi Worker artifact entry wraps native Cloudflare bindings", () => {
  const source = createEntrySource({});

  expect(source).toContain(
    'import { wrapCloudflareBindings } from "../src/backend/runtime/cloudflare.ts";',
  );
  expect(source).toContain(
    "withDefaultAppUrl(request, wrapCloudflareBindings(env))",
  );
  expect(source).toContain(
    "handleYurucommuQueueBatch(batch, wrapCloudflareBindings(env) as Env)",
  );
});
