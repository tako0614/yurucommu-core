# takosとは

takosはActivityPubでweb自主するためのソフトウェアです。
takosは、ActivityPubに追加で、以下の機能を提供します。

このソフトウェアは、1人のユーザが、他のユーザとコミュニケーションを取るためのものです。
基本的に同一ドメインのユーザーは同一人物です。(サブアカウントなど)

## 技術スタック

言語/ランタイム: TypeScript/Deno バックエンドフレームワーク: Hono
フロントエンドフレームワーク: Solid.js/tauri データベース:
Prisma(prisma対応ならなんでも)

# GET started(backend)

env記述後

```bash
deno task run
```

- [takos web](./docs/takos-web/index.md)
- [ActivityPub (Addional object)](./docs/ActivityPub/index.md)
