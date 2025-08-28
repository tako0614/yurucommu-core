Takos は、分散型ソーシャル（ActivityPub）とアプリ連携（FASP）に対応し、
一人用に特化してweb自主をすることを目的にしたモダンなマイクロブログ/チャット基盤です。
Deno をベースに、バックエンド（takos）、ホスティングコントローラ（takos_host）、
デスクトップ/ブラウザ クライアント（client）を一つのリポジトリで管理します。

主な特徴
- ActivityPub 対応: 連合用の `inbox`/`outbox` や system actor 管理を実装
- FASP 連携: docs/fasp にプロトコル仕様とデバッグ用ツールを同梱
- ホスティング: 1 プロセスで複数インスタンスを模倣する takos_host を提供
- クライアント: Vite 製フロントエンドと Tauri（デスクトップ）を用意
- Deno ベース: Node 事前インストール不要（npm は deno task 実行時に取得）

リポジトリ構成（抜粋）
- `app/takos/`: takos 本体サーバー（ActivityPub/REST 等）
- `app/takos_host/`: 複数インスタンスを管理・提供するホスティング層
- `app/client/`: フロントエンド（Vite + React/Tauri）
- `app/core/`: 共通ロジック（ルーティング、サービス、DB 抽象 など）
- `app/packages/`: 設定・DB・認証などの共通パッケージ
- `docs/`: FASP 仕様や補足ドキュメント

詳細な設計や背景は `app/takos_host/README.md` や `docs/` を参照してください。

## 前提条件

- Deno v1.28.0 以上（なるべく最新の安定版）
- 外部サービスの接続先は `.env` を作成して設定
  - 例: `app/takos/.env.example`, `app/takos_host/.env.example`
- ポート既定値は 80 です。開発中に競合する場合は `SERVER_PORT=8080` 等を `.env` に設定してください。

## クイックスタート（ルートで実行）

1) 初期設定（CLIで自動生成・手動編集不要）
- 全体の対話的セットアップ: `deno task setup`
- サーバー(takos)のみ: `deno task setup:takos`
- ホスト(host)のみ: `deno task setup:host`
- 非対話で一括生成例（Mongo/ドメイン/初期パスワード指定）:
  - `deno run -A scripts/setup_env.ts --target takos --force --yes --mongo mongodb://localhost:27017/takos --domain dev.takos.local --password yourpass`

CLIにより `.env` を自動生成できるため、手動での初期設定は不要です（必要に応じて後から編集可能）。

2) 開発サーバーの同時起動（takos + takos_host）
- `deno task dev --env path/to/.env`
- 異なる環境で起動: `deno task dev -- --env-takos path/to/takos.env --env-host path/to/host.env`

3) ビルド（フロントエンド群）
- `deno task build`

4) 本番起動（watch 無し）
- 両方起動: `deno task start --env path/to/.env`
- 片方のみ: `deno task start -- --only takos` または `--only host`
- 別々の env を指定: `deno task start -- --env-takos path/to/takos.env --env-host path/to/host.env`

アクセス例
- takos_host ルート（ウェルカム/ユーザー画面）: `http(s)://<HOST>/`
- takos API（ActivityPub/アプリ API）: `http(s)://<TAKOS_HOST>/api/...`
  - 実際のポート/ドメインは `.env` の `SERVER_HOST`/`SERVER_PORT`/`ACTIVITYPUB_DOMAIN` 等に依存します。

## よく使うタスク（個別実行）

- `deno task dev:takos` / `deno task dev:host`（個別開発起動）
- `deno task build:host` / `deno task build:client`（個別ビルド）
- `deno task start:takos` / `deno task start:host`（個別本番起動）

## 環境変数のヒント

- `SERVER_HOST`, `SERVER_PORT`: バインド先ホスト/ポート（未指定時はポート 80）
- `SERVER_CERT`, `SERVER_KEY`: 文字列で証明書/秘密鍵を指定すると HTTPS で待受
- `ACTIVITYPUB_DOMAIN`: takos 側の連合用ドメイン名（設定時に system actor キーを生成）
- Mongo 接続などの詳細は各 `.env.example` を参照（`deno task setup` は最低限の値を自動設定します）

## トラブルシューティング

- ポート 80 が権限エラー: `.env` で `SERVER_PORT=8080` などへ変更
- Node が無くても大丈夫？: ルートの `deno task` が npm 依存を自動取得します
- 開発中の再起動が頻発: ルートの `dev` は両プロセスを起動します。個別に起動して問題の切り分けをしてください

## ライセンス

本リポジトリのライセンスは `LICENSE` を参照してください。

## 補足ドキュメント

- 開発ガイドライン: `AGENTS.md`
- takos_host の詳細: `app/takos_host/README.md`
- フロントエンド（client）の使い方: `app/client/README.md`
- FASP 仕様・設計: `docs/`
