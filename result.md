# 初期設定画面が表示されない問題の調査結果

## 問題の概要
初回ログイン時（初期設定が完了していない状態）に、初期設定画面が表示されない。

## 原因
`/api/setup/status` エンドポイントに誤って認証ミドルウェアが適用されているため。

### 詳細
1. **app/api/routes/setup_ui.ts** の24-25行目で以下のミドルウェアが適用されている：
   ```typescript
   app.use("/setup", authIfConfigured);
   app.use("/setup/*", authIfConfigured);
   ```

2. `authIfConfigured` ミドルウェアは、`hashedPassword` が設定されている場合に認証を要求する設計

3. しかし、このミドルウェアは `/setup` パスに適用されているが、実際のエンドポイントは `/api/setup/status` として登録される

4. **問題の本質**：`/api/setup/status` は初期設定状態を確認するためのエンドポイントであり、未認証でもアクセスできる必要があるが、現在は認証が必要になっている可能性がある

## 修正方針

### 方法1: ミドルウェアの適用を個別に設定
- `/api/setup/status` エンドポイントには認証ミドルウェアを適用しない
- `/api/setup` POSTエンドポイントのみに `authIfConfigured` を適用

### 方法2: ミドルウェアの適用順序を変更
- グローバルなミドルウェア適用を削除
- 各エンドポイントに個別に必要なミドルウェアを設定

## 推奨される修正内容

**app/api/routes/setup_ui.ts** の修正：
1. 24-25行目のグローバルなミドルウェア適用を削除
2. `/api/setup/status` は認証不要（誰でもアクセス可能）
3. `/api/setup` POSTには `authIfConfigured` を適用（既に設定済みの場合は認証が必要）

この修正により、初期設定前の状態でも `/api/setup/status` にアクセスでき、クライアント側で適切に初期設定画面を表示できるようになる。