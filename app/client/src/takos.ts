import { wsClient } from "./utils/websocketClient.ts";

export function createTakos(identifier: string) {
  async function call(eventId: string, payload: unknown) {
    let res: Response;
    try {
      res = await fetch("/api/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          events: [{ identifier: "takos", eventId, payload }],
        }),
      });
    } catch (err) {
      throw new Error(
        `Request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch (_err) {
      const text = await res.text();
      throw new Error(`Invalid JSON response: ${text.slice(0, 200)}`);
    }
    const arr = Array.isArray(data)
      ? data as { success?: boolean; result?: unknown; error?: string }[]
      : [];
    const r = arr[0];
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
      const handlers = listeners.get(name);
      handlers?.forEach((h) => {
        try {
          h(payload);
        } catch (_e) {
          /* ignore */
        }
      });
      try {
        const raw = await call("extensions:invoke", {
          id: identifier,
          fn: name,
          args: [payload],
        });
        return unwrapResult(raw);
      } catch (err) {
        if (
          err instanceof Error && err.message.includes("function not found")
        ) {
          return undefined;
        }
        throw err;
      }
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

  const fetchFn = (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, init);

  const extensionObj = {
    identifier,
    version: "",
    get isActive() {
      return true;
    },
    activate: () => ({
      publish: async (name: string, payload?: unknown) => {
        const raw = await call("extensions:invoke", {
          id: identifier,
          fn: name,
          args: [payload],
        });
        return unwrapResult(raw);
      },
    }),
  };

  const extensions = {
    get(id: string) {
      return id === identifier ? extensionObj : undefined;
    },
    get all() {
      return [extensionObj];
    },
  };

  function getURL() {
    return location.hash.slice(1).split("/").filter((p) => p);
  }

  function setURL(segments: string[], _opts?: { showBar?: boolean }) {
    location.hash = "#" + segments.join("/");
  }

  function pushURL(segment: string, opts?: { showBar?: boolean }) {
    const segments = getURL();
    segments.push(segment);
    setURL(segments, opts);
  }

  function changeURL(
    listener: (e: { url: string[] }) => void,
  ): () => void {
    const handler = () => listener({ url: getURL() });
    globalThis.addEventListener("hashchange", handler);
    return () => globalThis.removeEventListener("hashchange", handler);
  }

  return {
    kv,
    cdn,
    events,
    server,
    fetch: fetchFn,
    extensions,
    activateExtension: extensionObj.activate,
    getURL,
    pushURL,
    setURL,
    changeURL,
  };
}
