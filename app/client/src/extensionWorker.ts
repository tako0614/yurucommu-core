import type { createTakos } from "./takos.ts";

interface TakosGlobals {
  __takosEventDefs?: Record<string, Record<string, unknown>>;
  __takosClientEvents?: Record<
    string,
    Record<string, (p: unknown) => Promise<unknown>>
  >;
}

const CLIENT_TAKOS_PATHS: string[][] = [
  ["fetch"],
  ["kv", "read"],
  ["kv", "write"],
  ["kv", "delete"],
  ["kv", "list"],
  ["events", "publish"],
];

class ExtensionWorker {
  #reg: ServiceWorkerRegistration;
  #port: MessagePort;
  #ready: Promise<void>;
  #pending = new Map<number, (v: unknown) => void>();
  #takos: ReturnType<typeof createTakos>;
  #defs: Record<string, { handler?: string }>;
  #callId = 0;
  constructor(
    id: string,
    takos: ReturnType<typeof createTakos>,
    defs: Record<string, { handler?: string }>,
  ) {
    this.#takos = takos;
    this.#defs = defs;
    this.#ready = this.#init(id);
  }
  async #init(id: string): Promise<void> {
    const scope = `/api/extensions/${id}/`;
    const reg = await navigator.serviceWorker.register(
      `/api/extensions/${id}/sw.js`,
      { type: "module", scope },
    );
    if (!reg.active) {
      await new Promise<void>((res) => {
        const sw = reg.installing || reg.waiting;
        if (!sw) return res();
        sw.addEventListener("statechange", () => {
          if (sw.state === "activated") res();
        });
      });
    }
    this.#reg = reg;
    const worker = reg.active!;
    const channel = new MessageChannel();
    this.#port = channel.port1;
    const ready = new Promise<void>((res) => {
      const handler = (ev: MessageEvent) => {
        if (ev.data && ev.data.type === "ready") {
          this.#port.removeEventListener("message", handler);
          res();
        }
      };
      this.#port.addEventListener("message", handler);
    });
    this.#port.addEventListener("message", (e) => this.#onMessage(e));
    worker.postMessage({ type: "init", takosPaths: CLIENT_TAKOS_PATHS, id }, [
      channel.port2,
    ]);
    await ready;
  }
  get ready(): Promise<void> {
    return this.#ready;
  }
  #onMessage(ev: MessageEvent) {
    const d = ev.data;
    if (d.type === "result" || d.type === "error") {
      const cb = this.#pending.get(d.id);
      if (!cb) return;
      this.#pending.delete(d.id);
      if (d.type === "error") cb(Promise.reject(new Error(d.error)));
      else cb(d.result);
    } else if (d.type === "takosCall") {
      this.#handleTakosCall(d);
    }
  }
  async #handleTakosCall(d: { id: number; path: string[]; args: unknown[] }) {
    let ctx: unknown = this.#takos;
    let target: unknown = this.#takos;
    for (const p of d.path) {
      ctx = target;
      target = (target as Record<string, unknown>)?.[p];
    }
    try {
      let result;
      if (typeof target === "function") {
        result = await (target as (...args: unknown[]) => unknown).apply(
          ctx as unknown,
          d.args,
        );
      } else result = target;
      if (d.path[0] === "fetch") {
        const arr = new Uint8Array(await (result as Response).arrayBuffer());
        const headersArr: [string, string][] = [];
        (result as Response).headers.forEach((v, k) => headersArr.push([k, v]));
        result = {
          status: (result as Response).status,
          statusText: (result as Response).statusText,
          headers: headersArr,
          body: arr,
        };
      }
      this.#port.postMessage({ type: "takosResult", id: d.id, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.#port.postMessage({ type: "takosResult", id: d.id, error: msg });
    }
  }
  async call(fn: string, args: unknown[] = []): Promise<unknown> {
    await this.#ready;
    return new Promise((res, rej) => {
      const id = ++this.#callId;
      this.#pending.set(
        id,
        (v) => (v instanceof Promise ? v.then(res, rej) : res(v)),
      );
      this.#port.postMessage({ type: "call", id, fnName: fn, args });
    });
  }
  async callEvent(name: string, payload: unknown): Promise<unknown> {
    const def = this.#defs[name];
    const callName = def?.handler || name;
    try {
      return await this.call(callName, [payload]);
    } catch (err) {
      if (err instanceof Error && err.message.includes("function not found")) {
        const cap = callName.charAt(0).toUpperCase() + callName.slice(1);
        return await this.call(`on${cap}`, [payload]);
      }
      throw err;
    }
  }
  async terminate() {
    await this.#reg.unregister();
  }
}

const workers = new Map<string, ExtensionWorker>();
const loadingWorkers = new Map<string, Promise<ExtensionWorker>>();

async function fetchEventDefs(id: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(`/api/extensions/${id}/manifest.json`);
    if (res.ok) {
      const manifest = await res.json();
      return (manifest?.eventDefinitions as Record<string, unknown>) || {};
    }
  } catch {
    /* ignore */
  }
  return {};
}

export function loadExtensionWorker(
  id: string,
  takos: ReturnType<typeof createTakos>,
): Promise<ExtensionWorker> {
  if (workers.has(id)) return Promise.resolve(workers.get(id)!);
  if (loadingWorkers.has(id)) return loadingWorkers.get(id)!;

  const promise = (async () => {
    const host = globalThis as TakosGlobals;
    host.__takosEventDefs = host.__takosEventDefs || {};
    let defs = host.__takosEventDefs[id];
    if (!defs) {
      defs = await fetchEventDefs(id);
      host.__takosEventDefs[id] = defs;
    }
    const w = new ExtensionWorker(
      id,
      takos,
      defs as Record<string, { handler?: string }>,
    );
    await w.ready;
    workers.set(id, w);

    const events: Record<string, (payload: unknown) => Promise<unknown>> = {};
    for (const ev of Object.keys(defs)) {
      events[ev] = (payload: unknown) =>
        w.callEvent(ev, payload) as Promise<unknown>;
    }
    host.__takosClientEvents = host.__takosClientEvents || {};
    host.__takosClientEvents[id] = events;

    return w;
  })();

  loadingWorkers.set(id, promise);
  promise.finally(() => loadingWorkers.delete(id));
  return promise;
}

export function getExtensionWorker(id: string): ExtensionWorker | undefined {
  return workers.get(id);
}

export async function terminateExtensionWorker(id: string): Promise<void> {
  const w = workers.get(id);
  if (w) {
    await w.terminate();
    workers.delete(id);
  }
}
