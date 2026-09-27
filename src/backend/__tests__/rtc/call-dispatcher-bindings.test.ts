import { expect, test } from "bun:test";
import type { Database } from "../../../db/index.ts";
import { createCallDispatcherForCallsByInvocation } from "../../runtime/call-dispatcher-bindings.ts";

const ACTOR = "https://local.example/ap/users/alice";

function job(index: number) {
  return {
    effect: {
      effectId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      callId: `call-${index}`,
      generation: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      deadline: Date.now() + 8_000,
      signalType: "offer",
      continuation: "none",
    },
    envelope: {
      v: 1,
      callId: `call-${index}`,
      from: ACTOR,
      to: "https://peer.example/ap/users/bob",
      type: "offer",
      sdp: "SECRET-SDP",
      ts: Date.now(),
      ttlMs: 30_000,
    },
  };
}

function request(index: number) {
  return new Request("https://dispatcher.internal/_dispatch", {
    method: "POST",
    body: JSON.stringify(job(index)),
  });
}

function context() {
  const tasks: Promise<unknown>[] = [];
  return {
    tasks,
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
  };
}

async function until(predicate: () => boolean) {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error("condition was not reached");
}

test("fresh invocation bindings keep their own DB and Actor target under one admission cap", async () => {
  const dispatcher = createCallDispatcherForCallsByInvocation();
  const reads = [0, 0];
  const callbacks: Array<{ lane: number; actor: string; body: string }> = [];
  let releaseCallbacks!: () => void;
  const heldCallbacks = new Promise<void>((resolve) => {
    releaseCallbacks = resolve;
  });
  const deps = [0, 1].map((lane) => ({
    db: {
      query: {
        actors: {
          async findFirst() {
            reads[lane]! += 1;
            // A missing key fails before any peer network request.
            return undefined;
          },
        },
      },
    } as unknown as Database,
    env: { APP_URL: "https://local.example" },
    actorFor(actor: string) {
      return {
        async fetch(request: Request) {
          callbacks.push({ lane, actor, body: await request.text() });
          await heldCallbacks;
          return new Response(null, { status: 204 });
        },
      };
    },
  }));
  const contexts = Array.from({ length: 9 }, () => context());

  try {
    for (let index = 0; index < 8; index++) {
      const response = await dispatcher.fetch(
        request(index + 1),
        contexts[index]!,
        // Deliberately fresh env/deps objects, even for the same lane.
        { ...deps[index % 2]!, env: { ...deps[index % 2]!.env } },
      );
      expect(response.status).toBe(202);
    }
    await until(() => callbacks.length === 8);
    expect(reads).toEqual([4, 4]);
    expect(callbacks.map(({ lane }) => lane).sort()).toEqual([
      0, 0, 0, 0, 1, 1, 1, 1,
    ]);
    expect(
      callbacks.every(
        ({ actor, body }) =>
          actor === ACTOR &&
          body.includes('"outcome":"failed"') &&
          !body.includes("SECRET-SDP"),
      ),
    ).toBe(true);

    const full = await dispatcher.fetch(request(9), contexts[8]!, deps[0]!);
    expect(full.status).toBe(503);
    expect(contexts[8]!.tasks).toHaveLength(0);
  } finally {
    releaseCallbacks();
    await Promise.all(contexts.flatMap((item) => item.tasks));
  }
});
