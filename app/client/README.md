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

## 備考

- `vite.config.[ext]` ファイルは拡張子 `.mjs` または `.mts`
  を使用する必要があります。

## 既知の問題

現在 Deno ユーザー向けに小さな問題があります:

- peer dependencies は `vite.config.js` 内で参照する必要があります。この例では
  `solid-js` パッケージのみ参照すれば動作します。
