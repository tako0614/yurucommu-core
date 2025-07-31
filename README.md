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
を取得し、新規投稿を Note や Video などのコレクションへ自動保存します。

### 初期設定

`.env`
を用意してサーバーを起動すると、未設定の場合はブラウザで初期設定画面が表示
されます。最初のアカウント作成や著名ユーザーのフォロー登録を行ってください。CLI
で 実行する場合は次のコマンドでも設定できます。

```bash
deno run -A setup.ts
```

### 投稿オブジェクトの保存

投稿データは `notes`、`videos`、`messages`、`stories` の各コレクションに
分割して保存されます。各ドキュメントには投稿元ドメインを示す `tenant_id`
フィールドが追加され、複数インスタンスで同じ MongoDB を共有しても
互いのデータが混在しません。

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
  の場合はオブジェクトを各コレクションに保存し、他の Activity
  は保存せず処理のみ行います。処理は Activity タイプごとにハンドラー化し、
  新しい Activity を追加しやすくしています。
- `/inbox` – サイト全体の共有 inbox。`to` などにローカルアクターが含まれる
  Activity をそれぞれの inbox 処理へ振り分けます。
- `/.well-known/nodeinfo` – NodeInfo へのリンクを返します
- `/nodeinfo/2.0` – NodeInfo 本体を返します
- `/.well-known/x-nodeinfo2` – `/nodeinfo/2.0` へリダイレクト
- `/api/v1/instance` – Mastodon 互換のインスタンス情報 これらのルートは `/`
  直下に配置されており、`/api` のルートとは競合しません。
  フォロー一覧用のコレクションは `/ap/users/:username/followers` や
  `/ap/users/:username/following` から取得できます。

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

ActivityPub 形式の一覧が必要な場合は、`/ap/users/:username/followers` や
`/ap/users/:username/following` を利用します。こちらは `OrderedCollection`
形式で返され、ページングに対応しています。

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

動画のアップロードは WebSocket と HTTP POST の両方に対応しています。 HTTP
版はフォーム送信など単純な利用向けで、WebSocket 版は進捗表示など
インタラクティブな制御を行いたい場合に利用します。サーバー側の保存処理
は共通化されており、どちらの方法を選んでも同じ結果が得られます。
アップロード時は任意で `thumbnail` フィールドにサムネイル画像を指定できます。
WebSocket では Base64 文字列を、HTTP POST では multipart/form-data の
`thumbnail` パートに画像ファイルを送信してください。

## リレー API

ほかのインスタンスと連携するためのリレーサーバーを管理します。

- `GET /api/relays` – 登録済みリレー一覧を取得
- `POST /api/relays` – `{ "inboxUrl": "https://relay.example/inbox" }`
  を送信して追加
- `DELETE /api/relays/:id` – リレーを削除

各インスタンスのリストは `relays` コレクションに基づきます。 takos host
のデフォルトリレーは自動登録されますが、一覧には表示されません。

## アカウント管理 API

ローカルアカウントの作成や編集に利用するエンドポイントです。公開ユーザー情報の取得
やチャット関連機能を提供する `/api/users/*` とは目的が異なります。

- `GET /api/accounts` – アカウント一覧取得
- `POST /api/accounts` – アカウント作成
- `GET /api/accounts/:id` – アカウント取得（鍵情報を含む）
- `PUT /api/accounts/:id` – アカウント更新
- `DELETE /api/accounts/:id` – アカウント削除

## チャット API

エンドツーエンド暗号化に対応したチャット機能の API です。 `/api/users/*`
プレフィックスには公開ユーザー情報取得用のエンドポイントも含まれますが、
アカウント管理機能は `/api/accounts/*` で提供されます。

- `GET /api/users/:user/keyPackages` – KeyPackage 一覧取得
- `POST /api/users/:user/keyPackages` – KeyPackage 登録
- `GET /api/users/:user/keyPackages/:keyId` – KeyPackage 取得
- `DELETE /api/users/:user/keyPackages/:keyId` – KeyPackage 削除
- `GET /api/users/:user/encryptedKeyPair` – 暗号化鍵ペア取得
- `POST /api/users/:user/encryptedKeyPair` – 暗号化鍵ペア保存
- `DELETE /api/users/:user/encryptedKeyPair` – 暗号化鍵ペア削除
- `POST /api/users/:user/resetKeys` – 鍵情報リセット
- `GET /api/users/:user/messages` – メッセージ一覧取得
- `POST /api/users/:user/messages` – メッセージ送信
- `POST /api/files` – ファイルアップロード（HTTP のみ）
- `GET /api/files/:id` – ファイル取得
- `GET /api/files/messages/:messageId/:index` – メッセージ添付ファイル取得

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
