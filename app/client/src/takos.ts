import { wsClient } from "./utils/websocketClient.ts";
import { loadExtensionWorker } from "./extensionWorker.ts";
import { initializeApp } from "firebase/app";
import { getMessaging, getToken } from "firebase/messaging";

let firebaseTokenPromise: Promise<string | null> | null = null;

async function getFirebaseToken(): Promise<string | null> {
  if (firebaseTokenPromise) return firebaseTokenPromise;
  firebaseTokenPromise = (async () => {
    try {
      const res = await fetch("/api/firebase-config");
      if (!res.ok) return null;
      const config = await res.json();
      const app = initializeApp(config);
      const messaging = getMessaging(app);
      return await getToken(messaging).catch(() => null);
    } catch {
      return null;
    }
  })();
  return firebaseTokenPromise;
}

interface TakosGlobals {
  __takosEventDefs?: Record<string, Record<string, unknown>>;
  __takosClientEvents?: Record<
    string,
    Record<string, (p: unknown) => Promise<unknown>>
  >;
}

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

  const localPrefix = `takos:${identifier}::`;
  const isBrowser = typeof indexedDB !== "undefined";

  let dbPromise: Promise<IDBDatabase> | undefined;
  function openDB() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open("takos-kv", 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  const kv = isBrowser
    ? {
      read: async (key: string) => {
        const db = await openDB();
        return await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction("kv", "readonly");
          const store = tx.objectStore("kv");
          const req = store.get(localPrefix + key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
      },
      write: async (key: string, value: unknown) => {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("kv", "readwrite");
          const store = tx.objectStore("kv");
          store.put(value, localPrefix + key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
      delete: async (key: string) => {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("kv", "readwrite");
          const store = tx.objectStore("kv");
          store.delete(localPrefix + key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      },
      list: async (prefix?: string) => {
        const db = await openDB();
        return await new Promise<string[]>((resolve, reject) => {
          const keys: string[] = [];
          const tx = db.transaction("kv", "readonly");
          const store = tx.objectStore("kv");
          const req = store.openCursor();
          req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) {
              const k = cursor.key as string;
              if (k.startsWith(localPrefix)) {
                const sub = k.slice(localPrefix.length);
                if (!prefix || sub.startsWith(prefix)) keys.push(sub);
              }
              cursor.continue();
            } else {
              resolve(keys);
            }
          };
          req.onerror = () => reject(req.error);
        });
      },
    }
    : {
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
    publish: async (
      name: string,
      payload: unknown,
      options?: { push?: boolean; token?: string },
    ) => {
      if (options?.push && !options.token) {
        const token = await getFirebaseToken();
        if (token) {
          options = { ...options, token };
        }
      }
      const handlers = listeners.get(name);
      handlers?.forEach((h) => {
        try {
          h(payload);
        } catch (_e) {
          /* ignore */
        }
      });

      const g = globalThis as TakosGlobals;
      let defs = g.__takosEventDefs?.[identifier];
      if (!defs) {
        try {
          const w = await loadExtensionWorker(identifier, takos);
          await w.ready;
          defs = g.__takosEventDefs?.[identifier];
        } catch {
          /* ignore */
        }
      }
      const def = defs?.[name];
      let w: ReturnType<typeof loadExtensionWorker> | undefined;

      if (def?.source === "server") {
        const raw = await call("extensions:invoke", {
          id: identifier,
          fn: name,
          args: [payload],
          options,
        });
        return unwrapResult(raw);
      }

      try {
        w = await loadExtensionWorker(identifier, takos);
        const result = await w.callEvent(name, payload);
        if (
          def?.source === "client" ||
          def?.source === "ui" ||
          def?.source === "background"
        ) {
          return result;
        }
        if (def) return result;
      } catch (err) {
        if (def) throw err;
      }

      if (!def) {
        try {
          const raw = await call("extensions:invoke", {
            id: identifier,
            fn: name,
            args: [payload],
            options,
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
      }
      return undefined;
    },
  };

  const server = {
    call: async (
      fn: string,
      args: unknown[] = [],
      options?: { push?: boolean; token?: string },
    ) => {
      const raw = await call("extensions:invoke", {
        id: identifier,
        fn,
        args,
        options,
      });
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
      publish: async (
        name: string,
        payload?: unknown,
        options?: { push?: boolean; token?: string },
      ) => {
        if (options?.push && !options.token) {
          const token = await getFirebaseToken();
          if (token) {
            options = { ...options, token };
          }
        }
        const g = globalThis as TakosGlobals;
        let defs = g.__takosEventDefs?.[identifier];
        if (!defs) {
          try {
            const w = await loadExtensionWorker(identifier, takos);
            await w.ready;
            defs = g.__takosEventDefs?.[identifier];
          } catch {
            /* ignore */
          }
        }
        const def = defs?.[name];

        if (def?.source === "server") {
          const raw = await call("extensions:invoke", {
            id: identifier,
            fn: name,
            args: [payload],
            options,
          });
          return unwrapResult(raw);
        }

        try {
          const w = await loadExtensionWorker(identifier, takos);
          const result = await w.callEvent(name, payload);
          if (
            def?.source === "client" ||
            def?.source === "ui" ||
            def?.source === "background"
          ) {
            return unwrapResult(result);
          }
          if (def) return unwrapResult(result);
        } catch (err) {
          if (def) throw err;
        }

        if (!def) {
          try {
            const raw = await call("extensions:invoke", {
              id: identifier,
              fn: name,
              args: [payload],
              options,
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
        }
        return undefined;
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

  const takos = {
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
  } as const;

  if (typeof document !== "undefined") {
    loadExtensionWorker(identifier, takos).catch(() => {});
  }

  return takos;
}
