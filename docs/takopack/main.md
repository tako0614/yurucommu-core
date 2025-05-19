# 🐙 **Takos 拡張機能仕様書**

> **仕様バージョン**: v1.3（完全版） **最終更新**: 2025-05-14 **対象コア**:
> `takos-core >= 0.9.0 <1.0.0`

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
10. [セキュリティとサンドボックス](#セキュリティとサンドボックス)
11. [リソース管理と制限](#リソース管理と制限)
12. [エラー処理とタイムアウト](#エラー処理とタイムアウト)

---

## 1. 目的

takosをVSCodeのように安全かつ柔軟に拡張可能にすること。 すべての機能を
`server.js` と `index.html` の2ファイルに集約した最小構成を提供する。

---

## 2. 用語

| 用語             | 説明                                                          |
| ---------------- | ------------------------------------------------------------- |
| Pack (.takopack) | 拡張機能パッケージ（zip形式）。内部トップフォルダが`takos/`。 |
| Identifier       | `com.example.foo`形式。`m.*` は公式予約。                     |
| Permission       | Packが利用する権限文字列。                                    |

---

## 3. パッケージ構造

```
awesome-pack.takopack
└─ takos/
    ├─ manifest.json      # 必須
    ├─ server.js          # サーバー (ESModule)
    └─ index.html         # クライアント (UI/JS/CSS)
```

---

## 4. manifest.json 詳細仕様

- サンプルはコメントを含むため「JSONC」（JSON with Comments）形式として扱います。

```jsonc
{
  "name": "awesome-pack",
  "description": "A brief description of the extension's functionality.",
  "version": "1.2.0",
  "identifier": "com.example.awesome",
  "apiVersion": "1.3",
  "engines": { "takos": ">=0.9.0 <1.0.0" },
  "permissions": [
    "takos.fetch.server",
    "takos.fetch.client",
    "takos.activityPub.send.server",
    "takos.kv.server",
    "takos.kv.client",
    "takos.assets.server",
    "takos.assets.client",
    "takos.events.server",
    "takos.events.client",
    "takos.activityPub.get.server",
    "takos.activityPub.receive.server",
    "takos.activityPub.actor.server",
    // 以下のdeno.*権限は高度な特権を持ちます。使用に関して警告が表示されます。
    "deno.read", // システムファイル読み取り
    "deno.write", // システムファイル書き込み
    "deno.net", // 任意のネットワーク接続
    "deno.env", // 環境変数へのアクセス
    "deno.run", // システムコマンド実行
    "deno.sys", // システム情報の取得
    "deno.ffi" // ネイティブコードの呼び出し
  ],
  "server": {
    "entry": "./server.js",
    "sourcemap": true // ソースマップ内部埋め込みを有効化（デバッグ用）
  },
  "client": {
    "entry": "./index.html",
    "csrfProtection": true, // CSRFトークン自動付与（デフォルトtrue）
    "allowedConnectSrc": [] // fetch.client権限使用時に追加されるCSPのconnect-src
  },
  "lifecycle": {
    "onInstall": "./server.js#onInstall",
    "onUpgrade": "./server.js#onUpgrade", // 引数: oldVersion, newVersion
    "onUninstall": "./server.js#onUninstall"
  },
  "activityPub": {
    "objects": [{
      "accepts": ["Note", "Create", "Like"], // 受け入れ可能なActivityPubオブジェクト型
      "context": "https://www.w3.org/ns/activitystreams",
      "hooks": {
        "canAccept": "./server.js#canAccept",
        "onReceive": "./server.js#onReceive",
        "priority": 0, // フック実行優先度（高いほど先に実行、デフォルト0）
        "serial": false // true: 順次実行、false: 並列実行（デフォルトfalse）
      }
    }],
    "actor": {
      "editable": [
        // Actor 配下で **この拡張が書き換えてよい** JSON-Pointer
        "/extensions/accountKeyUrl"
      ]
    }
  },
  "eventDefinitions": {
    "postMessage": {
      "direction": "client→server",
      "handler": "onPostMessage"
    },
    "notifyClient": {
      "direction": "server→client",
      "clientHandler": "onNotifyClient"
    }
  }
}
```

#### lifecycle関数の引数

- `onInstall(version: string): Promise<void>|void`\
  インストール時に呼ばれます。`version`はインストールされるバージョン文字列です。
- `onUpgrade(oldVersion: string, newVersion: string): Promise<void>|void`\
  アップグレード時に呼ばれます。`oldVersion`は旧バージョン、`newVersion`は新バージョンです。
- `onUninstall(version: string): Promise<void>|void`\
  アンインストール時に呼ばれます。`version`はアンインストールされるバージョン文字列です。

---

## 5. 名前空間と衝突回避

- Identifier は逆FQDN形式。`m.*` は公式予約。
- 同一identifier衝突時は先着優先。
- 各パッケージのKV、アセットは自動的に名前空間分離される。
  - KVキー: `${identifier}:${key}` 形式で内部保存
  - アセット: `${identifier}/${path}` 形式でアクセス可能

---

## 6. APIと必要な権限

### ActivityPub
- **オブジェクト操作**
  - `takos.activityPub.send(userId: string, activity: object): Promise<void>`
  - `takos.activityPub.get(id: string): Promise<object>`
  - `takos.activityPub.delete(id: string): Promise<void>`
  - `takos.activityPub.list(userId?: string): Promise<string[]>`

- **アクター操作**
  - `takos.activityPub.actor.get(userId: string): Promise<object>`
  - `takos.activityPub.actor.set(userId: string, key: string, value: string): Promise<void>`
  - `takos.activityPub.actor.delete(userId: string, key: string): Promise<void>`
  - `takos.activityPub.follow(followerId: string, followeeId: string): Promise<void>`
  - `takos.activityPub.unfollow(followerId: string, followeeId: string): Promise<void>`
  - `takos.activityPub.listFollowers(actorId: string): Promise<string[]>`
  - `takos.activityPub.listFollowing(actorId: string): Promise<string[]>`

権限: [
  `takos.activityPub.send.server`,
  `takos.activityPub.get.server`,
  `takos.activityPub.delete.server`,
  `takos.activityPub.list.server`,
  `takos.activityPub.actor.server`
]

### kv

- `takos.kv.get(key: string): Promise<any>` - 値取得
- `takos.kv.set(key: string, value: any): Promise<void>` - 値保存
- `takos.kv.delete(key: string): Promise<void>` - キー削除
- `takos.kv.list(): Promise<string[]>` - すべてのキー取得

権限: [`takos.kv.server`, `takos.kv.client`]

### fetch

- `takos.fetch(url: string, options?: object): Promise<Response>`
  - `options.signal`でAbortSignal指定でタイムアウト管理可能

権限: [`takos.fetch.server`, `takos.fetch.client`]
※クライアント側では`client.allowedConnectSrc`の指定が必要

### takos.assets

- `takos.assets.get(path: string): Promise<string>`\
  指定パスのアセット公開 URL を取得します。
- `takos.assets.set(path: string, data: string | Uint8Array, options?: { cacheTTL?: number }): Promise<string>`\
  アセットを CDN にアップロードし、公開 URL を返却します。`options.cacheTTL`
  でキャッシュ有効期限（ms）指定可（デフォルト3600000）。
- `takos.assets.delete(path: string): Promise<void>`\
  指定パスのアセットと CDN キャッシュを削除します。
- `takos.assets.list(prefix?: string): Promise<string[]>`\
  指定プレフィックス以下のアセットパス一覧を取得します。

権限: [`takos.assets.server`, `takos.assets.client`]\
※ 各パッケージ合計20MBまで\
※ CDN エンドポイント: `/cdn/<identifier>/<path>` から配信\
※ クライアントで外部 fetch を行う場合は `client.allowedConnectSrc` に CDN
ドメインを追加してください

### events

server

- `takos.events.send(eventName: string, payload: any): Promise<[200|400|500, object]>`
  client
- `takos.events.sendToClient(eventName: string, payload: any): Promise<void>`
- `takos.events.on(eventName: string, handler: Function): void`

権限: [`takos.events.client`, `takos.events.server`] ※レート制限:
10件/秒（デフォルト）

---

## 7. globalThis.takos API 詳細

`globalThis.takos`経由で利用。すべて非同期処理（Promise）。

```js
const { takos } = globalThis;

// Promise方式
takos.kv.get("key").then((value) => {
  console.log(value);
});

// async/await方式
async function example() {
  const value = await takos.kv.get("key");
  console.log(value);
}
```

---

## 8. ActivityPubフック処理

`activityPub.accepts`に記載したobjectを受信時:

- `canAccept(obj)`を全Packで評価。falseがあれば拒否
- 全trueなら`onReceive(obj)`を呼び出し処理

### フック制御

- **並列実行**: `serial: false`（デフォルト）、タイムアウト競合
- **順次実行**: `serial: true`、優先度の高いものから順に実行
- **優先順位**: `priority`値が高いほど先に実行（デフォルト0）

### 衝突解決

- `canAccept`: 1つでも`false`を返すと拒否
- `onReceive`: 各Pack処理を順次適用（Reduce-like）

```js
// 優先度順: PackA → PackB → PackC
const afterA = await PackA.onReceive(initialObject);
const afterB = await PackB.onReceive(afterA);
const finalObject = await PackC.onReceive(afterB);
```

### 実装規定

- `canAccept`: boolean|Promise<boolean>、タイムアウト時は`false`
- `onReceive`: object|Promise<object>、変更なしは受取オブジェクトをそのまま返す

## 9. イベント定義と利用法

- `eventDefinitions`でイベント定義
- `server.js`で処理関数を実装・export
- クライアント→サーバー: `takos.events.send(eventName, payload)`
- サーバー→クライアント: `takos.events.sendToClient(eventName, payload)`

**実装規定**:

- 戻り値: `[200|400|500, { /* body */ }]`|Promise<[number, object]>
- タイムアウト時は`[500, { error: "Timeout" }]`を返却

---

## 10. セキュリティとサンドボックス

- 動的import禁止。**server.jsとindex.htmlは事前バンドル済みの単一ファイル**であること
- デフォルトCSP: `default-src 'self'; script-src 'self'; connect-src 'self'`
- 外部接続には`takos.fetch.client`権限と`client.allowedConnectSrc`指定が必要
- サーバー: Deno環境、`--allow-none`起動、公開APIは`globalThis.takos`のみ
- CSRFトークン: `client.csrfProtection`が`true`で自動付与
- __deno._ 権限警告_*:
  これらの権限を必要とする拡張機能をインストールまたは有効化する際には、特権アクセスに関する警告が表示され、ユーザーの明示的な承認が必要となります
- **権限評価**: deno.*
  権限を持つ拡張機能は、インストール前およびアップデート時に自動的に安全性評価が行われます

---

## 11. リソース管理と制限

### cpu・ストレージ制限

#### CPU時間制限

**推奨値**:

- 通常のAPI処理: 1000ms以下
- イベントハンドラ: 2000ms以下

### パッケージ間分離

- Deno Isolateによる実行環境分離
- 拡張間の直接データ共有禁止
