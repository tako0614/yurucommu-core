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
特定のインターフェースのみで待ち受けたい場合は `SERVER_HOST`
を、ポート番号を変更したい場合は `SERVER_PORT` を設定してください。HTTPS
を利用する場合は `SERVER_CERT` と `SERVER_KEY`
に証明書と秘密鍵の内容を直接指定します。
開発環境で自己署名証明書を使用する際は、起動時に
`--unsafely-ignore-certificate-errors` を付けると SSL エラーを無視できます。

MongoDB にはセッション自動削除用の TTL インデックスが必要です。初回起動前に
`scripts/create_session_indexes.ts` を実行して `Session` と `HostSession`
コレクションへインデックスを作成してください。
セッションの有効期限はリクエストごとに 7 日間延長されます。

特に `ACTIVITYPUB_DOMAIN` は Mastodon など外部からアクセスされる公開ドメインを
設定してください。未設定の場合はリクエストされたホスト名が利用されます。 以前の
`TENANT_ID` 変数は廃止され、ドメイン名そのものがテナント ID として扱われます。
`getEnv(c)` で取得した環境変数を `fetchJson` や `deliverActivityPubObject`
へ渡すことで マルチテナント環境でも正しいドメインが利用されます。

### 初期設定

`.env`
を用意してサーバーを起動すると、未設定の場合はブラウザで初期設定画面が表示
されます。最初のアカウント作成や著名ユーザーのフォロー登録を行ってください。CLI
で 実行する場合は次のコマンドでも設定できます。

```bash
deno run -A setup.ts
```

### 投稿オブジェクトの保存

投稿データは `notes`、`messages`、`stories` の各コレクションに
分割して保存されます。各ドキュメントには投稿元ドメインを示す `tenant_id`
フィールドが追加され、複数インスタンスで同じ MongoDB を共有しても
互いのデータが混在しません。

`tenant_id` は `tenantScope` プラグインにより自動的に付与され、セッションなど
他のドキュメントも同様にテナントごとに分離されます。

`ACTIVITYPUB_DOMAIN` がテナント ID を兼ねており、ドメインごとにフォロー情報を
`follow_edge` コレクションで管理します。

ローカルアカウントやコミュニティ、通知など他のコレクションも `tenant_id`
フィールドで区別されます。takos host 上では単一の MongoDB を
共有しつつ、インスタンスごとのデータが混在しないよう設計されています。

```bash
cd app/api
deno task dev --env path/to/.env
```

`--env` オプションで環境変数ファイルのパスを指定できます。

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
- `/users/:username/outbox` – `Message` を除いたオブジェクトの投稿と取得
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

`outbox` へ `POST` すると以下の形式でオブジェクトを作成できます。 `Message`
は投稿できません。

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

- `GET /api/posts` – 公開タイムラインを取得
- `GET /api/posts?timeline=following&actor=URI` –
  フォロー中アクターの投稿のみ取得
- `POST /api/posts` – 投稿を作成 (`{ "author": "user", "content": "hello" }`)
- `PUT /api/posts/:id` – 投稿を更新 (`{ "content": "edited" }`)
- `DELETE /api/posts/:id` – 投稿を削除
- `POST /api/posts/:id/like` – いいねを追加
- `POST /api/posts/:id/retweet` – リツイートを追加

## 検索 API

- `GET /api/search?q=QUERY&type=users|posts|all` –
  キーワードからユーザーや投稿を検索します。 `type`
  を省略するとすべてが対象です。

## トレンド API

- `GET /api/trends` –
  直近24時間の投稿からハッシュタグを集計し、人気順に上位10件を返します。

### リンクプレビュー

投稿内にURLを含めると、最初に出現したリンクを基にOGP情報を取得し、タイムラインでカード形式のプレビューを表示します。
この処理はクライアント側で自動挿入される `<div data-og="URL"></div>` と
`/api/ogp` エンドポイントによって実現されています。

## アカウント管理 API

ローカルアカウントの作成や編集に利用するエンドポイントです。公開ユーザー情報の取得
やチャット関連機能を提供する `/api/users/*` とは目的が異なります。

- `GET /api/accounts` – アカウント一覧取得
- `POST /api/accounts` – アカウント作成
- `GET /api/accounts/:id` – アカウント取得（鍵情報を含む）
- `PUT /api/accounts/:id` – アカウント更新
- `DELETE /api/accounts/:id` – アカウント削除

## チャット API

チャット機能は「グループ（未実装）」と「DM（ダイレクトメッセージ）」に分かれます。
現在は DM のみ提供します（UI は将来のグループ対応を見据えて残しています）。

- `GET /api/dm?user1=<handle>&user2=<handle>` – 2者間 DM の一覧取得
- `POST /api/dm` – DM 送信（body:
  `{ from, to, type, content?, attachments? }`。ActivityPub の object
  はサーバー側で組み立てられます）
- `GET /api/users/:user/keep` – TAKO Keep に保存したメモ一覧を取得（添付対応）
- `POST /api/users/:user/keep` – TAKO Keep へメモを保存（`{ content?, attachments? }`。`attachments` は `/api/files` で取得した URL と mediaType などを配列で指定）
- `GET /api/keeps?handle=<user@domain>` – 上記の簡易エイリアス（認証必須）
- `POST /api/keeps` – 上記の簡易エイリアス（認証必須）
- `POST /api/files` – ファイルアップロード（HTTP のみ、要ログイン）
- `GET /api/files/:id` – ファイル取得（認証不要）
- `GET /api/files/messages/:messageId/:index` –
  メッセージ添付ファイル取得（認証不要）

### ファイルアップロード設定

アップロードの容量や許可/拒否ルールは環境変数で制御できます。

- `FILE_MAX_SIZE`: 最大サイズ（例: `10MB`, `512KB`, `10485760`）
- `FILE_MAX_SIZE_BYTES`: バイト数を数値で指定
- `FILE_MAX_SIZE_MB`: MB を数値で指定
- `FILE_ALLOWED_MIME_TYPES`: 許可する MIME
  タイプ（カンマ区切り）。未設定なら許可リストなし＝全 MIME 許可
- `FILE_BLOCKED_MIME_TYPES`: 拒否する MIME
  タイプ（カンマ区切り、未設定なら制限なし）
- `FILE_BLOCKED_EXTENSIONS`:
  拒否する拡張子（カンマ区切り、未設定なら制限なし。例: `.exe,.bat`） 備考:
  `FILE_MAX_SIZE*` を未設定の場合、サイズ制限はありません。

.env の例は `app/api/.env.example` を参照してください。

## クライアントでのデータ保存

DM はサーバーに平文で保存され、WebSocket
により新着通知が配信されます（`type: "dm"`）。
フロントエンドはローカルにメッセージ一覧のキャッシュを保持します。将来的なグループ機能に向けた
UI は残っていますが、MLS/E2EE は廃止されています。

## OpenAPI仕様

APIの詳細仕様は [docs/openapi.yaml](docs/openapi.yaml) に記載されています。
OpenAPI 対応ツールで読み込むことでクライアント実装やテストに利用できます。

## FCMによる通知

Firebase Cloud Messaging の設定と利用方法は [docs/fcm.md](docs/fcm.md)
を参照してください。Tauri 版では Rust 製プラグインと Kotlin サービスを使って FCM
を初期化します。
