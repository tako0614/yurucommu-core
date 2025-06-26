# 📝 Takopack 3.0 簡易クラスベースAPI ガイド

## 概要

Takopack 3.0では、シンプルで型安全なクラスベースAPIを使用してイベントを定義します。JSDocやデコレータベースの定義は廃止され、クラスインスタンスによる登録のみがサポートされます。

## 基本的な使用方法

### 1. 基本パターン

```typescript
import { Takos } from "../../../../packages/builder/src/classes.ts";

// Takosインスタンスを作成
export const takos = new Takos();

// イベントを直接登録（関数は個別にexportしない）
takos.client("eventName", (payload: unknown) => {
  console.log("Received:", payload);
  return { success: true };
});
```

### 2. 各レイヤーでの実装例

#### Client レイヤー (`src/client/events.ts`)
```typescript
import { Takos } from "../../../../packages/builder/src/classes.ts";

export const clientTakos = new Takos();

clientTakos.client("uiToClient", (payload: unknown) => {
  // UI からのイベント処理
  return { received: true, timestamp: new Date().toISOString() };
});

clientTakos.client("serverToClient", (payload: unknown) => {
  // Server からのイベント処理
  return { received: true, processedBy: "client" };
});
```

#### Server レイヤー (`src/server/events.ts`)
```typescript
import { Takos } from "../../../../packages/builder/src/classes.ts";

export const serverTakos = new Takos();

serverTakos.server("clientToServer", (payload: unknown) => {
  // Client からのイベント処理
  return { success: true, processedBy: "server" };
});

serverTakos.server("uiToServer", (payload: unknown) => {
  // UI からのイベント処理
  return { received: true, timestamp: new Date().toISOString() };
});
```

## 重要なポイント

### ✅ 推奨される書き方
- クラスインスタンスを`export`する
- イベントハンドラーは匿名関数またはアロー関数で直接登録
- 個別のハンドラー関数は`export`しない

### ❌ 廃止された書き方
```typescript
// ❌ JSDoc方式 (もう使えません)
/**
 * @event myEvent
 */
export function myHandler() {}

// ❌ デコレータ方式 (もう使えません)
@event("myEvent")
export function myHandler() {}

// ❌ 個別ハンドラーのexport (推奨しません)
export function myHandler() {}
export const takos = new Takos();
takos.client("myEvent", myHandler);
```

## 利点

1. **シンプル**: クラスインスタンス1つだけをexportするだけ
2. **型安全**: TypeScriptの型推論が働く
3. **一貫性**: すべてのレイヤーで同じAPI
4. **保守性**: イベント定義と実装が同じ場所にある

## manifest.json生成

このAPIを使用すると、以下のような`eventDefinitions`が自動生成されます：

```json
{
  "eventDefinitions": {
    "uiToClient": {
      "source": "client",
      "handler": "anonymous"
    },
    "clientToServer": {
      "source": "server", 
      "handler": "anonymous"
    }
  }
}
```

クラスベースAPIが見つからない場合、ビルドは失敗し、適切なエラーメッセージが表示されます。
