import { expect, test } from "bun:test";
import { fetchWithTimeout } from "../../lib/federation-fetch.ts";
import { sendCallSignal } from "../../lib/rtc/signal-transport.ts";

test("federation fetch composes caller abort with its own timeout", async () => {
  const original = globalThis.fetch;
  const caller = new AbortController();
  let received: AbortSignal | undefined;
  globalThis.fetch = (async (_input, init) => {
    received = init?.signal ?? undefined;
    return await new Promise<Response>((_, reject) =>
      received!.addEventListener("abort", () => reject(received!.reason), {
        once: true,
      }),
    );
  }) as typeof fetch;
  try {
    const request = fetchWithTimeout("https://8.8.8.8/rtc", {
      signal: caller.signal,
      skipSafetyCheck: true,
      timeout: 1000,
    });
    caller.abort(new Error("caller cancelled"));
    await expect(request).rejects.toThrow("caller cancelled");
    expect(received?.aborted).toBe(true);
    const defaultCaller = new AbortController();
    const defaultRequest = fetchWithTimeout("https://8.8.8.8/rtc", {
      signal: defaultCaller.signal,
      skipSafetyCheck: true,
    });
    defaultCaller.abort();
    await expect(defaultRequest).rejects.toBe(defaultCaller.signal.reason);
    await expect(
      fetchWithTimeout("https://8.8.8.8/rtc", {
        skipSafetyCheck: true,
        timeout: 5,
      }),
    ).rejects.toThrow("timed out");
  } finally {
    globalThis.fetch = original;
  }
});

test("pre-aborted or expired requests perform no network I/O", async () => {
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response(null, { status: 204 });
    },
    { preconnect: original.preconnect },
  );
  try {
    const caller = new AbortController();
    caller.abort(new Error("stopped"));
    await expect(
      fetchWithTimeout("https://8.8.8.8/rtc", { signal: caller.signal }),
    ).rejects.toThrow("stopped");
    await expect(
      fetchWithTimeout("https://8.8.8.8/rtc", { deadline: Date.now() - 1 }),
    ).rejects.toThrow("deadline");
    expect(requests).toBe(0);
    expect(
      (await fetchWithTimeout("https://8.8.8.8/rtc", { skipSafetyCheck: true }))
        .status,
    ).toBe(204);
    expect(requests).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

test("RTC deadline is rechecked after endpoint lookup before signing or POST", async () => {
  const original = globalThis.fetch;
  const originalNow = Date.now;
  let requests = 0;
  let now = 1000;
  Date.now = () => now;
  globalThis.fetch = Object.assign(
    async () => {
      requests++;
      return new Response(null, { status: 204 });
    },
    { preconnect: original.preconnect },
  );
  const db = {
    query: {
      actorCache: {
        findFirst: async () => {
          now = 3000;
          return { inbox: "https://peer.example/inbox", rawJson: "{}" };
        },
      },
    },
  };
  try {
    await expect(
      sendCallSignal(
        db as never,
        {
          apId: "https://local.example/alice",
          privateKeyPem: "must not be used",
        },
        {
          v: 1,
          callId: "one",
          from: "https://local.example/alice",
          to: "https://peer.example/bob",
          type: "accept",
          ts: 1000,
          ttlMs: 30000,
        },
        undefined,
        { deadline: 2000 },
      ),
    ).rejects.toThrow("deadline");
    expect(requests).toBe(0);
  } finally {
    Date.now = originalNow;
    globalThis.fetch = original;
  }
});

for (const mode of ["abort", "deadline"] as const)
  test(`uncancellable DNS completion after ${mode} cannot start a late POST`, () => {
    const module = new URL("../../lib/federation-fetch.ts", import.meta.url)
      .href;
    const ssrfModule = new URL("../../lib/ssrf.ts", import.meta.url).href;
    const script = `
    import { mock } from 'bun:test';
    let release;
    const gate = new Promise(r => { release = r; });
    const ssrf = await import(${JSON.stringify(ssrfModule)});
    mock.module(${JSON.stringify(ssrfModule)}, () => ({...ssrf, nodeLookupAll: async () => { await gate; return ['8.8.8.8']; }}));
    const { fetchWithTimeout } = await import(${JSON.stringify(module)});
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(null,{status:204}); };
    const caller = new AbortController();
    let now = 1000; Date.now = () => now;
    const request = fetchWithTimeout('https://peer.example/rtc',{method:'POST',signal:caller.signal,deadline:2000});
    await new Promise(r => setTimeout(r,5));
    if (${JSON.stringify(mode)} === 'abort') caller.abort(new Error('cancelled during DNS'));
    else now = 3000;
    release();
    let failure;
    try { await request; } catch (e) { failure = e.message; }
    const expected = ${JSON.stringify(mode)} === 'abort' ? 'cancelled during DNS' : 'Federation request deadline exceeded';
    if (failure !== expected || requests !== 0) throw new Error(JSON.stringify({failure,requests}));
  `;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(result.exitCode).toBe(0);
  });

for (const mode of ["abort", "deadline"] as const)
  test(`signing completion after ${mode} cannot start a late POST`, () => {
    const transport = new URL(
      "../../lib/rtc/signal-transport.ts",
      import.meta.url,
    ).href;
    const signing = new URL("../../lib/ap-signing.ts", import.meta.url).href;
    const script = `
    import { mock } from 'bun:test';
    let now = 1000; Date.now = () => now;
    const caller = new AbortController();
    const actualSigning = await import(${JSON.stringify(signing)});
    mock.module(${JSON.stringify(signing)}, () => ({...actualSigning, signRequest: async () => {
      await Promise.resolve();
      if (${JSON.stringify(mode)} === 'abort') caller.abort(new Error('cancelled during signing'));
      else now = 3000;
      return { signature: 'not transmitted', digest: 'not transmitted', date: 'not transmitted' };
    }}));
    const { sendCallSignal } = await import(${JSON.stringify(transport)});
    let requests = 0;
    globalThis.fetch = async () => { requests++; return new Response(null,{status:204}); };
    let failure;
    try {
      await sendCallSignal({}, {apId:'https://local.example/alice',privateKeyPem:'unused'},
        {v:1,type:'accept',callId:'one',from:'https://local.example/alice',to:'https://peer.example/bob',ts:1000,ttlMs:30000},
        'https://8.8.8.8/rtc', {signal:caller.signal,deadline:2000});
    } catch (e) { failure = e.message; }
    const expected = ${JSON.stringify(mode)} === 'abort' ? 'cancelled during signing' : 'RTC signal deadline exceeded';
    if (failure !== expected || requests !== 0) throw new Error(JSON.stringify({failure,requests}));
  `;
    const result = Bun.spawnSync([process.execPath, "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(new TextDecoder().decode(result.stderr)).toBe("");
    expect(result.exitCode).toBe(0);
  });
