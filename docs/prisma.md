# Prisma データベース管理

Yurucommuは[Prisma](https://www.prisma.io/)を使用してデータベースを管理します。

## 概要

Prismaは型安全なORMで、以下のランタイムをサポートします：

| ランタイム | アダプター | 説明 |
|-----------|-----------|------|
| Cloudflare Workers | `@prisma/adapter-d1` | D1データベース |
| Node.js / Bun | `@prisma/adapter-libsql` | LibSQL (SQLite互換) |

## セットアップ

### 1. Prismaクライアント生成

```bash
npm run db:generate
```

これにより `src/generated/prisma/` にPrismaクライアントが生成されます。

### 2. データベースのプッシュ（開発用）

```bash
npm run db:push
```

スキーマの変更をデータベースに反映します（マイグレーション履歴なし）。

### 3. マイグレーション（本番用）

```bash
npm run db:migrate
```

マイグレーションファイルを生成し、適用します。

### 4. Prisma Studio

```bash
npm run db:studio
```

ブラウザでデータベースを閲覧・編集できます。

## 使用方法

### Cloudflare Workers

```typescript
import { getPrismaD1 } from './lib/db';

export default {
  async fetch(request: Request, env: Env) {
    const prisma = getPrismaD1(env.DB);

    const actors = await prisma.actor.findMany();
    return Response.json(actors);
  }
};
```

### Node.js / Bun

```typescript
import { getPrismaSQLite } from './lib/db';

const prisma = await getPrismaSQLite('./data/yurucommu.db');

const actors = await prisma.actor.findMany();
```

## スキーマ

スキーマは `prisma/schema.prisma` に定義されています。

### 主要なモデル

| モデル | テーブル | 説明 |
|--------|---------|------|
| `Actor` | `actors` | ローカルアカウント（Person） |
| `ActorCache` | `actor_cache` | リモートアクター（キャッシュ） |
| `Object` | `objects` | APオブジェクト（Note等） |
| `Follow` | `follows` | フォロー関係 |
| `Like` | `likes` | いいね |
| `Announce` | `announces` | リポスト |
| `Community` | `communities` | コミュニティ（Group） |
| `Session` | `sessions` | 認証セッション |

### 型エクスポート

```typescript
import type { Actor, Object, Follow } from './lib/db';
```

## D1マイグレーション

Cloudflare D1用のマイグレーションは `migrations/` ディレクトリにSQLファイルとして保存されています。

```bash
# D1にマイグレーション適用
wrangler d1 migrations apply yurucommu-db
```

## 注意事項

- Prisma 7以降では `driverAdapters` はプレビュー機能ではなく標準機能です
- D1アダプターはCloudflare Workers環境でのみ動作します
- LibSQLアダプターはNode.js/Bun環境で使用します
- 開発中は `db:push` を使用し、本番デプロイ前に `db:migrate` でマイグレーションを作成してください
