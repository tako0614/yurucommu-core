# Repository Guidelines

## Project Structure & Module Organization
- Root workspace ties together `api/` (shared API types/CLI), `backend/` (Cloudflare Worker API, Prisma schemas, D1 migrations), and `platform/` (shared domain logic and ActivityPub helpers). `frontend/` hosts the SolidJS reference UI, and `docs/` holds protocol/API notes. Supporting scripts live in `scripts/` and `backend/scripts/`.
- Source is TypeScript ES modules; look for entrypoints in `app-main.ts`, `backend/src/index.ts`, and platform barrel files under `platform/src/**/index.ts`.

## Build, Test, and Development Commands
- Install once at the repo root: `npm install`.
- Local worker: `npm run dev` (backend via wrangler on 0.0.0.0:8787). Seed fixtures when needed: `npm --workspace backend run seed:dev`.
- Platform/API tests: `npm run test` (runs `api` then `platform` via Vitest).
- Type checking: `npm --workspace backend run typecheck` and `npm --workspace platform run typecheck`.
- Deploy: `npm run deploy` (Cloudflare Worker). Regenerate config templates: `npm run init:config`; validate manifests: `npm run validate:app` / `npm run validate:profile`.

## Coding Style & Naming Conventions
- TypeScript + ESM with explicit `.js/.ts` extensions in imports. Prefer 2-space indentation, trailing semicolons, and double quotes to match existing files.
- Naming: camelCase for variables/functions, PascalCase for types/classes/Solid components, suffix request handlers with `Handler`, and keep file names kebab-case for utilities and PascalCase for components.
- Export through barrel `index.ts` files in each feature folder to keep public surfaces clear.

## Testing Guidelines
- Vitest is used across workspaces. Place unit tests beside sources with `.test.ts`. Mock Cloudflare bindings/Prisma clients in unit tests; reserve integration tests for wrangler contexts.
- Run focused suites with `npm --workspace backend run test -- --watch` or `npm --workspace platform run test -- --runInBand`. Add coverage when touching auth/federation paths (`vitest --coverage`).

## Commit & Pull Request Guidelines
- Follow the current history: short, imperative subjects with prefixes like `feat:`, `fix:`, `chore:`, `refactor:`. Keep scope narrow and mention the affected package if helpful (e.g., `feat(platform): ...`).
- PRs should include a concise summary, linked issue or context, test results, migration/config steps (D1, R2, wrangler vars), and screenshots for UI-facing changes.

## Security & Configuration Tips
- Copy `backend/example.wrangler.toml` when bootstrapping; never commit real secrets. Use `wrangler secret put` for credentials and keep `takos-config.json` / `takos-profile.json` free of sensitive data when sharing.
- For schema changes, edit `backend/prisma/schema.prisma`, generate a migration in `backend/d1_migrations/`, and note the apply command in your PR description.
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
