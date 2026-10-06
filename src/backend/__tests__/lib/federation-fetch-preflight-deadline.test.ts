import { expect, test } from "bun:test";

const ssrfModule = new URL("../../lib/ssrf.ts", import.meta.url).href;
const fetchModule = new URL("../../lib/federation-fetch.ts", import.meta.url)
  .href;

for (const mode of [
  "configured-timeout-late-public",
  "configured-timeout-late-rejection",
  "caller-abort-late-public",
  "absolute-deadline-late-public",
] as const) {
  test(`federation preflight returns while DNS remains pending: ${mode}`, () => {
    // mock.module is process-wide; use a fresh Bun module graph for each case.
    const script = `
      import { mock } from "bun:test";
      const mode = ${JSON.stringify(mode)};
      let resolveLookup;
      let rejectLookup;
      let enteredLookup;
      const entered = new Promise(resolve => { enteredLookup = resolve; });
      const gate = new Promise((resolve, reject) => {
        resolveLookup = resolve;
        rejectLookup = reject;
      });
      const ssrf = await import(${JSON.stringify(ssrfModule)});
      let lookups = 0;
      mock.module(${JSON.stringify(ssrfModule)}, () => ({
        ...ssrf,
        nodeLookupAll: async () => {
          lookups++;
          enteredLookup();
          return await gate;
        },
      }));
      const { fetchWithTimeout } = await import(${JSON.stringify(fetchModule)});
      let fetches = 0;
      let unhandled = 0;
      const onUnhandled = () => { unhandled++; };
      process.on("unhandledRejection", onUnhandled);
      globalThis.fetch = async () => {
        fetches++;
        return new Response(null, { status: 204 });
      };
      const caller = new AbortController();
      const cancelled = new Error("caller cancelled during DNS");
      const options = { method: "POST", timeout: 80 };
      if (mode === "caller-abort-late-public") {
        options.timeout = 5000;
        options.signal = caller.signal;
      }
      if (mode === "absolute-deadline-late-public") {
        options.timeout = 5000;
        options.deadline = Date.now() + 120;
      }
      const request = fetchWithTimeout("https://peer.example/ap/inbox", options);
      const settled = request.then(
        () => ({ kind: "resolved" }),
        error => ({ kind: "rejected", error }),
      );
      async function within(promise, label) {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(label + " watchdog")), 2000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      }
      let failure;
      try {
        await within(entered, "DNS entry");
        if (mode === "caller-abort-late-public") caller.abort(cancelled);
        const outcome = await within(settled, "pending DNS request");
        if (outcome.kind !== "rejected") throw new Error("request resolved during pending DNS");
        if (mode === "caller-abort-late-public") {
          if (outcome.error !== cancelled) throw new Error("caller abort reason changed");
        } else if (mode === "absolute-deadline-late-public") {
          if (!String(outcome.error).includes("deadline"))
            throw new Error("absolute deadline error changed");
        } else if (!String(outcome.error).includes("timed out")) {
          throw new Error("configured timeout error changed");
        }
        if (lookups !== 1 || fetches !== 0)
          throw new Error("preflight did not hold exactly one lookup and zero HTTP requests");
      } catch (error) {
        failure = error;
      } finally {
        if (mode === "configured-timeout-late-rejection")
          rejectLookup(new Error("late resolver rejection"));
        else resolveLookup(["8.8.8.8"]);
        await within(settled, "late DNS settlement").catch(error => { failure ??= error; });
        await new Promise(resolve => setTimeout(resolve, 20));
        process.off("unhandledRejection", onUnhandled);
      }
      if (fetches !== 0) throw new Error("late DNS settlement started HTTP");
      if (unhandled !== 0) throw new Error("late DNS rejection was unhandled");
      if (failure) throw failure;
    `;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(result.exitCode).toBe(0);
  });
}

test("header wait keeps the existing timeout error when an absolute deadline expires", () => {
  const script = `
    const { fetchWithTimeout } = await import(${JSON.stringify(fetchModule)});
    const caller = new AbortController();
    let fetches = 0;
    let receivedSignal;
    globalThis.fetch = async (_url, init) => {
      fetches++;
      receivedSignal = init.signal;
      return await new Promise((_, reject) => {
        if (receivedSignal.aborted) reject(receivedSignal.reason);
        else receivedSignal.addEventListener("abort", () => reject(receivedSignal.reason), { once: true });
      });
    };
    const request = fetchWithTimeout("https://peer.example/ap/inbox", {
      method: "POST", skipSafetyCheck: true, timeout: 5000,
      deadline: Date.now() + 120, signal: caller.signal,
    });
    const settled = request.then(
      () => ({ kind: "resolved" }),
      error => ({ kind: "rejected", error }),
    );
    let watchdog;
    try {
      const outcome = await Promise.race([
        settled,
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error("header wait watchdog")), 2000);
        }),
      ]);
      if (outcome.kind !== "rejected" ||
          outcome.error?.message !== "Request timed out after 5 seconds: https://peer.example/ap/inbox")
        throw new Error("header timeout error contract changed");
      if (fetches !== 1 || receivedSignal?.reason?.name !== "AbortError" || caller.signal.aborted)
        throw new Error("header wait did not use its original abort signal");
    } finally {
      clearTimeout(watchdog);
      caller.abort(new Error("test cleanup"));
      await settled;
    }
  `;
  const result = Bun.spawnSync([process.execPath, "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(new TextDecoder().decode(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
});

test("resolver AbortError remains the original error with zero HTTP", () => {
  const script = `
    import { mock } from "bun:test";
    const ssrf = await import(${JSON.stringify(ssrfModule)});
    const dnsAbort = new DOMException("DNS cancelled", "AbortError");
    let lookups = 0;
    mock.module(${JSON.stringify(ssrfModule)}, () => ({
      ...ssrf,
      nodeLookupAll: async () => { lookups++; throw dnsAbort; },
    }));
    const { fetchWithTimeout } = await import(${JSON.stringify(fetchModule)});
    let fetches = 0;
    globalThis.fetch = async () => { fetches++; return new Response(null, { status: 204 }); };
    let watchdog;
    try {
      const outcome = await Promise.race([
        fetchWithTimeout("https://peer.example/ap/inbox", { method: "POST", timeout: 5000 }).then(
          () => ({ kind: "resolved" }),
          error => ({ kind: "rejected", error }),
        ),
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error("resolver error watchdog")), 2000);
        }),
      ]);
      if (outcome.kind !== "rejected" || outcome.error !== dnsAbort)
        throw new Error("resolver AbortError identity changed");
      if (lookups !== 1 || fetches !== 0)
        throw new Error("resolver failure started HTTP");
    } finally {
      clearTimeout(watchdog);
    }
  `;
  const result = Bun.spawnSync([process.execPath, "-e", script], {
    stdout: "pipe",
    stderr: "pipe",
  });
  expect(new TextDecoder().decode(result.stderr)).toBe("");
  expect(result.exitCode).toBe(0);
});
