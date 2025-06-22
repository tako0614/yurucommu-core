// UI layer exports and event handlers
export async function onUiKv(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  await takos.kv.write("ui:test", "ok");
  const value = await takos.kv.read("ui:test");
  await takos.kv.delete("ui:test");
  return { value };
}

export async function onUiEvents(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  await takos.events.publish("uiPing", {});
  return { ok: true };
}

export async function onUiExtensions(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  const ext = takos.extensions.get("jp.takos.api-test");
  const api = await takos.activateExtension("jp.takos.api-test");
  return { has: !!ext, activated: typeof api?.publish === "function" };
}

export async function onUiFetch(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  const res = await takos.fetch("https://example.com");
  return { ok: res.ok };
}

export async function onUiUrl(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  const before = takos.getURL();
  let changed = false;
  const off = takos.changeURL(() => {
    changed = true;
  });
  takos.pushURL("tmp", { showBar: false });
  takos.setURL(before, { showBar: false });
  off();
  return { before, changed, after: takos.getURL() };
}

// Cross-layer communication functions
export async function onUiCallServer(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  try {
    const ext = takos.extensions.get("jp.takos.api-test");
    if (ext) {
      const api = await ext.activate();
      const result = await api.publish("onServerKv");
      return { success: true, result };
    }
    return { error: "Extension not found" };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function onUiCallClient(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  try {
    const ext = takos.extensions.get("jp.takos.api-test");
    if (ext) {
      const api = await ext.activate();
      const result = await api.publish("onClientKv");
      return { success: true, result };
    }
    return { error: "Extension not found" };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function onUiToServerEvent(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  try {
    await takos.events.publish("serverReceiveFromUi", { from: "ui", timestamp: Date.now() });
    return { success: true, message: "Event sent to server" };
  } catch (error) {
    return { error: String(error) };
  }
}

export async function onUiToClientEvent(): Promise<Record<string, unknown>> {
  if (typeof takos === "undefined") throw new Error("Takos API not available");
  
  try {
    await takos.events.publish("clientReceiveFromUi", { from: "ui", timestamp: Date.now() });
    return { success: true, message: "Event sent to client" };
  } catch (error) {
    return { error: String(error) };
  }
}

// Event receivers
export function onUiReceiveFromServer(payload: Record<string, unknown>): void {
  console.log("UI received from server:", payload);
  const output = document.getElementById("output");
  if (output) {
    const pre = document.createElement("pre");
    pre.textContent = `UI Event from Server: ${JSON.stringify(payload, null, 2)}`;
    output.prepend(pre);
  }
}

export function onUiReceiveFromClient(payload: Record<string, unknown>): void {
  console.log("UI received from client:", payload);
  const output = document.getElementById("output");
  if (output) {
    const pre = document.createElement("pre");
    pre.textContent = `UI Event from Client: ${JSON.stringify(payload, null, 2)}`;
    output.prepend(pre);
  }
}

export function onServerReceiveFromUi(payload: Record<string, unknown>): [number, Record<string, unknown>] {
  console.log("Server received from UI:", payload);
  return [200, { received: true, payload, timestamp: Date.now() }];
}

export function onClientReceiveFromUi(payload: Record<string, unknown>): [number, Record<string, unknown>] {
  console.log("Client received from UI:", payload);
  return [200, { received: true, payload, timestamp: Date.now() }];
}

// Make functions available globally for HTML to use
if (typeof globalThis !== "undefined") {
  Object.assign(globalThis, {
    onUiKv,
    onUiEvents,
    onUiExtensions,
    onUiFetch,
    onUiUrl,
    onUiCallServer,
    onUiCallClient,
    onUiToServerEvent,
    onUiToClientEvent,
    onUiReceiveFromServer,
    onUiReceiveFromClient,
    onServerReceiveFromUi,
    onClientReceiveFromUi
  });
}
