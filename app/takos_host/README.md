# takos host とは

takos host は takos
サーバーをレンタル形式で提供するためのホスティングソフトウェアです。ユーザーは
takos host 上でアカウントを作成し、ブラウザから takos
サーバーを借りてすぐに利用を開始できます。必要に応じてパスワードを設定できますが、基本的には
OAuth
でログインします。サーバーを貸与することで、アルゴリズムや著作権などの権利を利用者へ移譲し、誰でも自由に
takos を運用できるようにすることが目的です。

## 仕組み

1. takos host にメールアドレスを登録し、届いた確認コードを入力して
   ログインし、ユーザー画面から新しい takos サーバーを作成します。
2. サーバーごとに専用のドメインを割り当てたように見せかけますが、実際には 単一の
   Deno スクリプトで複数インスタンスを模倣します。
   個別のプロセスを起動・停止するわけではなく、takos と同等の API を共通
   ロジックとして取り込むことで、多数のサーバーが動作しているかのように振る舞う
   だけの構成です。
3. 各インスタンスはデフォルトで takos.jp
   のリレーに参加しており、内部的にはリレーに近い仕組みを inbox
   を介さずに実装します。リレー先は `ROOT_DOMAIN` で指定したドメインになります。
4. ユーザーは発行されたドメインへアクセスし、OAuth
   認証でログインします。パスワードを設定した場合は `/login`
   からログインできます。

ホスト側ではドメイン名を基にインスタンスを識別し、takos の API
を共通モジュールとして読み込んで処理します。これにより複数の takos
サーバーを一元管理できます。

環境変数 `ROOT_DOMAIN` を設定すると、インスタンスのホスト名は
`<サブドメイン>.<ROOT_DOMAIN>` の形式で自動補完されます。`FREE_PLAN_LIMIT`
で1ユーザーが作成できる無料インスタンス数を制限できます。 `RESERVED_SUBDOMAINS`
を使うと、利用できないサブドメインをあらかじめ指定できます。
現在はサブドメインのみ利用可能で、独自ドメイン機能は未実装です。takos host
から個別に環境変数を編集する機能はありません。

## ログインとユーザー API

`ROOT_DOMAIN` で指定したドメインへアクセスすると、ウェルカムページが
表示されます。ログインは `/auth`、ダッシュボードは `/user` から利用します。
`/auth` では登録やログインなど API も提供され、取得したセッション Cookie
を送信することで `/user` 以下の API を利用できます。登録時に送信される
確認コードを入力すると、その時点で自動的にログイン状態となります。

- `POST /auth/register` 新規ユーザー登録
- `POST /auth/login` ログイン
- `GET /auth/status` セッション状態確認
- `DELETE /auth/logout` ログアウト
- `POST /auth/verify` メールアドレス確認
- `POST /auth/resend` 確認コード再送信

ユーザー API では以下のエンドポイントが利用できます。

- `GET /user/instances` 登録済みインスタンス一覧を取得
- `POST /user/instances` 新しいインスタンスを追加 (必要に応じてパスワードも設定)
- `DELETE /user/instances/:host` インスタンスを削除
- `GET /user/instances/:host` インスタンスの情報を取得 (ホスト名のみ)
- `PUT /user/instances/:host/password`
  インスタンスのログインパスワードを設定/変更 (空を送ると無効化)
  _独自ドメイン関連の API は今後実装予定です_

環境変数やパスワードを更新すると、キャッシュされたアプリが破棄され、次のアクセス時に再起動されます。

## フロントエンド

ユーザー画面は Vite と Solid.js で作られています。状態管理には solid-jotai
を用い、ページ間で共通の状態を保持します。 `app/takos_host/client`
で以下を実行すると開発サーバーが起動します。

```bash
$ deno task dev
```

ビルドしたファイルは `client/dist`
に配置され、サーバーから自動的に配信されます。

### インスタンスへのログイン

各インスタンスでは基本的に OAuth を利用してログインします。まず
`/oauth/authorize` と `/oauth/token` を経由してアクセストークンを取得し、
インスタンスの `/api/oauth/login`
へ送信することでダッシュボードへアクセスできます。インスタンス作成時に 必要な
OAuth クライアントは自動登録されますが、追加で登録したい場合は
`/user/oauth/clients` を利用してください。

パスワードを設定した場合は `/login` へパスワードを POST
してログインできます。`POST /user/instances` で指定したパスワードは
`hashedPassword` と `salt` としてインスタンスの環境変数に保存されます。 OAuth
認証は常にホストの `ROOT_DOMAIN` を利用します。 インスタンスでは `/api/config`
にアクセスすることで `OAUTH_HOST` を取得でき、 ログイン画面は値が存在する場合に
OAuth ボタンを表示します。

## 起動方法

1. `.env.example` を参考に `.env` を作成します。
   - `ROOT_DOMAIN` にホストの基本ドメインを設定します。
   - `FREE_PLAN_LIMIT` で無料プランのインスタンス数上限を指定します。
   - `RESERVED_SUBDOMAINS`
     には利用禁止とするサブドメインをカンマ区切りで設定します。
   - `TERMS_FILE` に利用規約(テキストまたは Markdown)の
     ファイルパスを指定します。Markdown の場合は HTML として表示されます。

- `FREE_PLAN_LIMIT` で無料プランのインスタンス数上限を指定します。
- `RESERVED_SUBDOMAINS`
  には利用禁止とするサブドメインをカンマ区切りで設定します。
- `SMTP_HOST` などを設定すると登録時に確認メールを送信します。

2. `deno run -A app/takos_host/main.ts` でサーバーを起動します。

## CLI 管理ツール

`scripts/host_cli.ts` を使用して takos host を CLI から操作できます。 MongoDB
へ直接接続してインスタンスを作成・削除するほか、リレーサーバー
の登録や削除も行えます。`--user` を省略すると管理ユーザー `system`
として実行されます。

### 使用例

```bash
deno task host list --user alice

deno task host create --host myapp --password pw --user alice

deno task host relay-list

deno task host relay-add --inbox-url https://relay.example/inbox

deno task host relay-delete --relay-id RELAY_ID
```
