# 🐙 **Takos 拡張機能仕様書**

> **仕様バージョン**: v2.0（改訂版） **最終更新**: 2025-06-01

## 🆕 **v2.0 主要変更点**

- **✅ イベント定義の統一**: `direction` → `source/target` 形式に変更
- **✅ 権限管理の一元化**: 個別関数から `manifest.permissions` に移行
- **✅ ActivityPub API統一**: 複数メソッドを単一 `activityPub()` メソッドに統合
- **✅ 型安全性の向上**: TypeScript完全対応と型推論の強化

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

---

## 1. 目的

takosをVSCodeのように安全かつ柔軟に拡張可能にすること。\
最小構成は **サーバー・バックグラウンド・UI** の3レイヤーで成り立ち、\
`server.js`・`client.js`・`index.html` の **3 ファイル** に集約される。

---

## 2. 用語

| 用語             | 説明                                                              |
| ---------------- | ----------------------------------------------------------------- |
| Pack (.takopack) | 拡張機能パッケージ（zip形式）。内部トップフォルダが`takos/`。     |
| Identifier       | `com.example.foo`形式。`takos` は公式予約。                       |
| Permission       | Packが利用する権限文字列。v2.0では`resource:action(:scope)`形式。 |

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

- `server.js`: Denoで動作する、依存関係のない単一JavaScriptファイル
- `client.js`: Denoで動作する、依存関係のない単一JavaScriptファイル
- `index.html`: ブラウザで動作する、依存関係のない単一HTMLファイル

<!-- 注意: `server.js` と `client.js` は、原則として関数宣言のみを記述し、トップレベルでの即時実行コードは避けてください。 -->
<!-- 用語補足: ここでの「バックグラウンドスクリプト」は拡張機能の背景処理を指し、UIの背景色(background)とは異なります。 -->

---

## 4. manifest.json 詳細仕様

```jsonc
{
  "name": "awesome-pack",
  "description": "A brief description of the extension's functionality.",
  "version": "1.2.0",
  "identifier": "com.example.awesome",
  "apiVersion": "2.0",
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
    "assets:read",
    "assets:write",
    "events:publish",
    "events:subscribe",
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

## 5. 名前空間と衝突回避

- Identifier は逆FQDN形式。
- 同一identifier衝突時は先着優先。
- 各パッケージのKV、アセットは自動的に名前空間分離される。
  - KVキー: `${identifier}:${key}` 形式で内部保存
  - アセット: `${identifier}/${path}` 形式でアクセス可能

---

## 6. API と必要な権限

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

### 6.4 fetch

- **fetch**: `takos.fetch(url: string, options?: object): Promise<Response>`
  - タイムアウトは `options.signal` で制御

**必要権限**: `fetch:net` _(クライアント側では `client.allowedConnectSrc`
設定が必要)_

### 6.5 assets

- **read**: `takos.assets.read(path: string): Promise<string>`
- **write**:
  `takos.assets.write(path: string, data: string | Uint8Array, options?: { cacheTTL?: number }): Promise<string>`
- **delete**: `takos.assets.delete(path: string): Promise<void>`
- **list**: `takos.assets.list(prefix?: string): Promise<string[]>`

**必要権限**: `assets:read` / `assets:write`

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

---

## 7. globalThis.takos の利用例

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

---

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

## 10. v1.3からv2.0への移行ガイド

### 🔄 主要な変更点

#### 1. イベント定義フォーマットの統一

**v1.3 (旧形式)**:

```json
{
  "eventDefinitions": {
    "myEvent": {
      "direction": "client→server",
      "handler": "onMyEvent"
    }
  }
}
```

**v2.0 (新形式)**:

```json
{
  "eventDefinitions": {
    "myEvent": {
      "source": "client",
      "target": "server",
      "handler": "onMyEvent"
    }
  }
}
```

#### 2. 権限管理の一元化

権限は`manifest.json`の`permissions`配列で一括管理されます。

#### 3. ActivityPub APIの統一

ActivityPub設定はmanifest.jsonの`activityPub`セクションで設定されます。

### 📋 移行チェックリスト

- [ ] **イベント定義を新形式に変更**
  - `direction: "client→server"` → `source: "client", target: "server"`
  - `direction: "server→client"` → `source: "server", target: "client"`
  - `direction: "background→ui"` → `source: "background", target: "ui"`
  - `direction: "ui→background"` → `source: "ui", target: "background"`

- [ ] **権限を一元化**
  - 全権限を`manifest.json`の`permissions`配列に集約

- [ ] **ActivityPub設定を更新**
  - `activityPub`セクションで設定を統一

### 🚀 推奨移行手順

1. **バックアップ作成**: 既存コードをバックアップ
2. **権限の洗い出し**: 使用している権限をリスト化
3. **イベント定義の変換**: direction形式をsource/target形式に変換
4. **権限の一元化**: manifestで権限を一括管理
5. **ActivityPub設定の更新**: 統一形式に変更
6. **テストの実行**: 新しい仕様での動作確認

移行に関する質問やサポートが必要な場合は、開発チームまでお問い合わせください。
