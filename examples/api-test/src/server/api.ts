// Server layer API for comprehensive Takos API testing
// deno-lint-ignore-file no-explicit-any
const { takos } = globalThis as any;

interface TestResult {
  success: boolean;
  data?: any;
  error?: string;
  timestamp: string;
}

interface EventPayload {
  message: string;
  timestamp?: string;
  [key: string]: unknown;
}

// Exported server function for testing
export function apiTestServer(testType: string, params?: any) {
  console.log(`[Server] apiTestServer called with: ${testType}`, params);
  return {
    layer: "server",
    testType,
    params,
    timestamp: new Date().toISOString(),
    result: `Server processed ${testType} test`
  };
}

// =============================================================================
// ActivityPub API Tests
// =============================================================================

export async function testActivityPubSend() {
  try {
    const currentUser = await takos.ap.currentUser();
    console.log(`[Server] Current user: ${currentUser}`);
    
    const note = {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Note",
      "content": "Hello from Takos API Test Extension!",
      "to": ["https://www.w3.org/ns/activitystreams#Public"],
      "published": new Date().toISOString()
    };
    
    await takos.ap.send({
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "actor": currentUser,
      "object": note,
      "to": ["https://www.w3.org/ns/activitystreams#Public"],
      "published": new Date().toISOString()
    });
    
    return [200, { 
      success: true, 
      message: "ActivityPub note sent successfully",
      currentUser,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] ActivityPub send error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

export async function testActivityPubList() {
  try {
    const activities = await takos.ap.list();
    console.log(`[Server] Found ${activities.length} activities`);
    
    return [200, { 
      success: true, 
      count: activities.length,
      activities: activities.slice(0, 5), // 最初の5件のみ返す
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] ActivityPub list error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

export async function testActivityPubActor() {
  try {
    const actor = await takos.ap.actor.read();
    console.log("[Server] Current actor:", actor);
    
    // アクターの一部情報を更新してテスト
    await takos.ap.actor.update("summary", "Updated from API Test Extension");
    
    return [200, { 
      success: true, 
      actor,
      message: "Actor read and updated successfully",
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] ActivityPub actor error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

// ActivityPub受信フック
export async function onActivityPubReceive(activity: any) {
  console.log("[Server] Received ActivityPub activity:", activity);
  
  try {
    // 受信したアクティビティをKVに保存
    await takos.kv.write(`received_activity_${Date.now()}`, {
      activity,
      processedAt: new Date().toISOString()
    });
    
    // UIにイベントを送信
    await takos.events.publish("activityReceived", {
      type: activity.type,
      actor: activity.actor,
      timestamp: new Date().toISOString()
    });
    
    return { processed: true };
  } catch (error) {
    console.error("[Server] Error processing ActivityPub receive:", error);
    return { processed: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// =============================================================================
// Plugin Actor API Tests
// =============================================================================

export async function testPluginActor() {
  try {
    // プラグインアクターを作成
    const actorId = await takos.ap.pluginActor.create("test-bot", {
      name: "Test Bot",
      summary: "A test bot created by API Test Extension",
      type: "Service"
    });
    
    console.log(`[Server] Created plugin actor: ${actorId}`);
    
    // 作成したアクターを読み取り
    const actor = await takos.ap.pluginActor.read(actorId);
    
    // アクターのリストを取得
    const actors = await takos.ap.pluginActor.list();
    
    return [200, {
      success: true,
      createdActor: actorId,
      actorData: actor,
      totalActors: actors.length,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] Plugin actor error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

// =============================================================================
// KV Storage API Tests
// =============================================================================

export async function testKVOperations() {
  try {
    const testKey = "test_key_" + Date.now();
    const testValue = {
      message: "Hello from KV!",
      timestamp: new Date().toISOString(),
      data: { test: true, number: 42 }
    };
    
    // 書き込み
    await takos.kv.write(testKey, testValue);
    console.log(`[Server] Wrote to KV: ${testKey}`);
    
    // 読み込み
    const readValue = await takos.kv.read(testKey);
    console.log(`[Server] Read from KV:`, readValue);
    
    // リスト取得
    const keys = await takos.kv.list();
    console.log(`[Server] KV keys count: ${keys.length}`);
    
    return [200, {
      success: true,
      written: testValue,
      read: readValue,
      keysCount: keys.length,
      testKey,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] KV operations error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

// =============================================================================
// CDN API Tests
// =============================================================================

export async function testCDNOperations() {
  try {
    const testPath = "test/api-test-" + Date.now() + ".json";
    const testData = JSON.stringify({
      message: "Hello from CDN!",
      timestamp: new Date().toISOString(),
      extension: "jp.takos.api-test"
    });
    
    // ファイルを書き込み
    const url = await takos.cdn.write(testPath, testData, { cacheTTL: 3600 });
    console.log(`[Server] Wrote to CDN: ${url}`);
    
    // ファイルを読み込み
    const readData = await takos.cdn.read(testPath);
    console.log(`[Server] Read from CDN:`, readData);
    
    // ファイルリストを取得
    const files = await takos.cdn.list("test/");
    console.log(`[Server] CDN files in test/: ${files.length}`);
    
    return [200, {
      success: true,
      url,
      written: testData,
      read: readData,
      filesCount: files.length,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] CDN operations error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

// =============================================================================
// Fetch API Tests
// =============================================================================

export async function testFetchAPI() {
  try {
    // JSONPlaceholderで簡単なHTTPテスト
    const response = await takos.fetch("https://jsonplaceholder.typicode.com/posts/1");
    const data = await response.json();
    
    console.log("[Server] Fetch test successful:", data.title);
    
    return [200, {
      success: true,
      status: response.status,
      data,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] Fetch API error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

// =============================================================================
// Events API Tests
// =============================================================================

export async function testEventsAPI() {
  try {
    // 各レイヤーにイベントを送信
    await takos.events.publish("serverToClient", {
      message: "Hello from server to client!",
      timestamp: new Date().toISOString()
    });
    
    await takos.events.publish("serverToUI", {
      message: "Hello from server to UI!",
      timestamp: new Date().toISOString()
    });
    
    // テストイベントを発火
    await takos.events.publish("testEvent", {
      source: "server",
      message: "Test event from server",
      timestamp: new Date().toISOString()
    });
    
    console.log("[Server] Events sent successfully");
    
    return [200, {
      success: true,
      message: "Events sent to client, UI, and test event fired",
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] Events API error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

// =============================================================================
// Extensions API Tests
// =============================================================================

export function testExtensionsAPI() {
  try {
    // 利用可能な拡張機能を取得
    const allExtensions = takos.extensions.all;
    console.log(`[Server] Found ${allExtensions.length} extensions`);
    
    // 自分自身の拡張機能を取得
    const selfExtension = takos.extensions.get("jp.takos.api-test");
    
    const result = {
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
      timestamp: new Date().toISOString()
    };
    
    return [200, result];
  } catch (error) {
    console.error("[Server] Extensions API error:", error);
    return [500, { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    }];
  }
}

// =============================================================================
// Event Handlers
// =============================================================================

export async function onTestEvent(payload: EventPayload) {
  console.log("[Server] onTestEvent called with payload:", payload);
  
  try {
    await takos.kv.write("lastTestEvent", {
      source: "server",
      payload,
      processedAt: new Date().toISOString()
    });
    
    return [200, { 
      received: true, 
      processedBy: "server",
      originalPayload: payload,
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    console.error("[Server] Error in onTestEvent:", error);
    return [500, { error: error instanceof Error ? error.message : String(error) }];
  }
}

// クライアントからのイベントハンドラー
export async function onClientToServer(payload: EventPayload) {
  console.log("[Server] onClientToServer called:", payload);
  
  try {
    await takos.kv.write("lastClientToServerEvent", payload);
    
    return [200, { 
      received: true, 
      processedBy: "server",
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    return [500, { error: error instanceof Error ? error.message : String(error) }];
  }
}

// UIからのイベントハンドラー
export async function onUIToServer(payload: EventPayload) {
  console.log("[Server] onUIToServer called:", payload);
  
  try {
    await takos.kv.write("lastUIToServerEvent", payload);
    
    return [200, { 
      received: true, 
      processedBy: "server",
      timestamp: new Date().toISOString()
    }];
  } catch (error) {
    return [500, { error: error instanceof Error ? error.message : String(error) }];
  }
}

// =============================================================================
// Comprehensive API Test
// =============================================================================

export async function runAllTests() {
  console.log("[Server] Running comprehensive API tests...");
  
  const results: Record<string, TestResult> = {};
  
  // ActivityPub tests
  try {
    const [status, data] = await testActivityPubList();
    results.activityPubList = {
      success: status === 200,
      data,
      timestamp: new Date().toISOString()
    };
  } catch (error) {    results.activityPubList = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
  
  // KV tests
  try {
    const [status, data] = await testKVOperations();
    results.kvOperations = {
      success: status === 200,
      data,
      timestamp: new Date().toISOString()
    };  } catch (error) {
    results.kvOperations = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
  
  // CDN tests
  try {
    const [status, data] = await testCDNOperations();
    results.cdnOperations = {
      success: status === 200,
      data,
      timestamp: new Date().toISOString()
    };  } catch (error) {
    results.cdnOperations = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
  
  // Fetch tests
  try {
    const [status, data] = await testFetchAPI();
    results.fetchAPI = {
      success: status === 200,
      data,
      timestamp: new Date().toISOString()
    };  } catch (error) {
    results.fetchAPI = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
  
  // Events tests
  try {
    const [status, data] = await testEventsAPI();
    results.eventsAPI = {
      success: status === 200,
      data,
      timestamp: new Date().toISOString()
    };  } catch (error) {
    results.eventsAPI = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
  
  // Extensions tests
  try {
    const [status, data] = await testExtensionsAPI();
    results.extensionsAPI = {
      success: status === 200,
      data,
      timestamp: new Date().toISOString()
    };  } catch (error) {
    results.extensionsAPI = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
  }
  
  const summary = {
    total: Object.keys(results).length,
    passed: Object.values(results).filter(r => r.success).length,
    failed: Object.values(results).filter(r => !r.success).length,
    timestamp: new Date().toISOString()
  };
  
  return [200, {
    success: true,
    summary,
    results,
    message: `API tests completed: ${summary.passed}/${summary.total} passed`
  }];
}
