# takosとは

takosはActivityPubでweb自主するためのソフトウェアです。
takosは、ActivityPubに追加で、以下の機能を提供します。

このソフトウェアは、1人のユーザが、他のユーザとコミュニケーションを取るためのものです。
基本的に同一ドメインのユーザーは同一人物です。(サブアカウントなど)

## 🔧 技術スタック

**言語/ランタイム**: TypeScript/Deno\
**バックエンドフレームワーク**: Hono\
**フロントエンドフレームワーク**: Solid.js/tauri\
**データベース**: Prisma(prisma対応ならなんでも)

## 🚀 GET started(backend)

env記述後

```bash
deno task run
```

## 🔨 Takopack Extensions

takosは拡張機能システム「Takopack」をサポートしています。Takopackを使用することで、VSCodeのように安全かつ柔軟にtakosを拡張できます。

### ビルド方法

```bash
# サンプル拡張機能をビルド
deno run --allow-all build.ts build

# 開発モード（ファイル監視）
deno run --allow-all build.ts watch

# ヘルプを表示
deno run --allow-all build.ts help
```

### 拡張機能の開発

1. **基本構造**：
   ```
   src/extension/
   ├── server.ts     # サーバーサイドモジュール
   ├── client.ts     # クライアントバックグラウンドスクリプト  
   └── index.html    # UI
   ```

2. **Fluent API**：
   ```typescript
   import Takopack from "./src/builder/takopack.ts";

   const takopack = new Takopack()
     .server("src/server.ts")
     .client("src/client.ts")
     .ui("src/index.html")
     .manifest({/* 設定 */});

   await takopack.build();
   ```

## 📚 ドキュメント

## 📚 ドキュメント

- **[Takopack Builder API](./docs/takopack/builder.md)** - Fluent APIの使用方法
- **[Takopack拡張機能仕様書](./docs/takopack/main.md)** - 拡張機能の仕様
- **[takos web](./docs/takos-web/index.md)** - Web API仕様
- **[ActivityPub (Additional object)](./docs/activityPub/index.md)** -
  ActivityPub拡張仕様

## 🎯 特徴

- **🔒 安全な拡張機能システム**: 権限ベースのセキュリティモデル
- **🚀 モダンな開発体験**: Fluent APIとVite統合
- **📦 簡単なパッケージング**: .takopackファイルでの配布
- **🔄 ActivityPub統合**: ネイティブなActivityPubサポート
- **⚡ ホットリロード**: 開発時のファイル監視機能
