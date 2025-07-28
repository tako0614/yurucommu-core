# takosとは

> **言語について**: README
> とドキュメントは日本語版のみ提供されています。(English version is not
> available yet)

takosはActivityPubでweb自主するためのソフトウェアです。
takosは、ActivityPubに追加で、以下の機能を提供します。

このソフトウェアは、1人のユーザが、他のユーザとコミュニケーションを取るためのものです。
基本的に同一ドメインのユーザーは同一人物です。(サブアカウントなど)

## 🔧 技術スタック

**言語/ランタイム**: TypeScript/Deno\
**バックエンドフレームワーク**: Hono\
**フロントエンドフレームワーク**: Solid.js/tauri\
**データベース**: mongodb mongoose

## 🚀 GET started(backend)

環境変数を設定したら、`app/api` ディレクトリからサーバーを起動します。

MongoDB にはセッション自動削除用の TTL インデックスが必要です。初回起動前に
`scripts/create_session_indexes.ts` を実行して `Session` と `HostSession`
コレクションへインデックスを作成してください。
セッションの有効期限はリクエストごとに 7 日間延長されます。

特に `ACTIVITYPUB_DOMAIN` は Mastodon など外部からアクセスされる公開ドメインを
設定してください。未設定の場合はリクエストされたホスト名が利用されます。 以前の
`TENANT_ID` 変数は廃止され、ドメイン名そのものがテナント ID として扱われます。
リレーサーバーの設定は UI から追加・削除でき、データベースに保存されます。
登録したリレーとは `Follow` を送っておくことで投稿が inbox に届きます。
`getEnv(c)` で取得した環境変数を `fetchJson` や `deliverActivityPubObject`
へ渡すことで マルチテナント環境でも正しいドメインが利用されます。
`RELAY_POLL_INTERVAL` で指定した 間隔ごとに、登録済みリレーの `/api/posts`
を取得し、新規投稿を `object_store` へ 自動保存します。

### 初期設定

`.env`
を用意してサーバーを起動すると、未設定の場合はブラウザで初期設定画面が表示
されます。最初のアカウント作成や著名ユーザーのフォロー登録を行ってください。CLI
で 実行する場合は次のコマンドでも設定できます。

```bash
deno run -A setup.ts
```

### 統合オブジェクトストア

すべての ActivityPub オブジェクトは `object_store` コレクションに保存されます。
各ドキュメントには投稿元ドメインを示す `tenant_id` フィールドが追加され、
複数インスタンスで同じ MongoDB を共有しても互いのデータが混在しません。スキーマ
は次の通りです。

```jsonc
{
  _id: "https://example.org/objects/xxx",
  raw: { ... },
  type: "Note",
  actor_id: "https://example.org/users/alice",
  tenant_id: "example.org",
  created_at: ISODate(),
  updated_at: ISODate(),
  deleted_at: Optional<ISODate>,
  aud: { to: ["...#Public"], cc: [] }
}
```

`ACTIVITYPUB_DOMAIN` がテナント ID を兼ねており、ドメインごとにフォロー情報を
`follow_edge` コレクションで管理します。

ローカルアカウントやコミュニティ、通知など他のコレクションも `tenant_id`
フィールドで区別されます。takos host 上では単一の MongoDB を
共有しつつ、インスタンスごとのデータが混在しないよう設計されています。

```bash
cd app/api
deno task dev
```

### フロントエンドのビルド

本番環境では先に `app/client` で次のコマンドを実行してアセットを生成します。

```bash
cd app/client
deno task build
```

生成された `dist` フォルダーは `app/api` サーバーから自動的に配信されます。

## ActivityPub エンドポイント

サーバーを起動すると以下の ActivityPub API が利用できます。

- `/.well-known/webfinger` – WebFinger でアクターを検索
- `/users/:username` – `Person` アクター情報を JSON-LD で返します
- `/users/:username/outbox` – `Note` の投稿と取得
- `/users/:username/inbox` – ActivityPub 受信エンドポイント。`Create` Activity
  の場合はオブジェクトを `object_store` に保存し、他の Activity
  は保存せず処理のみ行います。処理は Activity タイプごとにハンドラー化し、
  新しい Activity を追加しやすくしています。
- `/inbox` – サイト全体の共有 inbox。`to` などにローカルアクターが含まれる
  Activity をそれぞれの inbox 処理へ振り分けます。

これらのルートは `/` 直下に配置されており、`/api` のルートとは競合しません。

`outbox` へ `POST` すると以下の形式でノートを作成できます。

```json
{
  "type": "Note",
  "content": "hello"
}
```

## フォロー API

- `POST /api/follow` – 他のユーザーをフォロー
- `DELETE /api/follow` – フォロー解除
- `GET /api/users/:username/followers` – フォロワー一覧を JSON で取得
- `GET /api/users/:username/following` – フォロー中ユーザー一覧を JSON で取得

ActivityPub 形式の一覧が必要な場合は、`/activitypub/users/:username/followers`
や `/activitypub/users/:username/following` を利用します。こちらは
`OrderedCollection` 形式で返され、ページングに対応しています。

## JSON 投稿 API

ローカル向けの JSON 版エンドポイント `/api/posts` では手軽に投稿の作成・取得が
できます。外部との連携には ActivityPub の `/users/:username/outbox` を利用して
ください。

- `GET /api/posts` – 公開タイムラインを取得（登録済みリレーからの投稿も含む）
- `GET /api/posts?timeline=followers&actor=URI` –
  フォロー中アクターの投稿のみ取得
- `POST /api/posts` – 投稿を作成 (`{ "author": "user", "content": "hello" }`)
- `PUT /api/posts/:id` – 投稿を更新 (`{ "content": "edited" }`)
- `DELETE /api/posts/:id` – 投稿を削除
- `POST /api/posts/:id/like` – いいねを追加
- `POST /api/posts/:id/retweet` – リツイートを追加

## 検索 API

- `GET /api/search?q=QUERY&type=users|posts|videos|all` –
  キーワードからユーザーや投稿、動画を検索します。 `type`
  を省略するとすべてが対象です。

### リンクプレビュー

投稿内にURLを含めると、最初に出現したリンクを基にOGP情報を取得し、タイムラインでカード形式のプレビューを表示します。
この処理はクライアント側で自動挿入される `<div data-og="URL"></div>` と
`/api/ogp` エンドポイントによって実現されています。

## 動画 API

ActivityPub の `Video` オブジェクトを利用して動画を投稿できます。

- `WebSocket /api/ws` – 動画アップロードや今後の双方向機能で利用する統一
  WebSocket

- `GET /api/videos` – 動画一覧を取得
- `POST /api/videos` – 動画を作成するとフォロワーへ `Create` Activity を配信
- `POST /api/videos/:id/like` – いいね数を増加
- `POST /api/videos/:id/view` – 再生数を増加

## リレー API

ほかのインスタンスと連携するためのリレーサーバーを管理します。

- `GET /api/relays` – 登録済みリレー一覧を取得
- `POST /api/relays` – `{ "inboxUrl": "https://relay.example/inbox" }`
  を送信して追加
- `DELETE /api/relays/:id` – リレーを削除

各インスタンスのリストは `relays` コレクションに基づきます。 takos host
のデフォルトリレーは自動登録されますが、一覧には表示されません。

## クライアントでのデータ保存

チャット機能で利用するMLS関連データは、ブラウザのIndexedDBに保存します。データベースは
アカウントIDごとに分割されており、別アカウントの情報が混在しないようになっています。

鍵共有の仕組みについては [docs/key-sharing.md](docs/key-sharing.md)
を参照してください。

## OpenAPI仕様

APIの詳細仕様は [docs/openapi.yaml](docs/openapi.yaml) に記載されています。
OpenAPI 対応ツールで読み込むことでクライアント実装やテストに利用できます。

## システム inbox とリレーサーバー

システム用 inbox とデフォルトリレーサーバーの設計については
[docs/system-inbox.md](docs/system-inbox.md) を参照してください。

## FCMによる通知

Firebase Cloud Messaging の設定と利用方法は [docs/fcm.md](docs/fcm.md)
を参照してください。Tauri 版では Rust 製プラグインと Kotlin サービスを使って FCM
を初期化します。
