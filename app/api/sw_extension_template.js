// Takos extension service worker (v1)
self.addEventListener("install", (e) => e.waitUntil(self.skipWaiting()));
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
let takosCallId = 0;
const takosCallbacks = new Map();
let port = null;
let extId = null;
function setPath(root, path, fn, transform) {
  let obj = root;
  for (let i = 0; i < path.length - 1; i++) {
    obj[path[i]] ??= {};
    obj = obj[path[i]];
  }
  obj[path[path.length - 1]] = (...args) => fn(transform, args);
}
function createTakos(paths) {
  const t = {};
  for (const p of paths) {
    setPath(
      t,
      p,
      (tr, args) =>
        new Promise((resolve, reject) => {
          const id = ++takosCallId;
          takosCallbacks.set(id, { resolve, reject, transform: tr });
          port.postMessage({ type: "takosCall", id, path: p, args });
        }),
      p[0] === "fetch"
        ? (d) =>
          new Response(d.body ? new Uint8Array(d.body) : undefined, {
            status: d.status,
            statusText: d.statusText,
            headers: d.headers,
          })
        : null,
    );
  }
  return t;
}
import * as mod from "__CLIENT_PATH__";
self.onmessage = async (e) => {
  const d = e.data;
  if (d.type === "init") {
    port = e.ports[0];
    extId = d.id;
    globalThis.takos = createTakos(d.takosPaths);
    port.postMessage({ type: "ready" });
  } else if (d.type === "call") {
    try {
      let target = mod;
      for (const part of d.fnName.split(".")) target = target?.[part];
      if (typeof target !== "function") {
        throw new Error("function not found: " + d.fnName);
      }
      const result = await target(...d.args);
      port.postMessage({ type: "result", id: d.id, result });
    } catch (err) {
      port.postMessage({
        type: "error",
        id: d.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else if (d.type === "takosResult") {
    const cb = takosCallbacks.get(d.id);
    if (!cb) return;
    takosCallbacks.delete(d.id);
    const result = cb.transform ? cb.transform(d.result) : d.result;
    if ("error" in d) cb.reject(new Error(d.error));
    else cb.resolve(result);
  }
};

self.addEventListener("push", (event) => {
  event.waitUntil(handlePush(event));
});

async function handlePush(event) {
  if (!extId) return;
  try {
    let data = event.data ? event.data.json() : {};
    if (typeof data.payload === "string") {
      try {
        data = JSON.parse(data.payload);
      } catch {
        // ignore
      }
    }
    if (data.fn) {
      let target = mod;
      for (const part of data.fn.split(".")) target = target?.[part];
      if (typeof target === "function") {
        await target(...(data.args || []));
      }
    }
  } catch (err) {
    console.error("push handler error", err);
  }
}
