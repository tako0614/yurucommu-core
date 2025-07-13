# takos host とは

takos host は takos
サーバーをレンタル形式で提供するためのホスティングソフトウェアです。ユーザーは
takos host 上でアカウントを作成し、ブラウザから takos
サーバーを借りてパスワードを設定するだけで利用を開始できます。サーバーを貸与することで、アルゴリズムや著作権などの権利を利用者へ移譲し、誰でも自由に
takos を運用できるようにすることが目的です。

## 仕組み

1. takos host にアカウントを登録し、管理画面から新しい takos
   サーバーを作成します。
2. サーバーごとに専用のドメインを割り当てたように見せかけますが、実際には 単一の
   Deno スクリプトで複数インスタンスを模倣します。
   個別のプロセスを起動・停止するわけではなく、takos と同等の API を共通
   ロジックとして取り込むことで、多数のサーバーが動作しているかのように振る舞う
   だけの構成です。
3. 各インスタンスはデフォルトで relay.takos.jp
   のリレーに参加しており、内部的にはリレーに近い仕組みを inbox
   を介さずに実装します。
4. ユーザーは発行されたドメインへアクセスし、パスワードを入力してログインします。

ホスト側ではドメイン名を基にインスタンスを識別し、takos の API
を共通モジュールとして読み込んで処理します。これにより複数の takos
サーバーを一元管理できます。

## ログインと管理 API

`ROOT_DOMAIN` で指定したドメインへアクセスすると、ウェルカムページが
表示されます。ログインは `/auth`、管理画面は `/admin` から利用します。 `/auth`
では登録やログインなど API も提供され、取得したセッション Cookie
を送信することで `/admin` 以下の API を利用できます。

- `POST /auth/register` 新規ユーザー登録
- `POST /auth/login` ログイン
- `GET /auth/status` セッション状態確認
- `DELETE /auth/logout` ログアウト

管理 API では以下のエンドポイントが利用できます。

- `GET /admin/instances` 登録済みインスタンス一覧を取得
- `POST /admin/instances` 新しいインスタンスを追加 (パスワードを設定)
- `DELETE /admin/instances/:host` インスタンスを削除
- `GET /admin/instances/:host` インスタンスの詳細を取得
- `PUT /admin/instances/:host/env` インスタンスの環境変数を更新
- `PUT /admin/instances/:host/password` インスタンスのログインパスワードを変更
- `POST /admin/instances/:host/restart` インスタンスを再起動

環境変数やパスワードを更新すると、キャッシュされたアプリが破棄され、次のアクセス時に再起動されます。

## フロントエンド

管理画面は Vite と Solid.js で作られています。状態管理には solid-jotai
を用い、ページ間で共通の状態を保持します。 `app/takos_host/client`
で以下を実行すると開発サーバーが起動します。

```bash
$ deno task dev
```

ビルドしたファイルは `client/dist`
に配置され、サーバーから自動的に配信されます。

### インスタンスへのログイン

各インスタンスでは `/login` へパスワードを POST
すると管理画面にアクセスできます。 `POST /admin/instances`
で登録したパスワードは `hashedPassword` と `salt` として
インスタンスの環境変数に保存され、ログイン時に照合されます。

## 起動方法

1. `.env.example` を参考に `.env` を作成します。
2. `deno run -A app/takos_host/main.ts` でサーバーを起動します。
