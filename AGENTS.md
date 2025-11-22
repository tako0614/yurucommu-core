# takos OSS コントリビューションガイドライン

このドキュメントは、**takos OSS プロジェクト**への開発・コントリビューションに関するガイドラインです。

takos は活発に開発が進んでいるオープンソースプロジェクトです。改善提案、バグ報告、プルリクエストを歓迎しています。

## プロジェクト概要

**takos** は、ActivityPub 対応の分散型 SNS バックエンドおよび共通モジュール群をまとめた完全独立のオープンソースプロジェクトです。

- 1 つのインスタンス単体として使用可能
- サブドメインによるマルチテナント対応
- Cloudflare Workers + D1 + R2 で実装
- TypeScript + SolidJS（フロントエンド）

### リポジトリ構成

```
takos/
├── backend/          … Cloudflare Worker API（認証・投稿・ActivityPub）
├── platform/         … 共有ドメインロジック（ユーザー・コミュニティ・ポスト）
├── frontend/         … SolidJS リファレンス UI
├── docs/             … API ドキュメント・ActivityPub 仕様
└── README.md         … プロジェクト概要
```

## コード規約

### 言語・フレームワーク

- **言語**: TypeScript（必須）
- **バックエンド**: Cloudflare Workers + Hono
- **フロントエンド**: SolidJS + Vite
- **ORM**: Prisma（D1 スキーマ管理）
- **テスト**: Vitest

### ファイル構成・命名

- モジュールは ES module 形式（`.js` / `.ts` 拡張子を明示）
- インデント: **2 スペース**（タブ不可）
- 末尾セミコロン: **必須**
- ダブルクォート: **必須** (`import "..."`)

### 命名規則

| カテゴリ | 規則 | 例 |
|---------|------|-----|
| 関数・変数 | camelCase | `getUserPosts()`, `currentUser` |
| クラス・型 | PascalCase | `User`, `CreatePostRequest` |
| Solid コンポーネント | PascalCase | `UserCard`, `PostList` |
| Worker ハンドラ | 〜`Handler` サフィックス | `getPostHandler`, `createCommentHandler` |
| ファイル | kebab-case / PascalCase | `user-service.ts`, `UserCard.tsx` |

### platform モジュール公開インターフェース

`platform/src/` の各機能フォルダには `index.ts` バレルファイルを用意してください：

```typescript
// platform/src/users/index.ts
export { User, UserService } from "./types.js";
export { createUser, getUserById } from "./user-service.js";
```

## 開発環境

### セットアップ

```bash
# リポジトリクローン
git clone https://github.com/your-org/takos.git
cd takos

# 全ワークスペースの依存をインストール
npm install

# ワークスペースの確認
npm workspaces list
```

### ローカル開発

#### バックエンド

```bash
npm run dev
```

- `http://127.0.0.1:8787` で起動
- ホットリロード対応
- D1 はローカル SQLite を使用（`.wrangler/state/v3/d1/`）

#### フロントエンド（オプション）

```bash
npm --workspace frontend run dev
```

- `http://localhost:5173` で起動（デフォルト）
- Vite 開発サーバー

### ビルド・デプロイ

```bash
# platform の型チェック
npm --workspace platform run typecheck

# backend の型チェック
npm --workspace backend run typecheck

# backend テスト実行
npm --workspace backend run test

# backend デプロイ
npm run deploy
```

## テスト

### テストフレームワーク

Vitest を使用しています。

```bash
# platform のテスト
npm --workspace platform run test

# backend のテスト
npm --workspace backend run test

# カバレッジ付き実行
npm --workspace backend run test:coverage
```

### テストの書き方

テストファイルはソースの隣に `.test.ts` サフィックスで配置：

```
src/
├── user-service.ts
├── user-service.test.ts    ← 隣に配置
└── types.ts
```

**テストの指針:**

- 高速な単体テスト（Cloudflare bindings はスタブ化）
- 統合テストは wrangler コンテキストをモック
- 新機能・バグ修正は対応するテストを追加
- PR 説明に「テスト実行結果」を記載

```typescript
import { describe, it, expect, vi } from "vitest";
import { createUser } from "./user-service.js";

describe("UserService", () => {
  it("should create a user with valid data", async () => {
    const db = {
      query: vi.fn().mockResolvedValue({ id: "user-123" }),
    };
    const user = await createUser(db, { handle: "alice" });
    expect(user.id).toBe("user-123");
  });
});
```

## データベース管理

### スキーマ変更ワークフロー

1. **`backend/prisma/schema.prisma` を編集**

   ```prisma
   model User {
     id    String @id
     email String @unique
     name  String
   }
   ```

2. **マイグレーション生成**

   ```bash
   cd backend
   npx prisma migrate diff --from-empty --to-schema-datasource prisma/schema.prisma --script > d1_migrations/NNNN_description.sql
   ```

3. **ローカルで検証**

   ```bash
   npx wrangler d1 migrations apply takos-db --local
   ```

4. **リモート適用**

   ```bash
   npx wrangler d1 migrations apply takos-db --remote
   ```

5. **Prisma クライアント再生成**

   ```bash
   npx prisma generate
   ```

## Git ワークフロー

### Commit メッセージ

Conventional Commit スタイル（72文字以内）:

```
feat: ユーザープロフィール画面を追加
fix: D1 接続エラーを修正
refactor: ユーザーサービスのロジックを整理
docs: API ドキュメントを更新
test: UserService のテストを追加
```

和文・英文の混在は OK:

```
feat: Add user profile page + API エンドポイント追加
```

### Pull Request の留意点

1. **概要**: 変更内容を簡潔に説明
2. **関連イシュー**: `Closes #123` などでリンク
3. **環境変更**: D1/R2/Wrangler 設定変更があれば記載
4. **UI 変更**: Before/After スクリーンショットを添付
5. **スキーマ変更**: `backend/d1_migrations/` diff と新 Prisma クライアント出力を確認
6. **テスト実行結果**: ルート (`takos/`) で `npm run test`（backend + platform を順番に実行）などのコマンドと結果を記載

```markdown
## 概要
ユーザープロフィール完成度チェック（handle, display name, avatar）を追加

## 変更内容
- Prisma スキーマに `User.profileComplete` フラグを追加
- GET /me で完成度を返す
- POST /me/profile で一括更新可能に

## テスト
```bash
$ npm --workspace backend run test
✓ user-service.test.ts (3)
  ✓ should mark profile as complete
$ npm --workspace platform run test  
✓ user-model.test.ts (5)
```

## 環境構築
D1 マイグレーション追加: `0007_add_profile_complete.sql`
```
```

## セキュリティ・パフォーマンス

- **認証**: Bearer トークン（JWT 推奨）または Cookie ベース
- **CORS**: Wrangler 設定で明示的に許可
- **レート制限**: D1 行数制限（超過時はエラー）
- **メディアアップロード**: R2 バケットの署名 URL 使用
- **ActivityPub フェッチ**: タイムアウト・リトライロジック実装

## 環境変数・シークレット

`wrangler.toml` で管理:

```toml
[env.production]
vars = { INSTANCE_DOMAIN = "example.com" }
```

シークレット:

```bash
npx wrangler secret put FCM_SERVER_KEY
npx wrangler var set INSTANCE_DOMAIN=example.com
```

**ルール**: `wrangler.toml` には **絶対にシークレットを記載しない** → `secret put` で登録

## 質問・サポート

- **Issue**: バグ報告・機能リクエスト
- **Discussion**: 設計相談・質問
- **PR**: 実装提案

## ライセンス

takos OSS は [AGPL-3.0](../LICENSE) ライセンスで公開しています。
コントリビューション時はこのライセンスに同意したと見なされます。
