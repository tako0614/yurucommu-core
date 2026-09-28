import { expect, test } from "bun:test";

for (const mode of [
  "worker-public",
  "worker-private",
  "worker-resolver-error",
  "host-public",
  "host-resolver-error",
] as const) {
  test(`federation fetch resolver selection: ${mode}`, () => {
    // Run each case in a fresh module graph so the imported SSRF functions can
    // be observed without changing process/navigator for other tests.
    const ssrfModule = new URL("../../lib/ssrf.ts", import.meta.url).href;
    const fetchModule = new URL(
      "../../lib/federation-fetch.ts",
      import.meta.url,
    ).href;
    const script = `
      import { mock } from "bun:test";
      const mode = ${JSON.stringify(mode)};
      const calls = { host: 0, worker: 0, fetch: 0 };
      if (mode.startsWith("worker")) {
        Object.defineProperty(globalThis, "navigator", {
          configurable: true,
          value: { userAgent: "Cloudflare-Workers" },
        });
      }
      if (!globalThis.process) throw new Error("test requires a process global");
      const ssrf = await import(${JSON.stringify(ssrfModule)});
      mock.module(${JSON.stringify(ssrfModule)}, () => ({
        ...ssrf,
        nodeLookupAll: async () => {
          calls.host++;
          if (mode === "host-resolver-error") throw new Error("Not implemented");
          return ["8.8.8.8"];
        },
        resolveRemoteHostnameIPs: async () => {
          calls.worker++;
          if (mode === "worker-resolver-error") throw new Error("DoH unavailable");
          return [mode === "worker-private" ? "127.0.0.1" : "8.8.8.8"];
        },
      }));
      const { fetchWithTimeout } = await import(${JSON.stringify(fetchModule)});
      globalThis.fetch = async () => {
        calls.fetch++;
        return new Response(null, { status: 204 });
      };
      let error = "";
      try {
        await fetchWithTimeout("https://peer.example/ap/rtc/signal", { method: "POST" });
      } catch (cause) {
        error = String(cause);
      }
      const expected = {
        "worker-public": { host: 0, worker: 1, fetch: 1, error: "" },
        "worker-private": { host: 0, worker: 1, fetch: 0, error: "private IP" },
        "worker-resolver-error": { host: 0, worker: 1, fetch: 0, error: "DoH unavailable" },
        "host-public": { host: 1, worker: 0, fetch: 1, error: "" },
        "host-resolver-error": { host: 1, worker: 0, fetch: 0, error: "Not implemented" },
      }[mode];
      if (calls.host !== expected.host || calls.worker !== expected.worker ||
          calls.fetch !== expected.fetch || !error.includes(expected.error) ||
          (expected.error === "" && error !== "")) {
        throw new Error(JSON.stringify({ mode, calls, error, expected }));
      }
    `;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(result.exitCode).toBe(0);
  });
}
