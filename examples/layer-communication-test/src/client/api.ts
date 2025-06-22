// Client layer API for layer communication testing
// deno-lint-ignore-file no-explicit-any
const { takos } = globalThis as any;

interface EventPayload {
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

interface TestResults {
  callServer: unknown;
  callUI: unknown;
  errors: string[];
}

// Client function that can be called from other layers
export function clientFunction(message: string) {
  console.log(`[Client] clientFunction called with: ${message}`);
  return {
    layer: "client",
    message: `Client processed: ${message}`,
    timestamp: new Date().toISOString()
  };
}

// Test calling server function from client
export async function testCallServer() {
  try {
    // Since we can't directly call server functions from client, we use events
    await takos.events.publish("clientToServer", {
      message: "Hello from client!",
      timestamp: new Date().toISOString()
    });
    
    console.log("[Client] Sent event to server");
    return { status: "Event sent to server" };
  } catch (error) {
    console.error("[Client] Error sending event to server:", error);
    throw error;
  }
}

// Test calling UI function from client (via events since UI is browser-only)
export async function testCallUI() {
  try {
    // Since we can't directly call UI functions from client, we use events
    await takos.events.publish("clientToUI", {
      message: "Hello from client!",
      timestamp: new Date().toISOString()
    });
    
    console.log("[Client] Sent event to UI");
    return { status: "Event sent to UI" };
  } catch (error) {
    console.error("[Client] Error sending event to UI:", error);
    throw error;
  }
}

// Send event to server
export async function sendEventToServer() {
  try {
    const result = await takos.events.publish("clientToServer", {
      message: "Hello from client via event!",
      timestamp: new Date().toISOString(),
      data: { test: true }
    });
    
    console.log("[Client] Sent event to server, result:", result);
    return result;
  } catch (error) {
    console.error("[Client] Error sending event to server:", error);
    throw error;
  }
}

// Event handler for receiving events from server
export async function onServerToClient(payload: EventPayload) {
  console.log("[Client] Received event from server:", payload);
  
  // Store the event in client KV for testing
  await takos.kv.write("lastServerToClientEvent", payload);
  
  return { 
    received: true, 
    processedBy: "client",
    originalPayload: payload,
    timestamp: new Date().toISOString()
  };
}

// Event handler for receiving events from UI
export async function onUIToClient(payload: EventPayload) {
  console.log("[Client] Received event from UI:", payload);
  
  // Store the event in client KV for testing
  await takos.kv.write("lastUIToClientEvent", payload);
  
  return { 
    received: true, 
    processedBy: "client",
    originalPayload: payload,
    timestamp: new Date().toISOString()
  };
}

// Get last received events for testing
export async function getLastEvents() {
  const serverEvent = await takos.kv.read("lastServerToClientEvent");
  const uiEvent = await takos.kv.read("lastUIToClientEvent");
  
  return {
    fromServer: serverEvent,
    fromUI: uiEvent
  };
}

// Test all communication patterns from client
export async function testAllFromClient() {
  const results: TestResults = {
    callServer: null,
    callUI: null,
    errors: []
  };
  
  try {
    results.callServer = await testCallServer();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.errors.push(`Server call error: ${errorMessage}`);
  }
  
  try {
    results.callUI = await testCallUI();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    results.errors.push(`UI call error: ${errorMessage}`);
  }
  
  return results;
}

// Event handler for triggering client tests from UI
export async function onTriggerClientTests(payload: EventPayload) {
  console.log("[Client] onTriggerClientTests called with payload:", payload);
  
  try {
    const results = await testAllFromClient();
    console.log("[Client] Test results:", results);
    
    // Send results back to UI via event
    await takos.events.publish("clientTestResults", {
      results: results,
      timestamp: new Date().toISOString()
    });
    console.log("[Client] Sent test results to UI");
    
    return results;
  } catch (error) {
    console.error("[Client] Error running tests:", error);
    const errorResult = { error: error instanceof Error ? error.message : String(error) };
    
    // Send error back to UI via event
    await takos.events.publish("clientTestResults", {
      results: errorResult,
      timestamp: new Date().toISOString()
    });
    
    return errorResult;
  }
}

// Event handler for getting client events from UI
export async function onGetClientEvents(payload: EventPayload) {
  console.log("[Client] onGetClientEvents called with payload:", payload);
  
  try {
    const events = await getLastEvents();
    console.log("[Client] Retrieved events:", events);
    
    // Send events back to UI via event
    await takos.events.publish("clientEventsResponse", {
      events: events,
      timestamp: new Date().toISOString()
    });
    console.log("[Client] Sent events response to UI");
    
    return events;
  } catch (error) {
    console.error("[Client] Error getting events:", error);
    const errorResult = { error: error instanceof Error ? error.message : String(error) };
    
    // Send error back to UI via event
    await takos.events.publish("clientEventsResponse", {
      events: errorResult,
      timestamp: new Date().toISOString()
    });
    
    return errorResult;
  }
}
