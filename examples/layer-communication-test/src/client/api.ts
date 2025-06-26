// Client layer API for layer communication testing - Class-based API
// deno-lint-ignore-file no-explicit-any
const { takos } = globalThis as any;

// クラスベースイベント定義をインポート
import { Takos } from "../../../../packages/builder/src/classes.ts";

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

// Run comprehensive communication tests
export async function testAllFromClient(): Promise<TestResults> {
  const results: TestResults = {
    callServer: null,
    callUI: null,
    errors: []
  };

  try {
    results.callServer = await testCallServer();
  } catch (error) {
    results.errors.push(`Server test failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    results.callUI = await testCallUI();
  } catch (error) {
    results.errors.push(`UI test failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return results;
}

// Function to get the last few events from KV storage for demonstration
export async function getLastEvents() {
  try {
    return {
      lastServerEvent: await takos.kv.read("lastServerToClientEvent"),
      lastUIEvent: await takos.kv.read("lastUIToClientEvent"),
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error getting last events:", error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

// Client-side class-based event definitions
export const clientTakos = new Takos();

clientTakos.client("serverToClient", async (payload: unknown) => {
  console.log("[Client] Received event from server:", payload);
  
  try {
    await takos.kv.write("lastServerToClientEvent", payload);
    
    return {
      received: true,
      processedBy: "client",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error processing server event:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

clientTakos.client("uiToClient", async (payload: unknown) => {
  console.log("[Client] Received event from UI:", payload);
  
  try {
    await takos.kv.write("lastUIToClientEvent", payload);
    
    return {
      received: true,
      processedBy: "client", 
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error processing UI event:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

clientTakos.client("runClientTests", async (payload: unknown) => {
  console.log("[Client] Running tests requested from UI:", payload);
  
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
    
    await takos.events.publish("clientTestResults", {
      results: errorResult,
      timestamp: new Date().toISOString()
    });
    
    return errorResult;
  }
});

clientTakos.client("getClientEvents", async (payload: unknown) => {
  console.log("[Client] Getting client events requested from UI:", payload);
  
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
    
    await takos.events.publish("clientEventsResponse", {
      events: errorResult,
      timestamp: new Date().toISOString()
    });
    
    return errorResult;
  }
});