---
layout: home

hero:
  name: "Takos Docs"
  text: "ActivityPub仕様"
  tagline: "https://docs.takos.jp で公開される正式ドキュメント"
  actions:
    - theme: brand
      text: "ActivityPub仕様"
      link: /ja/activitypub

features:
  - title: ActivityPub拡張
    details: ストーリー/DM/チャンネルを連合配信するためのActor・コレクション・メッセージ形式を記載。
  - title: デプロイ運用指針
    details: ドメイン割り当て、認証、署名要件などWorker共通の前提を明文化。
---

## 目的

**https://docs.takos.jp** は、Takosプラットフォームの ActivityPub 独自仕様をまとめたサイトです。  
単体で動作する OSS 版 Worker の実装と同期しつつ、同じモジュールを利用するホスティングサービス **takos-private** でも参照できる安定仕様として管理します。

## スコープ

### ActivityPubカスタマイズ

`/ap/*` 配下で公開されるHTTPサーフェス、配信に使うオブジェクトスキーマ、非公開コレクションの認証要件を列挙します。`activitypub.md` の内容は `platform/src/activitypub/*` の実装と1対1で対応します。

## 利用方法

- 英語/日本語ページを用意しているので、必要に応じてナビゲーションから切り替えてください。
- 仕様へのリンクは節単位（例: `/ja/activitypub#story-surface`）でPRやIssueに貼り、挙動確認を容易にします。
- ActivityPub のペイロード変更があれば即座に反映し、OSS 版 / takos-private 双方の利用者が頼れる参照元として `docs.takos.jp` を維持します。
