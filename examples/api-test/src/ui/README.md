# Takos API Test Extension UI

このディレクトリには、Takos API Test ExtensionのWeb UIが含まれています。Vite + SolidJSで構築されています。

## 特徴

- 🚀 Viteによる高速な開発体験
- ⚡ SolidJSによるリアクティブなUI
- 🎨 モダンでレスポンシブなデザイン
- 🧪 すべてのTakos APIの包括的テスト
- 📊 リアルタイムログ表示
- 🔄 SSR（サーバーサイドレンダリング）対応

## テスト対象API

- **ActivityPub API**: アクター作成、メッセージ送受信、フォロー機能
- **KV Storage API**: データの読み書き、削除操作
- **CDN API**: ファイルアップロード、ダウンロード機能
- **Events API**: イベント発行、購読機能
- **Extensions API**: 他の拡張機能との連携

## 開発

### 前提条件

- Node.js 18以上
- npm または pnpm

### インストール

```bash
npm install
```

### 開発サーバーの起動

```bash
npm run dev
# または
./dev.ps1
```

ブラウザで http://localhost:3001 にアクセスしてください。

### ビルド

```bash
npm run build
# または
./build.ps1
```

ビルド成果物は `dist/` ディレクトリに生成されます。

### プレビュー

ビルド後のファイルをプレビューするには:

```bash
npm run preview
```

## 使用技術

- **Vite**: 高速なビルドツール
- **SolidJS**: リアクティブなJavaScriptフレームワーク
- **TypeScript**: 型安全なJavaScript
- **CSS3**: モダンなスタイリング（CSS Grid, Flexbox等）
- **Express**: サーバーサイドレンダリング用

## ディレクトリ構成

```
src/
├── App.tsx          # メインアプリケーションコンポーネント
├── App.css          # アプリケーションスタイル
├── entry-client.tsx # クライアントサイドエントリポイント
├── entry-server.tsx # サーバーサイドエントリポイント
├── index.css        # グローバルスタイル
└── assets/          # 静的アセット
```

## カスタマイズ

### スタイルの変更

`src/App.css` を編集することで、アプリケーションの外観をカスタマイズできます。

### 新しいAPIテストの追加

1. `src/App.tsx` に新しいタブとテスト関数を追加
2. 対応するAPIエンドポイントを実装
3. 適切な型定義を追加

## トラブルシューティング

### ポート3001が使用中の場合

`vite.config.ts` の `server.port` を変更してください:

```typescript
server: {
  port: 3002, // 他のポート番号に変更
  // ...
},
```

### プロキシ設定

APIサーバーが異なるポートで動作している場合、`vite.config.ts` のプロキシ設定を調整してください:

```typescript
server: {
  proxy: {
    '/api': {
      target: 'http://localhost:8080', // APIサーバーのURL
      changeOrigin: true,
    },
  },
},
```
