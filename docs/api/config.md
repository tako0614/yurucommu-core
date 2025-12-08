# takos-config エクスポート / インポート API

オーナーセッション専用のコンフィグ管理エンドポイントです。`takos-config.json` をエクスポート / 差分確認 / インポートするために使用し、バックエンドでは `/admin/config/*` として公開されています。

## エンドポイント

### GET /admin/config/export

- **認証**: オーナーのみ
- **概要**: 現在の構成を JSON として返します。環境変数から生成された値とストア済みの値を統合し、秘密情報は除外されます。
- **レスポンス例**:
```json
{
  "ok": true,
  "data": {
    "config": { "schema_version": "1.0", "distro": { "name": "takos-oss", "version": "0.1.0" } },
    "schema_version": "1.0",
    "distro": { "name": "takos-oss", "version": "0.1.0" },
    "source": "stored",
    "warnings": ["stripped secret fields: ai.providers.main.api_key_env"]
  }
}
```

### POST /admin/config/diff

- **認証**: オーナーのみ
- **クエリ**: `force=true` でメジャーバージョン差異を強制許容（Plan 5.3.7 の互換性ルール）
- **リクエスト**: `takos-config.json` 本文
- **レスポンス例**:
```json
{
  "ok": true,
  "data": {
    "diff_count": 1,
    "diff": [
      { "path": "ui.theme", "change": "changed", "previous": "standard", "next": "dark" }
    ],
    "source": "stored",
    "warnings": [
      "minor version differs (1.0.0 -> 1.1.0); review compatibility"
    ]
  }
}
```

### POST /admin/config/import

- **認証**: オーナーのみ
- **クエリ**: `force=true` でメジャーバージョン差異を強制許容（未指定の場合は 409）
- **リクエスト**: `takos-config.json` 本文
- **レスポンス例**:
```json
{
  "ok": true,
  "data": {
    "config": { "schema_version": "1.0", "distro": { "name": "takos-oss", "version": "0.1.0" } },
    "warnings": [
      "forced import across major versions (1.0.0 -> 2.0.0)"
    ],
    "reload": { "ok": true, "reloaded": true, "warnings": [] }
  }
}
```

互換性チェックは Plan 5.3.7 に従い、distro 名が一致しない場合はエラー、メジャー差異は `force=true` が必要、マイナー / パッチ差異は警告として `warnings` に返されます。

## takos-config CLI

`npm exec takos-config -- <command>` で上記エンドポイントにアクセスできます。`--force` を付けると `?force=true` が diff/import に付与され、メジャーバージョン差異を警告付きで許容します（Plan 5.3.7）。

```bash
# エクスポート（stdout または --out でファイル保存）
npm exec takos-config -- export --url http://127.0.0.1:8787 --token $TAKOS_TOKEN --out takos-config.json

# 差分確認（互換性警告も warnings に表示）
npm exec takos-config -- diff --file takos-config.json --url http://127.0.0.1:8787 --force

# インポート（reload 結果と互換性警告を表示）
npm exec takos-config -- import --file takos-config.json --url http://127.0.0.1:8787 --force
```

レスポンスの `warnings` には互換性警告や秘密情報の除外通知が含まれるため、適用前後に必ず確認してください。

## scripts/api/config-tools.ts

リポジトリ内の `scripts/api/config-tools.ts` でも同じエンドポイントへの `export` / `diff` / `import` を叩けます。追加で `compat` コマンドを持ち、`takos-profile.json` と `takos-config.json` の組み合わせが Plan 5.3 のルールに沿っているかをチェックします。

```bash
# 互換性チェック（デフォルトで takos-profile.json / takos-config.json を読む）
tsx scripts/api/config-tools.ts compat

# エクスポート（TAKOS_URL / TAKOS_TOKEN / TAKOS_COOKIE も利用可能）
tsx scripts/api/config-tools.ts export --url http://127.0.0.1:8787 --out takos-config.json

# diff / import も同様に利用可能 (--force でメジャーバージョン差異を許容)
tsx scripts/api/config-tools.ts diff --config takos-config.json --force
tsx scripts/api/config-tools.ts import --config takos-config.json --force
```
