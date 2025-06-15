# Takopack レジストリサーバー

このディレクトリには Hono を用いた最小限のレジストリ実装例が含まれます。
パッケージ情報は MongoDB で管理され、`MONGO_URI` で接続先を指定します。
`REGISTRY_DIR` 環境変数（デフォルト `./registry`）で指定したディレクトリから
`.takopack` アーカイブを提供します。ブラウザから操作できる管理UI(`/admin`)
も用意されています。UI は Solid.js + Tailwind CSS で作られており、Vite を
使って開発できます。API へのリクエストは `/api` にまとめられています。

## エンドポイント

- `GET /_takopack/index.json` - パッケージ一覧（`ETag` と `Last-Modified` 付き）
- `GET /_takopack/search?q=<keyword>&limit=<n>` - キーワードで検索
- `GET /_takopack/packages/<id>` - 指定した識別子の最新パッケージ情報
- `POST /api/login` - ユーザー認証。`REGISTRY_USER` と `REGISTRY_PASS`
  で認証情報を設定 し、ドメイン登録やパッケージ公開時に使用するセッションを取得
- `POST /api/register` - メールアドレスでアカウント作成（確認メール送信）
- `GET /api/verify/<token>` - メールのリンクからアカウントを有効化
- `POST /api/domains/request` - 逆ドメイン所有確認トークンを発行（レスポンスに
  `token` を含む）
- `POST /api/domains/verify` - ドメイン確認を完了
  - `/api/domains/request` のトークンを `takopack-verify=<token>` という TXT
    レコードとして追加してから実行します
- `GET /api/domains` - 登録済みドメイン一覧を取得
- `POST /api/packages` - パッケージ登録（ドメイン確認済みが必要）
- `GET /<file>` - `.takopack` アーカイブのダウンロード

## サーバーの起動方法

```bash
cd app/registry
deno task start
```

`PORT` 環境変数（デフォルト `8080`）でリッスンするポートを指定できます。
`MONGO_URI` を設定すると MongoDB の接続先を変更できます。 `REGISTRY_USER` と
`REGISTRY_PASS` を設定すると `/api/login` で取得するセッションに利用されます。
このセッションはドメイン登録とパッケージ公開の際だけ必要です。
メール認証に使用する確認リンクは `VERIFY_BASE_URL` 環境変数で生成されます。

UI の開発時は次のコマンドで Vite サーバーを起動できます。

```bash
deno task ui-dev
```

ビルド結果は `deno task ui-build` で `public/` に出力されます。
