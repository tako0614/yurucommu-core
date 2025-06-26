// Class-based event definition - simplified approach
import { Takos } from "../../../../packages/builder/src/classes.ts";

// Takosインスタンスを作成してイベントを直接登録
export const takos = new Takos();

takos.client("uiToClient", (payload: unknown) => {
  console.log("[Client] Received event from UI (class-based):", payload);
  
  try {
    return { 
      received: true, 
      processedBy: "client-class",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error handling UI event:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

takos.client("serverToClient", (payload: unknown) => {
  console.log("[Client] Received event from server (class-based):", payload);
  
  try {
    return { 
      received: true, 
      processedBy: "client-class",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error handling server event:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});

takos.client("testEvent", (payload: unknown) => {
  console.log("[Client] onTestEvent called (class-based):", payload);
  
  try {
    return { 
      received: true, 
      processedBy: "client-class",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error in onTestEvent:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
});
