# Yurucommu

**セルフホスト型・一人用 ActivityPub SNS**

## コンセプト

Yurucommuは、**自分だけのSNSインスタンス**を立ち上げ、コミュニティ単位で人と繋がっていくための分散型ソーシャルネットワークです。

### 目指すもの

1. **アルゴリズムに左右されない人間関係**
   - タイムラインは純粋な時系列
   - 「おすすめ」や「バズ」に振り回されない
   - 自分がフォローした人の投稿だけが流れてくる

2. **コミュニティ単位の繋がり**
   - 興味や趣味でグループを形成
   - 小さなコミュニティで親密な関係を構築
   - 大規模SNSの「薄い繋がり」ではなく「濃い繋がり」

3. **プラットフォームからの独立**
   - セルフホストで自分のデータは自分で管理
   - サービス終了やアカウント凍結のリスクなし
   - ActivityPubで他のインスタンスとも連携可能

## 特徴

### セルフホスト前提
- 一人一インスタンス
- Cloudflare Workers + D1 + R2 で低コスト運用
- 自分のドメインで運用可能

### ActivityPub対応
- Mastodon、Misskey等と相互フォロー可能
- 標準プロトコルで将来性を確保
- 分散ネットワークの一員として参加

### コミュニティ機能
- トピックベースのグループ
- コミュニティ内での投稿共有
- QRコードで簡単に友だち追加

### シンプルな機能
- 投稿（テキスト + 画像）
- フォロー / フォロワー
- いいね / ブックマーク
- ダイレクトメッセージ
- 通知

## 技術スタック

- **Runtime**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Storage**: Cloudflare R2
- **Frontend**: React + Vite
- **Backend**: Hono
- **Protocol**: ActivityPub

## セットアップ

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev
```

## デプロイ

### アプリ (app.yurucommu.com)

Cloudflare Workers にデプロイ:

```bash
npm run deploy
```

### ウェブサイト (yurucommu.com)

Cloudflare Pages にデプロイ:

```bash
wrangler pages deploy site --project-name yurucommu-site --branch main
```

## ライセンス

MIT
