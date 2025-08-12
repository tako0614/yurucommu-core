# 1) 目的と前提

* **目的**：ActivityPub 連合間で動く E2EE チャット。ユーザーは「アカウント＝端末集合」として見え、どの端末からでも自然に会話できる。
* **暗号基盤**：MLS（端末＝クライアント単位でメンバー管理、Add/Remove/Commit/Welcome、external commit）。
* **グループ**：招待で追加されるトーク（Join は Add/Commit or external commit）。
* **端末管理**：**アクティビティGC**で「増えすぎ」や「使ってない端末」を自動整理。

# 2) 全体アーキテクチャ（役割）

* **クライアント（端末）**：MLS状態（leaf秘密／ratchet状態）を保持。KeyPackage を生成・公開。端末ごとに独立。
* **Delivery Service（DS）**：配送と順序制御。E2EE平文は見ない。再送・重複抑制・ACK・キューを提供。
* **Auth Service（AS）**：Actor＝アカウントに属する端末の検証（署名検証、端末マニフェスト検証、ポリシー適用）。
* **Directory（Actorプロファイル）**：`keyPackages` と **端末マニフェスト**（ユーザー署名済み）を配布。
* **（任意）透明性ログ**：`keyPackages` / マニフェストの変更履歴を公開し置換攻撃を検知。
* **ストレージ**：暗号化メディアや添付の保管（鍵はMLSメッセージで配布）。
* **観測/ジョブ**：GC・ローテ・自動合流などのバッチ。

# 3) コアのデータ概念

* **Actor**：`id`、`inbox/outbox`、`keyPackages`（端末ごとの未使用KeyPackage束）、**DeviceManifest**（署名済み; 端末リストと属性、version/expiry）。
* **Device（端末）**：`device_id`、署名鍵Credential、HPKE初期化鍵、**活動指標**（last\_seen/送受信統計）、**lease**（有効期限）、**状態**（Active/Hibernating/Stale）。
* **Group**：`group_id`、ポリシー（招待可否、外部合流可否、バッチ窓）、現在エポック、メンバーの leaf 集合。
* **Invite**：Add/Commit で招くか、**external commit 用の GroupInfo (+オプションPSK)** を配付するかのどちらか。
* **Message**：MLSアプリケーションメッセージ（本文）＋メディア参照（DS URL）＋MLS内で配るコンテンツ鍵。
* **Event（ActivityPub）**：Create / Add / Remove / Update などのアクティビティで、上記リソースの変化を連合配布。

# 4) 端末ライフサイクル（アクティビティGC前提）

### 登録（Provisioning）

1. 端末は署名鍵/HPKE鍵を生成 → **KeyPackage** を複数作成（短命・在庫上限）。
2. **DeviceManifest** に端末を追加し **ユーザー署名**で更新（既存いずれかの端末が署名）。
3. `keyPackages` と更新済みマニフェストを公開。
4. **Lease**（例：30日）と **Heartbeat**（送受信・既読・push開封等で更新）を開始。

### 参加（Join：招待されたとき）

* **招待時は「アクティブ端末のみ」追加**：対象Actorの DeviceManifest を読み、**Active** 状態の端末の KeyPackage を収集 → **Add×N → 1 Commit → Welcome×N** を配送。
* **Hibernating/Stale は自動参加しない**：後述の“復帰”フローで必要時のみ合流。

### 退役・復帰

* **退役（Stale or Lease失効）**：該当端末を **全グループから Remove → Commit**。`keyPackages` から削除。Manifest更新。
* **復帰**：端末が再ログイン → 新KeyPackage公開 →

  * **端末主導**：各グループの GroupInfo を使い **external commit** で必要なものだけ合流
  * **サーバ主導**：バッチ窓で **Add/Commit** をまとめて適用（後述）

# 5) アクティビティGC（“使っていない端末”を増やさない）

* 端末スコア `score = w1*recent_recv + w2*recent_send + w3*last_seen_decay + w4*attestation_trust`。
* **状態遷移**：

  * **Active**（直近14日活動）→ 何もしない／自動参加ON
  * **Hibernating**（14–90日非活動）→ **自動参加OFF**（必要時のみ合流）
  * **Stale**（90–180日非活動 or lease失効）→ **自動退役**（全グループRemove）
* **ジョブ**：

  * `device_lease_sweeper`（15分毎）：失効端末の一括Remove/Commit、Manifest更新、通知集約
  * `group_autojoiner`（1時間毎）：**新端末や復帰端末**の必要グループを**バッチCommit**で追加（Activeのみ）
  * `keypackage_rotator`（毎日）：KeyPackage補充（短命・在庫上限）
  * `manifest_auditor`（毎日）：`keyPackages` と Manifest の整合監査
* **上限**：アカウント上限台数（例5台）。超過時は Hibernating/Stale から自動退役→ユーザー選択。

# 6) フェデレーション設計（ActivityPubとの対応づけ）

* **Actor** は標準プロファイルを拡張して `keyPackages` コレクションと **DeviceManifest** を公開。
* **招待/参加**：

  * 招待側サーバは対象 Actor の `keyPackages` から端末を選び、**Add/Commit** 実施 → **Welcome** は対象端末へ直接配送（連合越しでもOK）。
  * **external commit** を許す場合は、招待リンク→GroupInfo(+PSK) を端末に安全配布。
* **イベント表現**：

  * 端末の追加/退役＝Add/Remove（Groupメンバー変更のアクティビティ）
  * Manifest更新＝Update（署名済みメタデータの新バージョン）
  * KeyPackage補充＝Create（短命エントリの追加）
* **信頼境界**：連合サーバは配送者であり解読者ではない。**端末マニフェスト署名**と（任意）**透明性ログ**で key substitution を抑止。

# 7) メッセージ送受信（運用の肝）

* **順序性**：DSが per-group の因果順序を維持（Commit直後のアプリメッセージは次エポック）。
* **バッチ窓**：Add/Remove/Update/外部合流など**キー更新系**は最長1時間のバッチで集約し、**Commit嵐を回避**。緊急Remove（漏洩端末）は即時Commit。
* **メディア**：本体はDS等に置き、**コンテンツ鍵をMLSメッセージ**で配る（レイテンシとコスト最適化）。
* **履歴**：新規参加端末は**参加後**から復号（FS/PCSを優先）。過去を見せるなら**MLS外の復元レイヤ**（暗号バックアップ/端末間移行）を別途用意。

# 8) セキュリティと検証

* **端末マニフェスト**：Actorが**自署名**する「端末→公開鍵」台帳。これに載らない `keyPackages` は**無視**。
* **検証UI**：ユーザーが端末フィンガープリントや証明書を相互確認（スキャン/短期PSK/QR等）。
* **招待リンク保護**：external commit 用 GroupInfo に**期限・スコープ限定PSK**を添付。
* **異常検知**：多地点ログイン、短時間での大量端末追加、Manifest差し替え等をアラート → 自動退役/再認証。
* **レート制御**：KeyPackage消費・external commit・メディアDLはIP/アカウント単位で上限。

# 9) UX原則（“アカウント＝端末集合”を自然に見せる）

* **参加表示はアカウント名で集約**（内部では複数leaf）。
* 端末一覧に **状態（Active/Hibernating/Stale）** と **最終アクティビティ** を表示。
* 端末ごとに「**このトークへ自動参加**」のトグル（Hibernatingに移す簡易操作）。
* 退役は通知を**週次でまとめ**て出す。復帰は「ワンタップ再参加」（=新KeyPackage→external commit）。

# 10) 失敗時・例外設計

* **KeyPackage枯渇**：ペンディング入室キューに積み、補充後のバッチ窓で自動Add。
* **Welcome未達**：DS再送＋端末側は external commit で再合流。
* **連合先の不達**：MLSプロトコルは壊さず、ActivityPub配送の**再試行＋フォールバック経路**（中継サーバ）を用意。
* **端末喪失**：当該端末を即Remove→残端末がUpdateでPCS回復、Manifest更新。