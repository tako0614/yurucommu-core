# 🐙 **Takos 拡張機能仕様書**

> **仕様バージョン**: v2.1（拡張間API連携対応版）
> **最終更新**: 2025-06-11

## 🆕 **v2.1 主要変更点**

* **✅ 拡張機能間API連携**: `extensionDependencies`・`exports`・`takos.extensions` API・権限モデル追加
* **✅ イベント定義の統一**: `direction` → `source/target` 形式に変更
* **✅ 権限管理の一元化**: 個別関数から `manifest.permissions` に移行
* **✅ ActivityPub API統一**: 複数メソッドを単一 `activityPub()` メソッドに統合
* **✅ 型安全性の向上**: TypeScript完全対応と型推論の強化

---

## 📚 **目次**

1. [目的](#目的)
2. [用語](#用語)
3. [パッケージ構造](#パッケージ構造)
4. [manifest.json 詳細仕様](#manifestjson-詳細仕様)
5. [名前空間と衝突回避](#名前空間と衝突回避)
6. [APIと必要な権限](#apiと必要な権限)
7. [globalThis.takos API 詳細](#globalthistakos-api-詳細)
8. [ActivityPubフック処理](#activitypubフック処理)
9. [イベント定義と利用法](#イベント定義と利用法)
10. [v1.3からの移行ガイド](#v13からの移行ガイド)
11. [Sandbox 実行環境](#sandbox-実行環境)
12. [拡張機能間API連携仕様](#拡張機能間api連携仕様) ←★新規

---

## 1. 目的

takosをVSCodeのように安全かつ柔軟に拡張可能にすること。
最小構成は **サーバー・バックグラウンド・UI** の3レイヤーで成り立ち、
`server.js`・`client.js`・`index.html` の **3 ファイル** に集約される。

---

## 2. 用語

| 用語                    | 説明                                                |
| --------------------- | ------------------------------------------------- |
| Pack (.takopack)      | 拡張機能パッケージ（zip形式）。内部トップフォルダが`takos/`。              |
| Identifier            | `com.example.foo`形式。`takos` は公式予約。                |
| Permission            | Packが利用する権限文字列。v2.0では`resource:action(:scope)`形式。 |
| ExtensionDependencies | 依存する他の拡張パッケージ。manifestに配列で記述。                     |
| Exports               | この拡張が外部に公開するAPI一覧。manifestに記述。                    |

---

## 3. パッケージ構造

### 基本構造

```text
awesome-pack.takopack (ZIP形式)
└─ takos/
  ├─ manifest.json      # 必須
  ├─ server.js          # サーバー (単一ファイル、依存関係なし)
  ├─ client.js          # クライアント **バックグラウンドスクリプト** (単一ファイル、依存関係なし)
  └─ index.html         # クライアント **UI** (UI/JS/CSS)
```

### ファイル要件:

* `server.js`: Denoで動作する、依存関係のない単一JavaScriptファイル
* `client.js`: Denoで動作する、依存関係のない単一JavaScriptファイル
* `index.html`: ブラウザで動作する、依存関係のない単一HTMLファイル

---

## 4. manifest.json 詳細仕様

```jsonc
{
  "name": "awesome-pack",
  "description": "A brief description of the extension's functionality.",
  "version": "1.2.0",
  "identifier": "com.example.awesome",
  "icon": "./icon.png",
  "apiVersion": "2.1",

  // 追加：他拡張への依存定義
  "extensionDependencies": [
    { "identifier": "com.example.library", "version": "^1.0.0" }
  ],

  // 追加：外部公開APIの指定
  "exports": {
    "server": ["calculateHash", "sign"],
    "background": [],
    "ui": []
  },

  "permissions": [
    "fetch:net",
    "activitypub:send",
    "activitypub:read",
    "activitypub:receive:hook",
    "activitypub:actor:read",
    "activitypub:actor:write",
    "plugin-actor:create",
    "plugin-actor:read",
    "plugin-actor:write",
    "plugin-actor:delete",
    "kv:read",
    "kv:write",
    "cdn:read",
    "cdn:write",
    "events:publish",
    "events:subscribe",
    "extensions:invoke",   // 他拡張API呼び出し権限
    "extensions:export",   // 自身のAPI公開権限
    // 以下の特権権限は高度な権限を持ちます。使用に関して警告が表示されます。
    "deno:read",
    "deno:write",
    "deno:net",
    "deno:env",
    "deno:run",
    "deno:sys",
    "deno:ffi"
  ],
  "server": {
    "entry": "./server.js"
  },
  "client": {
    "entryUI": "./index.html",
    "entryBackground": "./client.js"
  },
  "activityPub": {
    "objects": [{
      "accepts": ["Note", "Create", "Like"],
      "context": "https://www.w3.org/ns/activitystreams",
      "hooks": {
        "canAccept": "canAccept",
        "onReceive": "onReceive",
        "priority": 1,
        "serial": false
      }
    }]
  },
  "eventDefinitions": {
    "postMessage": {
      "source": "client",
      "target": "server",
      "handler": "onPostMessage"
    },
    "notifyClient": {
      "source": "server",
      "target": "client",
      "handler": "onNotifyClient"
    },
    "notifyUI": {
      "source": "background",
      "target": "ui",
      "handler": "onNotifyUI"
    }
  }
}
```

---

## 5. 名前空間と衝突回避

* Identifier は逆FQDN形式。
* 同一identifier衝突時は先着優先。
* 各パッケージのKV、アセットは自動的に名前空間分離される。

  * KVキー: `${identifier}:${key}` 形式で内部保存
  * アセット: `${identifier}/${path}` 形式でアクセス可能
* **拡張APIエクスポート衝突**: 複数Packが同一関数名をexportしても、識別子ごとに完全分離される。
* **依存解決**: バージョン解決はnpm-semver互換。複数依存時は先着・最新版優先、警告通知。

---

## 6. API と必要な権限

> **既存のAPI説明は全てそのまま記載（省略なし）**
> **新規追加API・権限を本節内で明記**

### 6.1 ActivityPub

#### オブジェクト操作

- **send**:
  `takos.activitypub.send(userId: string, activity: object): Promise<void>`
  - **必要権限**: `activitypub:send`
- **read**: `takos.activitypub.read(id: string): Promise<object>`
  - **必要権限**: `activitypub:read`
- **delete**: `takos.activitypub.delete(id: string): Promise<void>`
  - **必要権限**: `activitypub:send`
- **list**: `takos.activitypub.list(userId?: string): Promise<string[]>`
  - **必要権限**: `activitypub:read`

#### フック処理

- ActivityPubオブジェクト受信時のフック処理
  - **必要権限**: `activitypub:receive:hook`

#### アクター操作

- **read**: `takos.activitypub.actor.read(userId: string): Promise<object>`
- **update**:
  `takos.activitypub.actor.update(userId: string, key: string, value: string): Promise<void>`
- **delete**:
  `takos.activitypub.actor.delete(userId: string, key: string): Promise<void>`
- **follow**:
  `takos.activitypub.follow(followerId: string, followeeId: string): Promise<void>`
- **unfollow**:
  `takos.activitypub.unfollow(followerId: string, followeeId: string): Promise<void>`
- **listFollowers**:
  `takos.activitypub.listFollowers(actorId: string): Promise<string[]>`
- **listFollowing**:
  `takos.activitypub.listFollowing(actorId: string): Promise<string[]>`

**必要権限**: `activitypub:actor:read` / `activitypub:actor:write`

### 6.2 プラグインアクター操作

プラグインが独自に管理するActivityPubアクターの操作。 作成されるアクターのIRIは
`https://{domain}/plugins/{identifier}/{localName}` 形式。

- **create**:
  `takos.activitypub.pluginActor.create(localName: string, profile: object): Promise<string>`
  - 戻り値は作成されたアクターのIRI
- **read**: `takos.activitypub.pluginActor.read(iri: string): Promise<object>`
- **update**:
  `takos.activitypub.pluginActor.update(iri: string, partial: object): Promise<void>`
- **delete**: `takos.activitypub.pluginActor.delete(iri: string): Promise<void>`
- **list**: `takos.activitypub.pluginActor.list(): Promise<string[]>`
  - このプラグインが作成したアクターのIRI一覧を返却

**必要権限**: `plugin-actor:create` / `plugin-actor:read` / `plugin-actor:write`
/ `plugin-actor:delete`

### 6.3 kv

- **read**: `takos.kv.read(key: string): Promise<any>`
- **write**: `takos.kv.write(key: string, value: any): Promise<void>`
- **delete**: `takos.kv.delete(key: string): Promise<void>`
- **list**: `takos.kv.list(): Promise<string[]>`

**必要権限**: `kv:read` / `kv:write`

※ `kv:write` は `kv:read`
を包含しません。読み取りが必要な場合は両方の権限が必要です。

> **メモ**: `server.js` からの `takos.kv.*` と `client.js` / `index.html` からの
> `takos.kv.*` は それぞれ独立したストレージ領域に保存されます。

### 6.4 fetch

- **fetch**: `takos.fetch(url: string, options?: object): Promise<Response>`
  - タイムアウトは `options.signal` で制御

**必要権限**: `fetch:net` _(クライアント側では `client.allowedConnectSrc`
設定が必要)_

### 6.5 cdn

- **read**: `takos.cdn.read(path: string): Promise<string>`
- **write**:
  `takos.cdn.write(path: string, data: string | Uint8Array, options?: { cacheTTL?: number }): Promise<string>`
- **delete**: `takos.cdn.delete(path: string): Promise<void>`
- **list**: `takos.cdn.list(prefix?: string): Promise<string[]>`

**必要権限**: `cdn:read` / `cdn:write`

- **制限**: 合計20MBまで
- **CDN エンドポイント**: `/cdn/<identifier>/<path>`

### 6.6 events

#### サーバー側 (server.js)

- `takos.events.publish(eventName: string, payload: any): Promise<[200|400|500, object]>`
- `takos.events.publishToClient(eventName: string, payload: any): Promise<void>`
- `takos.events.publishToClientPushNotification(eventName: string, payload: any): Promise<void>`

#### バックグラウンド (client.js)

- `takos.events.publishToUI(eventName: string, payload: any): Promise<void>`
- `takos.events.publishToBackground(eventName: string, payload: any): Promise<void>`

#### UI (index.html)

- `takos.events.publishToBackground(eventName: string, payload: any): Promise<void>`

**共通API**:

- `takos.events.subscribe(eventName: string, handler: (payload: any) => void): () => void`

**必要権限**: `events:publish` / `events:subscribe`

- **レート制限**: 10件/秒


### 6.7 **拡張間API呼び出し**

* **API呼び出し**:
  `takos.extensions.get(identifier: string): Extension | undefined`

  * **必要権限**: `extensions:invoke`
* **API公開**:
  manifestの`exports`に記載した関数だけをexport

  * **必要権限**: `extensions:export`
* **activate()パターン**:
  依存先APIは `await ext.activate()` で取得

---

## 7. globalThis.takos API 詳細

```typescript
// 既存API例はそのまま

// --- 追加 ---
namespace takos.extensions {
  function get(identifier: string): Extension | undefined;
  const all: Extension[];
}
interface Extension {
  identifier: string;
  version: string;
  isActive: boolean;
  activate(): Promise<any>; // manifest.exportsで宣言されたAPIを返す
}
```

### 追加利用例

**呼び出し側**（server.js等）:

```javascript
const ext = takos.extensions.get("com.example.library");
if (ext) {
  const api = await ext.activate();
  const hash = await api.calculateHash("hello");
  console.log(hash);
}
```

**公開側**（library/server.js）:

```javascript
export function activate() {
  return {
    async calculateHash(text) { /* ... */ },
    async sign(data, privKey) { /* ... */ }
  }
}
```

---

```javascript
const { takos } = globalThis;

// Promise方式
takos.kv.read("key").then((value) => console.log(value));

// async/await 方式
async function example() {
  const value = await takos.kv.read("key");
  console.log(value);

  // ActivityPub アクター取得例
  const actor = await takos.activitypub.actor.read("user123");

  // プラグインアクター作成例
  const actorIri = await takos.activitypub.pluginActor.create("bot1", {
    name: "My Bot",
    summary: "A helpful bot",
  });
}
```

## 8. ActivityPub フック処理

`activityPub.objects.accepts`に記載したオブジェクトタイプを受信時:

1. `canAccept(obj)`を全Packで評価。1つでも`false`があれば拒否
2. 全て`true`なら`onReceive(obj)`を呼び出し処理

### フック制御

- **並列実行** (`serial: false`):
  デフォルト。全フックを同時実行、タイムアウト競合
- **順次実行** (`serial: true`): 優先度の高いものから順に実行

### 衝突解決

- **canAccept**: 1つでも`false`を返すと拒否
- **onReceive**:
  - **並列実行時**: 各Pack処理を同時実行、最初に完了した結果を採用
  - **順次実行時**: 各Pack処理を順次適用（Reduce-like）

```javascript
// 順次実行の場合（priority: PackA=10, PackB=5, PackC=0）
const afterA = await PackA.onReceive(initialObject);
const afterB = await PackB.onReceive(afterA);
const finalObject = await PackC.onReceive(afterB);
```

### 実装規定 (ActivityPubフック)

- `canAccept`: `boolean|Promise<boolean>`、タイムアウト時は`false`扱い
- `onReceive`:
  `object|Promise<object>`、変更なしは受取オブジェクトをそのまま返す

---

## 9. イベント定義と利用法

- `eventDefinitions`でイベント定義（**v2.0新形式：source/target**）
- `server.js`で処理関数を実装・export
- **client→server**: `takos.events.publish(eventName, payload)`
- **server→client**: `takos.events.publishToClient(eventName, payload)`
- **background→ui**: `takos.events.publishToUI(eventName, payload)`
- **ui→background**: `takos.events.publishToBackground(eventName, payload)`

### イベント定義の新形式

```json
{
  "eventDefinitions": {
    "myEvent": {
      "source": "client", // 送信元：client, server, background, ui
      "target": "server", // 送信先：server, client, client:*, ui, background
      "handler": "onMyEvent" // ハンドラー関数名
    }
  }
}
```

**対応する方向性**:

- `client` → `server`
- `server` → `client` または `client:*` (ブロードキャスト)
- `background` → `ui`
- `ui` → `background`

### 実装規定 (イベント)

**server.js でのイベントハンドラー**:

- 戻り値: `[200|400|500, { /* body */ }]` または `Promise<[number, object]>`
- タイムアウト時は`[500, { error: "Timeout" }]`を返却

**client.js および index.html でのイベントハンドラー**:

- 戻り値: `void` または `Promise<void>`
- UI
  とバックグラウンド間のイベントは同一オリジン・同一拡張機能内のみ流れるため、追加の
  CSRF トークンや外部セキュリティチェックは不要

---

## 11. Sandbox 実行環境

* 拡張APIの呼び出し／公開も、Packごと・レイヤーごとにサンドボックス分離される
* activate()によるAPIエクスポート時は`exports`で指定された関数のみを対象とし、
  返却値・引数はstructuredClone準拠で伝達（クロスレイヤ・クロスPack安全）
* 呼び出し先Packの権限昇格はされず、API呼び出し権限はexport元拡張の範囲内に限定
* サイクル依存検出時はエラー

---

## 12. **拡張機能間API連携仕様**

### 12.1 依存とエクスポートの記述

* **`extensionDependencies`**:
  依存先Packのidentifier・バージョン範囲を宣言
  未インストール時はUIでインストールを促す

* **`exports`**:
  公開するAPI関数名をレイヤーごとに配列で列挙
  各レイヤー（server, background, ui）ごとに独立管理

### 12.2 権限制御

* **extensions\:export**

  * 自分のAPIを他拡張に公開する権限
* **extensions\:invoke**

  * 他拡張のAPIを取得・利用する権限
  * 拡張子ごと・レイヤーごとに権限昇格なし
  * manifestでscope指定可能（`extensions:invoke:com.example.library`）も将来拡張

### 12.3 API利用方法

* `takos.extensions.get(identifier)`

  * 依存先PackのExtensionオブジェクトを取得（なければundefined）
* `Extension.activate()`

  * 依存先APIオブジェクトをPromiseで返却
* APIエクスポートはactivate()の戻り値で、manifest.exportsで列挙した関数のみ可
* 他拡張のactivate()は複数回呼んでも同じAPIオブジェクトを返す

### 12.4 クロスPackの型安全

* TypeScript推奨。API呼び出し・返却値はstructuredClone準拠
* 依存Packの型定義（d.ts）はnpmのtypings同様、サイドローディング/型参照可能

### 12.5 バージョンと依存解決

* npm-semver準拠で解決。衝突時は警告＋最新版優先、複数依存可
* サイクル依存・バージョン不整合時はエラー

### 12.6 セキュリティとサンドボックス


* すべてのAPI呼び出しはstructuredClone準拠でシリアライズ
* クロスPackの権限制御、UIレイヤーのinvoke制限（background経由推奨）
* サンドボックス逸脱は不可
