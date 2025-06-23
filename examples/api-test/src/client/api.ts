// Client layer API for comprehensive Takos API testing
// deno-lint-ignore-file no-explicit-any
const { takos } = globalThis as any;

interface EventPayload {
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

// Exported client function for testing
export function apiTestClient(testType: string, params?: any) {
  console.log(`[Client] apiTestClient called with: ${testType}`, params);
  return {
    layer: "client",
    testType,
    params,
    timestamp: new Date().toISOString(),
    result: `Client processed ${testType} test`
  };
}

// =============================================================================
// KV Storage API Tests (Client-side IndexedDB)
// =============================================================================

export async function testClientKV() {
  try {
    const testKey = "client_test_" + Date.now();
    const testValue = {
      message: "Hello from client KV!",
      timestamp: new Date().toISOString(),
      clientData: { test: true, number: 42 }
    };
    
    // クライアント側KVに書き込み（IndexedDBベース）
    await takos.kv.write(testKey, testValue);
    console.log(`[Client] Wrote to client KV: ${testKey}`);
    
    // 読み込み
    const readValue = await takos.kv.read(testKey);
    console.log(`[Client] Read from client KV:`, readValue);
    
    // リスト取得
    const keys = await takos.kv.list();
    console.log(`[Client] Client KV keys count: ${keys.length}`);
    
    return {
      success: true,
      written: testValue,
      read: readValue,
      keysCount: keys.length,
      testKey,
      note: "Client KV uses IndexedDB and is independent from server KV",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] KV operations error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// =============================================================================
// Events API Tests
// =============================================================================

export async function testClientEvents() {
  try {
    // サーバーにイベントを送信
    await takos.events.publish("clientToServer", {
      message: "Hello from client!",
      timestamp: new Date().toISOString(),
      clientInfo: { userAgent: navigator.userAgent }
    });
    
    // UIにイベントを送信
    await takos.events.publish("clientToUI", {
      message: "Hello from client to UI!",
      timestamp: new Date().toISOString(),
      data: { test: true }
    });
    
    // テストイベントを発火
    await takos.events.publish("testEvent", {
      source: "client",
      message: "Test event from client",
      timestamp: new Date().toISOString()
    });
    
    console.log("[Client] Events sent successfully");
    
    return {
      success: true,
      message: "Events sent to server, UI, and test event fired",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Events API error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// =============================================================================
// Extensions API Tests
// =============================================================================

export async function testClientExtensions() {
  try {
    // 利用可能な拡張機能を取得
    const allExtensions = takos.extensions.all;
    console.log(`[Client] Found ${allExtensions.length} extensions`);
    
    // 自分自身の拡張機能を取得
    const selfExtension = takos.extensions.get("jp.takos.api-test");
    
    // 他の拡張機能があれば呼び出しテスト
    let invokeTest = null;
    if (allExtensions.length > 1) {
      try {
        // layer-communication-testがあれば呼び出し
        const layerTestExt = takos.extensions.get("jp.takos.layer-communication-test");
        if (layerTestExt && layerTestExt.isActive) {
          const activatedExt = await layerTestExt.activate();
          invokeTest = await activatedExt.publish("clientFunction", "Hello from api-test extension!");
        }
      } catch (error) {
        console.log("[Client] Extension invoke test failed:", error);
      }
    }
    
    return {
      success: true,
      totalExtensions: allExtensions.length,
      extensions: allExtensions.map((ext: any) => ({
        identifier: ext.identifier,
        version: ext.version,
        isActive: ext.isActive
      })),
      selfExtension: selfExtension ? {
        identifier: selfExtension.identifier,
        version: selfExtension.version,
        isActive: selfExtension.isActive
      } : null,
      invokeTest,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Extensions API error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// =============================================================================
// Fetch API Tests (if allowed)
// =============================================================================

export async function testClientFetch() {
  try {
    // JSONPlaceholderで簡単なHTTPテスト
    const response = await takos.fetch("https://jsonplaceholder.typicode.com/posts/1");
    const data = await response.json();
    
    console.log("[Client] Fetch test successful:", data.title);
    
    return {
      success: true,
      status: response.status,
      data,
      note: "Client fetch requires allowedConnectSrc configuration",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Fetch API error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      note: "Client fetch may be restricted by allowedConnectSrc settings"
    };
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

export async function onServerToClient(payload: EventPayload) {
  console.log("[Client] Received event from server:", payload);
  
  try {
    // クライアント側KVに保存
    await takos.kv.write("lastServerToClientEvent", {
      payload,
      receivedAt: new Date().toISOString()
    });
    
    return { 
      received: true, 
      processedBy: "client",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error handling server event:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function onUIToClient(payload: EventPayload) {
  console.log("[Client] Received event from UI:", payload);
  
  try {
    // クライアント側KVに保存
    await takos.kv.write("lastUIToClientEvent", {
      payload,
      receivedAt: new Date().toISOString()
    });
    
    return { 
      received: true, 
      processedBy: "client",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error handling UI event:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function onTestEvent(payload: EventPayload) {
  console.log("[Client] onTestEvent called:", payload);
  
  try {
    await takos.kv.write("lastTestEventFromClient", {
      payload,
      processedAt: new Date().toISOString()
    });
    
    return { 
      received: true, 
      processedBy: "client",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("[Client] Error in onTestEvent:", error);
    return {
      received: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

// =============================================================================
// Comprehensive Client Tests
// =============================================================================

export async function runClientTests() {
  console.log("[Client] Running client-side API tests...");
  
  const results: Record<string, any> = {};
  
  // Client KV tests
  try {
    const result = await testClientKV();
    results.clientKV = result;
  } catch (error) {
    results.clientKV = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  
  // Client Events tests
  try {
    const result = await testClientEvents();
    results.clientEvents = result;
  } catch (error) {
    results.clientEvents = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  
  // Client Extensions tests
  try {
    const result = await testClientExtensions();
    results.clientExtensions = result;
  } catch (error) {
    results.clientExtensions = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  
  // Client Fetch tests
  try {
    const result = await testClientFetch();
    results.clientFetch = result;
  } catch (error) {
    results.clientFetch = {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
  
  const summary = {
    total: Object.keys(results).length,
    passed: Object.values(results).filter((r: any) => r.success).length,
    failed: Object.values(results).filter((r: any) => !r.success).length,
    timestamp: new Date().toISOString()
  };
  
  return {
    success: true,
    summary,
    results,
    message: `Client tests completed: ${summary.passed}/${summary.total} passed`
  };
}

// =============================================================================
// Initialization
// =============================================================================

// クライアント初期化時に自動実行されるセットアップ
export function initializeClient() {
  console.log("[Client] API Test Extension client layer initialized");
  
  // 定期的なヘルスチェック（オプション）
  setInterval(async () => {
    try {
      await takos.kv.write("clientHeartbeat", {
        timestamp: new Date().toISOString(),
        status: "healthy"
      });
    } catch (error) {
      console.error("[Client] Heartbeat failed:", error);
    }
  }, 60000); // 1分ごと
}

// 初期化実行
if (typeof globalThis !== 'undefined' && (globalThis as any).takos) {
  initializeClient();
}
