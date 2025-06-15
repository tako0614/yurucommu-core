# Takopack レジストリ仕様

Takopack 拡張機能パッケージを VSCode
の拡張機能マーケットプレイスのように配布する仕組みがレジストリです。レジストリは次のシンプルな
HTTP API を提供します。

ここでは takos 本体が利用する読み取り専用の API のみを記述します。
パッケージ公開や管理機能のエンドポイントは実装に依存するため、この仕様では扱いません。

- `GET /_takopack/index.json` – 利用可能なパッケージ一覧を返します。`ETag` と
  `Last-Modified` を含み、条件付きリクエストで更新有無を確認できます。
- `GET /_takopack/search?q=<keyword>&limit=<n>` –
  キーワードで検索したパッケージ一覧を返します。こちらも `ETag` /
  `Last-Modified` を返します。
- `GET /_takopack/packages/<id>` –
  特定の識別子の最新パッケージ情報を取得します。
- `GET <downloadUrl>` – `index.json` で参照されている `.takopack`
  アーカイブをダウンロードします。

`index.json` のフォーマットは以下の通りです。

```jsonc
{
  "packages": [
    {
      "identifier": "com.example.foo",
      "name": "Foo Extension",
      "version": "1.0.0",
      "description": "パッケージの概要",
      "downloadUrl": "https://registry.example.com/com.example.foo-1.0.0.takopack",
      "sha256": "<任意のsha256値>"
    }
  ]
}
```

クライアントは `index.json`
を取得して目的のパッケージを探し、アーカイブをダウンロードします。`sha256`
が指定されている場合はダウンロードしたファイルのハッシュを検証します。アーカイブの内容は
[`docs/takopack/v3.md`](./v3.md) で説明しているパック形式に準拠します。

`ETag` や `Last-Modified`
ヘッダーを利用した条件付きリクエストを行うことで、更新がない場合に 304
が返されるため無駄なダウンロードを避けられます。`/_takopack/packages/<id>`
も同様にキャッシュを活用できます。
