import { wsClient } from "./utils/websocketClient.ts";

export function createTakos(identifier: string) {
  async function call(eventId: string, payload: unknown) {
    const res = await fetch("/api/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [{ identifier: "takos", eventId, payload }],
      }),
    });
    const data = await res.json();
    const r = data[0];
    if (r && r.success) return r.result;
    throw new Error(r?.error || "Event error");
  }

  function unwrapResult(raw: unknown): unknown {
    let result: unknown = raw;
    while (result && typeof result === "object" && "result" in result) {
      result = (result as { result: unknown }).result;
    }
    if (
      result &&
      typeof result === "object" &&
      !Array.isArray(result) &&
      "status" in result &&
      "body" in result
    ) {
      result = [
        (result as Record<string, unknown>)["status"],
        (result as Record<string, unknown>)["body"],
      ];
    } else if (
      !Array.isArray(result) &&
      result &&
      typeof result === "object" &&
      "0" in result &&
      "1" in result
    ) {
      result = [
        (result as Record<string, unknown>)["0"],
        (result as Record<string, unknown>)["1"],
      ];
    }
    return result;
  }

  const kv = {
    read: (key: string) =>
      call("kv:read", {
        id: identifier,
        key,
        side: "client",
      }),
    write: (key: string, value: unknown) =>
      call("kv:write", { id: identifier, key, value, side: "client" }),
    delete: (key: string) =>
      call("kv:delete", { id: identifier, key, side: "client" }),
    list: (prefix?: string) =>
      call("kv:list", { id: identifier, prefix, side: "client" }),
  };

  const cdn = {
    read: (path: string) => call("cdn:read", { id: identifier, path }),
    write: (
      path: string,
      data: string | Uint8Array,
      options?: { cacheTTL?: number },
    ) =>
      call("cdn:write", {
        id: identifier,
        path,
        data: typeof data === "string"
          ? data
          : btoa(String.fromCharCode(...data)),
        cacheTTL: options?.cacheTTL,
      }),
    delete: (path: string) => call("cdn:delete", { id: identifier, path }),
    list: (prefix?: string) => call("cdn:list", { id: identifier, prefix }),
  };

  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  wsClient.addGlobalEventListener((ev) => {
    if (ev.type === "event") {
      const set = listeners.get(ev.eventName);
      set?.forEach((h) => h(ev.payload));
    }
  });

  const events = {
    publish: async (name: string, payload: unknown) => {
      const raw = await call("extensions:invoke", {
        id: identifier,
        fn: name,
        args: [payload],
      });
      return unwrapResult(raw);
    },
    subscribe: (name: string, handler: (payload: unknown) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(handler);
      wsClient.subscribe(name);
      return () => {
        listeners.get(name)?.delete(handler);
        if (!listeners.get(name)?.size) wsClient.unsubscribe(name);
      };
    },
  };

  const server = {
    call: async (fn: string, args: unknown[] = []) => {
      const raw = await call("extensions:invoke", { id: identifier, fn, args });
      return unwrapResult(raw);
    },
  };

  return { kv, cdn, events, server, fetch };
}
