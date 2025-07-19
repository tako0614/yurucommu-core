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

### takos host からのインスタンス作成

Tauri 版ログイン画面では、`takos.jp` 上でアカウントを作成してそのまま
インスタンスを発行できます。ログイン画面下部の `takos.jpで作成`
ボタンから登録フォームを開き、メール確認後に サブドメインを入力すると OAuth
認証を経て自動的にログインが完了します。

## 備考

- `vite.config.[ext]` ファイルは拡張子 `.mjs` または `.mts`
  を使用する必要があります。

## 既知の問題

現在 Deno ユーザー向けに小さな問題があります:

- peer dependencies は `vite.config.js` 内で参照する必要があります。この例では
  `solid-js` パッケージのみ参照すれば動作します。
