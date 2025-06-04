# Takopack Runtime

This module provides a lightweight runtime for executing unpacked `.takopack`
archives. It exposes a `TakoPack` class which loads extension code and attaches
a `takos` API instance to `globalThis` so that extension scripts can access the
Takos APIs.

```ts
import { TakoPack } from "@takopack/runtime";

const runtime = new TakoPack([
  { manifest, server },
], {
  fetch: customFetch,
  kv: { read: myRead },
  events: {
    publish: myPublish,
    publishToClient: myPublishClient,
  },
});
await runtime.init();
const result = await runtime.callServer(manifest.identifier, "hello", [
  "world",
]);
```

The `assets.write` API accepts an optional `{ cacheTTL }` option following the
specification in `docs/takopack/main.md`.

The implementation is intentionally minimal and focuses on server-side
execution. The `takos` object exposes stub implementations of the APIs described
in `docs/takopack/main.md`.
