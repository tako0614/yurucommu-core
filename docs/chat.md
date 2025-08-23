# ActivityPubグループ会話仕様（方式2: Group Actor）v0.1

最終更新: 2025-08-23

## 1. 目的・範囲

ActivityPub/ActivityStreams 2.0の語彙・配送モデルの範囲内で、\*\*グループを表すActor（type: Group）\*\*を用いて複数人で会話する最低相互運用仕様を定義する。クライアント→サーバ（C2S）およびサーバ↔サーバ（S2S）の双方を前提とし、**グループのアイコン（icon）やヘッダー（image）の設定/更新**も含む。

> 注意: 本仕様は実装ガイドでありW3Cの追加標準ではない。語彙はActivityStreams 2.0、配送はActivityPubに準拠する。

---

## 2. 用語

* **AS**: ActivityStreams 2.0
* **AP**: ActivityPub
* **Actor**: ASで定義される主体。ここでは `type: Group` を主対象とする。
* **メンバー**: グループの`followers`コレクションに含まれるActor。
* **管理者/モデレーター**: グループのロール。実装固有。

---

## 3. 全体像（モデル）

* グループはASのActorで、`inbox`/`outbox`/`followers`等の標準エンドポイントを持つ。
* **メンバーシップはAP標準の`Follow/Accept`で表現**し、Accept後にグループの`followers`へ追加される。
* メンバーの投稿は、

  1. メンバーが自分の`outbox`へ`Create{Note}`（宛先`to: group.id`）を出す。
  2. それを受け取ったグループが\*\*`Announce`\*\*で自グループの`followers`へ配送する（推奨）。
* 公開範囲はASの受信者フィールド（`to`/`cc`/`bto`/`bcc`/`audience`）で制御。

---

## 4. グループActor 定義

### 4.1 必須フィールド

* `@context`: `https://www.w3.org/ns/activitystreams`
* `type`: `Group`
* `id`: グローバル一意URI
* `name` / `preferredUsername`（実装任意）
* `inbox` / `outbox`
* `followers`（メンバー集合）

### 4.2 推奨フィールド

* `summary`（説明）
* `icon`（アバター） / `image`（ヘッダー）
* `endpoints.sharedInbox`（同一サーバの配送効率化）

### 4.3 例（グループActor）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Group",
  "id": "https://groups.example/@cats",
  "name": "Cats Club",
  "preferredUsername": "cats",
  "summary": "猫好きのためのグループ",
  "inbox": "https://groups.example/@cats/inbox",
  "outbox": "https://groups.example/@cats/outbox",
  "followers": "https://groups.example/@cats/followers",
  "endpoints": { "sharedInbox": "https://groups.example/inbox" },
  "icon": {
    "type": "Image",
    "mediaType": "image/png",
    "url": "https://media.example/cats/icon.png",
    "width": 512,
    "height": 512
  },
  "image": {
    "type": "Image",
    "mediaType": "image/jpeg",
    "url": "https://media.example/cats/header.jpg",
    "width": 1500,
    "height": 500
  }
}
```

---

## 5. エンドポイント

### 5.1 取得系（GET）

* `GET {group.id}`: Actor表現（上記例）
* `GET {group.id}/followers`: メンバーコレクション（実装によりページング・認可）
* `GET {group.id}/inbox`: 受信箱（GETは任意、一覧表示用途）
* `GET {group.id}/outbox`: 送信箱（グループからのアクティビティ）

### 5.2 受信系（POST）

* `POST {group.id}/inbox`: リモート配送の受け口（AP S2S）

> 注: 俯瞰ではC2Sのアクティビティ投稿は\*\*各ユーザーの`outbox`\*\*へ行う。グループ自体を直接操作するC2Sは管理者操作（例: アイコン更新）に限定。

---

## 6. メンバーシップ（参加/退出/招待）

### 6.1 参加（Follow→Accept）

* 参加希望者は `Follow{ actor: user, object: group }` を送信。
* グループ（または管理者UI）は `Accept{ object: Follow }` で承認。
* 承認時の副作用: 申請者を`followers`へ追加。

#### 例: Follow（参加リクエスト）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Follow",
  "id": "https://user.example/acts/111",
  "actor": "https://user.example/@alice",
  "object": "https://groups.example/@cats",
  "to": ["https://groups.example/@cats"]
}
```

#### 例: Accept（承認）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Accept",
  "id": "https://groups.example/acts/200",
  "actor": "https://groups.example/@cats",
  "object": "https://user.example/acts/111",
  "to": ["https://user.example/@alice"]
}
```

### 6.2 退出

* メンバーは `Undo{ object: Follow }` を自分の`outbox`に投げて退出。
* 強制退出はグループが `Remove{ object: user, target: group.followers }` を発行（実装任意）。

### 6.3 招待（任意拡張）

* `Invite{ actor: group-admin, object: user, target: group }` を許容。
* 参加は**最終的にFollow/Acceptへ収束**させる（相互運用のため）。

---

## 7. 投稿と配送

### 7.1 メンバーの投稿

* メンバーは自分の`outbox`に`Create{Note}`をPOST。`to`は\*\*グループActorの`id`\*\*を指定。
* 受け取ったグループは\*\*`Announce`\*\*で自グループの`followers`へ配送（推奨）。

#### 例: メンバーのCreate（グループ宛）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://user.example/acts/123",
  "actor": "https://user.example/@alice",
  "to": ["https://groups.example/@cats"],
  "object": {
    "type": "Note",
    "id": "https://user.example/notes/xyz",
    "attributedTo": "https://user.example/@alice",
    "content": "はじめまして！",
    "to": ["https://groups.example/@cats"]
  }
}
```

#### 例: グループのAnnounce（メンバー投稿の配布）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Announce",
  "id": "https://groups.example/acts/345",
  "actor": "https://groups.example/@cats",
  "object": "https://user.example/notes/xyz",
  "to": ["https://groups.example/@cats/followers"]
}
```

### 7.2 非公開グループ

* グループが非公開の場合、Announceの宛先は\*\*`to: group.followers`のみ\*\*とし、`Public`は含めない。
* メンバーのCreate時点でも`Public`を含めないのが望ましい。

### 7.3 返信/スレッド

* `inReplyTo`に対象Noteの`id`を入れる。グループは必要に応じて同様にAnnounce。

---

## 8. 可視性・プライバシー

* 宛先制御は`to`/`cc`/`bto`/`bcc`/`audience`で行う。
* クライアント→サーバ投稿時、存在する`bto`/`bcc`は配送前にサーバが除去する（内部で受信者に反映）。
* **E2E暗号化はAP標準外**。機密情報の共有は非推奨。必要なら別プロトコルを併用。
* `followers`コレクションの閲覧可否は実装で制御（非公開グループでは非公開推奨）。

---

## 9. アイコン/ヘッダー画像の取り扱い

### 9.1 フィールド

* **`icon`**: アバター。値は`Image`または`Link`。`mediaType`/`url`/`width`/`height`を推奨。
* **`image`**: ヘッダー（カバー）。同上。

### 9.2 アップロード（実装ガイド）

* AP標準はアップロード手順を規定しないため、C2S用にRESTを用意:

  * `POST /media` （`multipart/form-data` or direct binary）
  * 200/201で`{ id, url, mediaType, width, height }`等を返す
  * ウイルススキャン/画像最適化/EXIF除去は実装裁量

### 9.3 更新フロー（管理者のみ）

* 管理者は自分（または管理者権限を委任した）アカウントで、**グループActorを`Update`**。

#### 例: グループアイコンの更新

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Update",
  "id": "https://groups.example/acts/400",
  "actor": "https://groups.example/@cats",
  "to": ["https://groups.example/@cats/followers"],
  "object": {
    "type": "Group",
    "id": "https://groups.example/@cats",
    "icon": {
      "type": "Image",
      "mediaType": "image/png",
      "url": "https://media.example/cats/icon-new.png",
      "width": 512,
      "height": 512
    }
  }
}
```

> 注: 互換実装に追随させるため、`Update`を配送（少なくとも既知のメンバー）することを推奨。

---

## 10. 役割と権限（実装指針）

* **owner**: 作成・削除、管理者追加/削除、設定変更
* **admin**: メンバー承認/追放、設定変更（icon/image含む）
* **moderator**: 報告の処理、投稿の削除/ロック
* **member**: 投稿・返信・添付
* **muted/banned**: 配送・表示の制限

---

## 11. 相互運用上の指針

* メンバー参加は**Follow/Accept**を必須とし、`Join/Leave`は受理しても内部的にFollowへ写像（任意拡張）。
* 配送最適化のため`sharedInbox`を活用。
* `Announce`を用いた再配布を第一選択とする（再作成より互換性が高い）。

---

## 12. セキュリティ/配送の実装注意

* **HTTP署名**（サーバ間リクエスト署名）を必須化（実装選択）。
* 受信側は署名検証・Actor鍵の取得・リプレイ対策・レート制限を行う。
* スパム対策（ドメインブロック/フィルタ）、添付のサイズ上限、HTMLサニタイズ。
* `bto`/`bcc`はストレージ表示でも隠す。

---

## 13. レート制限/DoS耐性（推奨）

* C2S: 投稿頻度・添付サイズの上限を設ける。
* S2S: ドメイン単位のレート制限、指数バックオフ配送、共有Inboxの利用。

---

## 14. エラー

* C2S: 4xx/5xxをHTTPで返す。JSON-LDのエラーボディは実装任意（`type: Problem`等）。
* S2S: 署名不備・認可不備は401/403、バリデーション不備は400。

---

## 15. 参考シーケンス（概要）

```
参加: user -> Follow -> group
承認: group -> Accept(Follow) -> user
投稿: user -> Create(Note, to: group) -> group
配布: group -> Announce(object: note, to: group.followers) -> 各メンバー
```

---

## 16. 実装チェックリスト

* [ ] Group ActorのGETで`icon`/`image`が返る
* [ ] /mediaアップロードが動作しURLを返す
* [ ] Update(Group.icon)を配送し他実装で反映される
* [ ] Follow/Acceptでfollowersが更新される
* [ ] Create→Announceの配送が届く（公開/非公開）
* [ ] bto/bccの除去
* [ ] 署名検証と失敗時の拒否
* [ ] レート制限/バックオフ
* [ ] **DM**: 単一宛先・Public禁止の検証に通る（違反は400）
* [ ] **DM**: 返信時に受信者集合（単一）が自動継承される
* [ ] **DM**: 可能な限り**個別inbox**へ配送（共有Inboxのみの場合は許容）

---

## 17. 互換性メモ 互換性メモ

* 一部実装はグループ参加に`Join/Leave`を用いるが、APの相互運用の観点では**Follow/Accept**のサポートを必須とする。
* メディアアップロードはAPの範囲外のため、RESTでの拡張を用意する。

---

## 18. DM（単一宛先Object）仕様

**目的**: `to` に**一人だけ**（＝単一のActor IRI）を入れたObject/Activityを、相互運用可能な\*\*DM（ダイレクトメッセージ）\*\*として扱う最小仕様を定義する。

### 18.1 定義と要件

* **DMの判定条件**（両方満たす）

  1. `to`/`cc`/`bto`/`bcc`/`audience` に現れる**固有受信者の総集合**（Activity＋内包Objectの両方を合算）が**ちょうど1つのActor**であること（送信者自身は除外）。
  2. `as:Public`（`https://www.w3.org/ns/activitystreams#Public`）を**含めない**こと。
* **推奨**: 受信者は**Activity側とObject側の双方**に記載して整合させる（実装間での互換性向上）。
* **`bto`/`bcc`使用時**: サーバは配送前にこれらを**除去**し、受信者への配送のみを行う（表示でも非表示）。

### 18.2 C2S（クライアント→サーバ）

* クライアントは自分の`outbox`に `Create{Note}` をPOSTする。
* サーバはDM要件（単一受信者・Public禁止）を検証し、違反時は **400 Bad Request** を返す。
* サーバは内部的に可視性フラグ（例: `visibility: "direct"`）を保持してもよい（規格外メタ、配送には影響しない）。

### 18.3 S2S（サーバ↔サーバ配送）

* 送信サーバは**相手Actorの個別 `inbox` へ配送**することを**推奨**（共有Inboxしかない場合は共有Inboxでも可）。
* HTTP署名などの検証は通常のAP配送と同様。

### 18.4 返信・スレッド

* 受信者は `Create{Note, inReplyTo: <元Note.id>}` を送り、\*\*宛先は相手（元の送信者）\*\*のActorのみとする。
* **オーディエンス継承**: 実装は返信時に前メッセージの受信者集合（単一）を**自動継承**することを推奨。
* `context` を用いて会話スレッドを同一に保つ。

### 18.5 UI/挙動（非規範）

* DMビューでは相手の `name` / `icon` を用いてヘッダを表示（`icon`がなければプレースホルダ）。
* 既読機能は規格外。本仕様では定義しない（実装依存の拡張イベントで対応可）。

### 18.6 モデレーション/拒否

* 受信側はDMの拒否・ブロックを行える。ブロック時は配送を拒否（403）または受領後に破棄（実装依存）。
* レート制限・スパム検出はセクション12に準ずる。

### 18.7 例

#### 18.7.1 送信（Alice→Bob）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://user.example/acts/dm1",
  "actor": "https://user.example/@alice",
  "to": ["https://remote.example/@bob"],
  "object": {
    "type": "Note",
    "id": "https://user.example/notes/dm-xyz",
    "attributedTo": "https://user.example/@alice",
    "content": "（DM）こんにちは！",
    "to": ["https://remote.example/@bob"]
  }
}
```

> 受信者を隠すなら `bto` を使ってもよいが、配送前に除去されるべきである。

#### 18.7.2 返信（Bob→Alice）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://remote.example/acts/dm2",
  "actor": "https://remote.example/@bob",
  "to": ["https://user.example/@alice"],
  "object": {
    "type": "Note",
    "inReplyTo": "https://user.example/notes/dm-xyz",
    "content": "（DM返信）了解！",
    "to": ["https://user.example/@alice"]
  }
}
```

### 18.8 注意事項

* DMでも**E2E暗号化ではない**点は変わらない（サーバ管理者には可視）。
* `to` にグループActorを1つだけ入れた場合は\*\*"対グループの私信"\*\*であり、厳密には1:1ではない（本仕様のDMとは区別される）。

---

## 付録A: 追加例（非公開グループ配送）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Announce",
  "actor": "https://groups.example/@cats",
  "object": "https://user.example/notes/xyz",
  "to": ["https://groups.example/@cats/followers"]
}
```

## 付録B: 添付のNote例

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "actor": "https://user.example/@alice",
  "to": ["https://groups.example/@cats"],
  "object": {
    "type": "Note",
    "content": "写真です！",
    "attachment": [
      {
        "type": "Image",
        "mediaType": "image/jpeg",
        "url": "https://media.example/p/123.jpg",
        "width": 1280,
        "height": 960
      }
    ]
  }
}
```

## 付録C: DM（単一宛先）簡易テスト項目

1. 送信: `to=[bob]`/`Public`なし → Bobに届く、他に届かない
2. 返信: Bob→Alice で `inReplyTo` 設定＆ `to=[alice]` 継承 → 両者のスレッドに連続表示
3. `bto=[bob]` で送信 → 受信側に届くが配送ペイロードからは除去
4. `to=[bob, carol]` にするとDM要件違反 → 400
5. `to=[bob]` かつ `Public` を含める → 400
6. ブロック時: 403または破棄（実装依存）
