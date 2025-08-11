# Vite + Deno + Solid + TypeScript

## 開発サーバーの起動

このリポジトリを実行するには Deno v1.28.0 以降が必要です。

開発サーバーを起動するには次のコマンドを実行します:

```
$ deno task dev
```

開発サーバーは API リクエストを `localhost:8000` にプロキシします。Mastodon など
ActivityPub
クライアントがバックエンドへアクセスできるよう、`/.well-known`、`/users`、`/inbox`
へのパスもプロキシ設定済みです。

## デプロイ

本番用アセットのビルド:

```
$ deno task build
```

## UI/UX ガイド

UI の共通デザイン・コンポーネント・アクセシビリティ方針は `docs/ui_ux.md` を参照してください。

### takos host からのインスタンス作成

Tauri 版ログイン画面では、`takos.jp` 上でアカウントを作成してそのまま
インスタンスを発行できます。ログイン画面下部の `takos.jpで作成`
ボタンから登録フォームを開き、メール確認後に サブドメインを入力すると OAuth
認証を経て自動的にログインが完了します。

### 広告の表示

Google AdSense などの広告を表示する場合は、サーバー側の `.env`
に次の環境変数を設定します。

```env
ADSENSE_CLIENT=your_adsense_client_id
ADSENSE_SLOT=1234567890
ADSENSE_ACCOUNT=ca-pub-xxxxxxxxxxxxxxxx
```

設定すると投稿一覧の途中や、チャットのチャンネル検索欄の下に広告が表示されます。`ADSENSE_ACCOUNT`
を指定すると `<meta name="google-adsense-account">` が自動で追加されます。
広告設定は他のクライアント設定と同様 `/api/config` から取得します。

## 備考

- `vite.config.[ext]` ファイルは拡張子 `.mjs` または `.mts`
  を使用する必要があります。

## 既知の問題

現在 Deno ユーザー向けに小さな問題があります:

- peer dependencies は `vite.config.js` 内で参照する必要があります。この例では
  `solid-js` パッケージのみ参照すれば動作します。
