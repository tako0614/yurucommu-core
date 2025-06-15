# Takopack レジストリ

このパッケージはレジストリサービスから Takopack
拡張機能をダウンロードするための簡易ユーティリティを提供します。レジストリは利用可能なパッケージ一覧
`index.json` と `.takopack` アーカイブ、検索エンドポイントを公開します。
このドキュメントではパッケージ取得に関連するAPIのみを説明します。認証やドメイン管理など公開用のエンドポイントは実装ごとに異なります。

`index.json` の構造は次のとおりです。

```jsonc
{
  "packages": [
    {
      "identifier": "com.example.foo",
      "name": "Foo Extension",
      "version": "1.0.0",
      "description": "サンプル拡張",
      "downloadUrl": "https://registry.example.com/com.example.foo-1.0.0.takopack",
      "sha256": "..." // 任意の整合性ハッシュ
    }
  ]
}
```

`fetchRegistryIndex()` でインデックスを取得し、`searchRegistry()`
で検索結果を取得できます。特定の識別子の最新情報は `fetchPackageInfo()`
で取得可能です。これらの関数は `etag` や `lastModified`
を指定することで更新有無を確認でき、サーバーが変更されていなければ `index` や
`pkg` プロパティが `null` になります。`downloadAndUnpack()` で `sha256`
を検証しつつアーカイブをダウンロードして展開します。戻り値は `unpackTakoPack`
と同じ形式のオブジェクトです。
