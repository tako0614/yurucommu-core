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
  },
});
await runtime.init();
const result = await runtime.callServer(manifest.identifier, "hello", [
  "world",
]);
```

The `cdn.write` API accepts an optional `{ cacheTTL }` option following the
specification in `docs/takopack/v3.md`.


Server code runs inside a sandboxed Deno `Worker`. The runtime derives
permissions from `manifest.permissions` (e.g. `deno:read`, `deno:net`) and
passes them to the worker. Client code is executed in a plain Web Worker without
any Deno namespace, while UI code is intended to be embedded in a sandboxed
`<iframe>`.


The implementation is intentionally minimal and focuses on server-side
execution. The `takos` object exposes stub implementations of the APIs described
in `docs/takopack/v3.md`, including the `extensions` API for cross-pack
communication. The namespace offers `get()` for fetching a single extension and
an `all` array listing loaded extensions.
