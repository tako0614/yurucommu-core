// Server layer API for layer communication testing
// deno-lint-ignore-file no-explicit-any
const { takos } = globalThis as any;

interface EventPayload {
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

interface TestResults {
  callClient: unknown;
  callUI: unknown;
  errors: string[];
}

// Server function that can be called from other layers
export function serverFunction(message: string) {
  console.log(`[Server] serverFunction called with: ${message}`);
  return {
    layer: "server",
    message: `Server processed: ${message}`,
    timestamp: new Date().toISOString()
  };
}

// Test calling client function from server
export async function testCallClient() {
  try {
    // Since we can't directly call client functions from server, we use events
    await takos.events.publish("serverToClient", {
      message: "Hello from server!",
      timestamp: new Date().toISOString()
    });
    
    console.log("[Server] Sent event to client");
    return { status: "Event sent to client" };
  } catch (error) {
    console.error("[Server] Error sending event to client:", error);
    throw error;
  }
}

// Test calling UI function from server (via events since UI is browser-only)
export async function testCallUI() {
  try {
    // Since we can't directly call UI functions from server, we use events
    await takos.events.publish("serverToUI", {
      message: "Hello from server!",
      timestamp: new Date().toISOString()
    });
    
    console.log("[Server] Sent event to UI");
    return { status: "Event sent to UI" };
  } catch (error) {
    console.error("[Server] Error sending event to UI:", error);
    throw error;
  }
}

// Event handler for receiving events from client
export async function onClientToServer(payload: EventPayload) {
  console.log("[Server] onClientToServer called with payload:", payload);
  
  try {
    // Store the event in KV for testing
    await takos.kv.write("lastClientToServerEvent", payload);
    console.log("[Server] Successfully stored client event in KV");
    
    return [200, { 
      received: true, 
      processedBy: "server",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] Error in onClientToServer:", error);
    return [500, { error: error instanceof Error ? error.message : String(error) }];
  }
}

// Event handler for receiving events from UI
export async function onUIToServer(payload: EventPayload) {
  console.log("[Server] onUIToServer called with payload:", payload);
  
  try {
    // Store the event in KV for testing
    await takos.kv.write("lastUIToServerEvent", payload);
    console.log("[Server] Successfully stored UI event in KV");
    
    return [200, { 
      received: true, 
      processedBy: "server",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] Error in onUIToServer:", error);
    return [500, { error: error instanceof Error ? error.message : String(error) }];
  }
}

// Get last received events for testing
export async function getLastEvents() {
  console.log("[Server] Getting last events from KV...");
  
  try {
    const clientEvent = await takos.kv.read("lastClientToServerEvent");
    const uiEvent = await takos.kv.read("lastUIToServerEvent");
    
    console.log("[Server] Retrieved clientEvent:", clientEvent);
    console.log("[Server] Retrieved uiEvent:", uiEvent);
    
    const result = {
      fromClient: clientEvent,
      fromUI: uiEvent
    };
    
    console.log("[Server] Returning events:", result);
    return result;
  } catch (error) {
    console.error("[Server] Error getting events:", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Test all communication patterns from server
export async function testAllFromServer() {
  const results: TestResults = {
    callClient: null,
    callUI: null,
    errors: []
  };
  
  try {
    results.callClient = await testCallClient();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.errors.push(`Client call error: ${errorMessage}`);
  }
  
  try {
    results.callUI = await testCallUI();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.errors.push(`UI call error: ${errorMessage}`);
  }
  
  return results;
}
