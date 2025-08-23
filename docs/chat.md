# ActivityPubグループ会話仕様（方式2: Group Actor）v0.3

## 1. 目的・範囲

ActivityPub/ActivityStreams
2.0の語彙・配送モデルの範囲内で、\*\*グループを表すActor（type:
Group）\*\*を用いて複数人で会話する最低相互運用仕様を定義する。クライアント→サーバ（C2S）およびサーバ↔サーバ（S2S）の双方を前提とし、**グループのアイコン（icon）やヘッダー（image）の設定/更新**も含む。

> 注意: 本仕様は実装ガイドでありW3Cの追加標準ではない。語彙はActivityStreams
> 2.0、配送はActivityPubに準拠する。

---

## 2. 用語

- **AS**: ActivityStreams 2.0
- **AP**: ActivityPub
- **Actor**: ASで定義される主体。ここでは `type: Group` を主対象とする。
- **メンバー**: グループの`followers`コレクションに含まれるActor。
- **管理者/モデレーター**: グループのロール。実装固有。
- **作者署名（object-signature）**: 投稿Object（例:
  Note）自体に付与するJWS等の整合性・真正性証明。
- **認証付きフェッチ（Authenticated/Authorized Fetch）**:
  取得要求に署名等の認可を要求するフェッチ方式。

---

## 3. 全体像（モデル）

- グループはASのActorで、`inbox`/`outbox`/`followers`等の標準エンドポイントを持つ。
- **メンバーシップはAP標準の`Follow/Accept`で表現**し、Accept後にグループの`followers`へ追加される。
- メンバーの投稿は、

  1. メンバーが自分の`outbox`へ`Create{Note}`（宛先`to: group.id`）を出す。
  2. それを受け取ったグループが\*\*`Announce`\*\*でメンバーへ再配信（fan-out）する。
- 公開範囲はASの受信者フィールド（`to`/`cc`/`bto`/`bcc`/`audience`）で制御。
- **秘匿グループの最低要件**：

  - グループの`Announce`は\*\*`bto`に実メンバー列を入れて配送前に剥がす\*\*（受信者のみが自分宛であることを知る）。
  - `Announce.object`は\*\*埋め込み（by
    value）\*\*を第一選択とする。URL露出を避け、追加フェッチを不要化。
  - 埋め込まれた`Note`には**作者署名**を含め、受信側は検証する（Groupの偽造・改ざん対策）。

---

## 4. グループActor 定義

### 4.1 必須フィールド

- `@context`: `https://www.w3.org/ns/activitystreams`
- `type`: `Group`
- `id`: グローバル一意URI
- `name` / `preferredUsername`（実装任意）
- `inbox` / `outbox`
- `followers`（メンバー集合）

### 4.2 推奨フィールド

- `summary`（説明）
- `icon`（アバター） / `image`（ヘッダー）
- `endpoints.sharedInbox`（同一サーバの配送効率化）

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

### 4.4 設定項目

グループは以下の設定を持つことができる。

- `membershipPolicy`:
  参加承認方式。`open`（誰でも参加可）や`approval`（承認制）などを想定。
- `visibility`: 公開範囲。`public` や `private` などサーバー実装に依存。
- `allowInvites`: メンバーが招待を送れるかどうかの真偽値。

---

## 5. エンドポイント

### 5.1 取得系（GET）

- `GET {group.id}`: Actor表現（上記例）
- `GET {group.id}/followers`: メンバーコレクション（実装によりページング・認可）
- `GET {group.id}/inbox`: 受信箱（GETは任意、一覧表示用途）
- `GET {group.id}/outbox`: 送信箱（グループからのアクティビティ）

### 5.2 受信系（POST）

- `POST {group.id}/inbox`: リモート配送の受け口（AP S2S）

> 注:
> 俯瞰ではC2Sのアクティビティ投稿は\*\*各ユーザーの`outbox`\*\*へ行う。グループ自体を直接操作するC2Sは管理者操作（例:
> アイコン更新）に限定。

---

## 6. メンバーシップ（参加/退出/招待）

### 6.1 参加（Follow→Accept）

- 参加希望者は `Follow{ actor: user, object: group }` を送信。
- グループ（または管理者UI）は `Accept{ object: Follow }` で承認。
- 承認時の副作用: 申請者を`followers`へ追加。

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

- メンバーは `Undo{ object: Follow }` を自分の`outbox`に投げて退出。
- 強制退出はグループが `Remove{ object: user, target: group.followers }`
  を発行（実装任意）。

### 6.3 招待（Invite: 非保有Actorからの送信を含む）

- **誰でも**自分のActorから\*\*`Invite`
  **を送って「このGroupに来て」と**通知\*\*できる（Group所有は不要）。
- **Invite自体に加入効力はない**。受け手は **`Join` または `Follow`**
  をGroupへ送り、必要ならGroupが`Accept`して初めてメンバーになる。
- 最小相互運用のため、**最終的にFollow/Acceptへ収束**させること（`Join`は受理して内部でFollowへ写像してもよい）。
- 招待通知は **`to: 招待相手`**、任意で **`cc: group`**
  としてGroupにも知らせてよい（Group側でのUX補助）。
- 乱用対策として、Groupは**招待の存在を加入要件にしない**（招待が無くてもJoin/Followを受け付ける）。

Takos では管理エンドポイント `/api/groups/:name/invite` に招待したい Actor の ID
を指定して POST することで、グループから招待を送信できま す。受け手が `Join`
または `Follow` を返送するとサーバーは自動で `Accept`
を返し、メンバーに追加されます。

#### 例: 非保有ActorからのInvite

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Invite",
  "id": "https://user.example/acts/inv-1",
  "actor": "https://user.example/@alice",
  "object": "https://remote.example/@bob",
  "target": "https://groups.example/@cats",
  "to": ["https://remote.example/@bob"],
  "cc": ["https://groups.example/@cats"]
}
```

#### 例: 受け手のJoin（またはFollow）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Join",
  "id": "https://remote.example/acts/join-1",
  "actor": "https://remote.example/@bob",
  "object": "https://groups.example/@cats",
  "to": ["https://groups.example/@cats"]
}
```

> セキュリティ注:
> Inviteの有無・送信者は**加入判定に影響させない**。招待スパムはレート制限・ブロックで対処。

---

## 7. 投稿と配送

### 7.1 メンバーの投稿（作者署名＋オーディエンスバインディング）

- メンバーは自分の`outbox`に`Create{Note}`をPOST。`to`は\*\*グループActorの`id`\*\*を指定。
- `Note`には**作者署名**（例:
  `proof`フィールドにJWS等）を含めることを推奨/準必須化。
- 署名対象には少なくとも`id`/`attributedTo`/`content`/`published`/`audience`（=`group.id`）等を含め、**このグループ向けであることを暗号学的に結び付ける**。

#### 例: メンバーのCreate（グループ宛、署名付き）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://user.example/acts/123",
  "actor": "https://user.example/@alice",
  "to": ["https://groups.example/@cats"],
  "object": {
    "type": "Note",
    "id": "urn:uuid:3b19b6a9-6d1a-4a7d-9f7b-b6a9c3f8d1e2",
    "attributedTo": "https://user.example/@alice",
    "audience": "https://groups.example/@cats",
    "content": "はじめまして！",
    "published": "2025-08-24T10:00:00Z",
    "proof": {
      "type": "DataIntegrityProof",
      "created": "2025-08-24T10:00:01Z",
      "verificationMethod": "https://user.example/@alice#keys/ed25519-1",
      "jws": "eyJ..."
    },
    "to": ["https://groups.example/@cats"]
  }
}
```

> `id`は\*\*非推測（UUID等）\*\*を推奨。`audience`にグループIDを入れることで“別オーディエンスへの流用”を受信側で弾きやすくする。

### 7.2 グループの再配信（Announce, bto＋埋め込み）

- グループは受信後、\*\*`Announce`\*\*でメンバーへ再配信する。
- **秘匿性重視**の既定動作：

  - 宛先は\*\*`bto: [<member1>, <member2>, ...]`（実メンバー列）\*\*とし、**配送前に剥がす**。
  - `object`は\*\*埋め込み（by value）\*\*を第一選択。
  - `to`/`cc`/`Public`は付けない（外部露出の最小化）。

#### 例: グループのAnnounce（bto＋埋め込み）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Announce",
  "id": "https://groups.example/acts/345",
  "actor": "https://groups.example/@cats",
  "bto": [
    "https://bob.example/@bob",
    "https://carol.example/@carol"
  ],
  "object": {
    "type": "Note",
    "id": "urn:uuid:3b19b6a9-6d1a-4a7d-9f7b-b6a9c3f8d1e2",
    "attributedTo": "https://user.example/@alice",
    "audience": "https://groups.example/@cats",
    "content": "はじめまして！",
    "published": "2025-08-24T10:00:00Z",
    "proof": {
      "type": "DataIntegrityProof",
      "created": "2025-08-24T10:00:01Z",
      "verificationMethod": "https://user.example/@alice#keys/ed25519-1",
      "jws": "eyJ..."
    }
  }
}
```

> 実装メモ:
> `bto`/`bcc`は**保存・再配布前に除去**すること。相手実装が`bto`を理解しない場合に備え、**自サーバ側でfan-outして各相手の個別`inbox`にPOST**するのが安全。

### 7.3 非公開グループ

- 非公開グループでは、`Announce`に`Public`を含めない。`to`/`cc`も使わず`bto`のみで配送し、宛先実体を秘匿。
- メンバーの`Create`時点でも`Public`を含めない（C2S検証により拒否可能）。

### 7.4 返信/スレッド

- `inReplyTo`に対象Noteの`id`を入れる。グループは同様に`Announce(bto＋埋め込み)`で再配信。
- クライアントは**オーディエンス継承**（前メッセージの受信者＝グループ）を既定にして誤配送を防ぐ。

### 7.5 URL推測困難化と追加フェッチ

- 追加フェッチが必要な場合でも、Objectの`id`は**非推測ID**を推奨（UUID等）。
- **認証付きフェッチ**を有効化し、**グループ・メンバーの要求のみ許可**する（署名付きHTTPリクエスト等）。
- 可能な限り**埋め込み**で追加フェッチ自体を不要化。

---

## 8. 可視性・プライバシー

- 宛先制御は`to`/`cc`/`bto`/`bcc`/`audience`で行う。
- サーバはC2S受付時、存在する`bto`/`bcc`を保存用表現から**除去し、配送のみ**に用いる（ストレージ表示でも隠す）。
- `followers`コレクションの閲覧可否は実装で制御（非公開グループでは非公開推奨）。

---

## 9. アイコン/ヘッダー画像の取り扱い

### 9.1 フィールド

- **`icon`**:
  アバター。値は`Image`または`Link`。`mediaType`/`url`/`width`/`height`を推奨。
- **`image`**: ヘッダー（カバー）。同上。

### 9.2 アップロード（実装ガイド）

- AP標準はアップロード手順を規定しないため、C2S用にRESTを用意:

  - `POST /media` （`multipart/form-data` or direct binary）
  - 200/201で`{ id, url, mediaType, width, height }`等を返す
  - ウイルススキャン/画像最適化/EXIF除去は実装裁量

### 9.3 更新フロー（管理者のみ）

- 管理者は自分（または管理者権限を委任した）アカウントで、**グループActorを`Update`**。

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

> 互換実装に追随させるため、`Update`を配送（少なくとも既知のメンバー）することを推奨。

### 9.4 管理エンドポイント

サーバー所有者は以下の HTTP
エンドポイントを用いてグループActorの基本情報を更新できる。

- `PATCH /api/groups/{name}/actor`
  - `displayName` (string): 表示名
  - `summary` (string): プロフィール文
  - `icon` (Image|Link): アイコン
  - `image` (Image|Link): ヘッダー画像

**手順:**

1. 上記エンドポイントに変更したいフィールドを JSON で送信する。
2. 成功時、サーバーは `Update{ object: Group }` を生成しフォロワーへ配送する。

---

## 10. 役割と権限（実装指針）

- **owner**: 作成・削除、管理者追加/削除、設定変更
- **admin**: メンバー承認/追放、設定変更（icon/image含む）
- **moderator**: 報告の処理、投稿の削除/ロック
- **member**: 投稿・返信・添付
- **muted/banned**: 配送・表示の制限

---

## 11. 相互運用上の指針

- メンバー参加は**Follow/Accept**を必須とし、`Join/Leave`は受理しても内部的にFollowへ写像（任意拡張）。
- 配送最適化のため`sharedInbox`を活用。
- `Announce`を用いた再配布を第一選択とする（再作成より互換性が高い）。
- followers
  IRIをそのまま宛先に使うのではなく、**実メンバー列へ展開**してfan-outする実装を推奨（秘匿性・到達性の両面で有利）。

---

## 12. セキュリティ/配送の実装注意（更新強化）

**受信側サーバは、以下の“二段階検証”を原則とする：**

1. **配送経路の検証**: S2S
   HTTP署名が`Announce.actor`（Group）の公開鍵で正当であること。
2. **内容の作者検証**:
   埋め込まれた`Note`等の**作者署名**が`attributedTo`の公開鍵で検証OKであること。

追加の推奨事項:

- 署名対象に`audience: group.id`を含め、**オーディエンス・バインディング**を行う。
- 上記(1)がOKでも(2)がNGなら**偽造/改ざん**として破棄（またはモデレーションキューへ）。
- **メンバー整合性チェック**（推奨）: `Note.attributedTo` が
  **配送時点でのグループメンバー**であることを確認。そうでない場合、ポリシーに応じて拒否（外部なりすまし防止）。
- `Public`混入や想定外の宛先がある場合は破棄またはモデレーション。
- 認証付きフェッチを有効化し、**Group/メンバー以外のフェッチを拒否**。
- リプレイ対策（`id`の一意・`published`時刻の受容範囲・署名の有効期限）。
- 添付サイズ上限、HTMLサニタイズ、ドメインブロック/キュー制御、レート制限。

---

## 13. レート制限/DoS耐性（推奨）

- C2S: 投稿頻度・添付サイズの上限を設ける。
- S2S: ドメイン単位のレート制限、指数バックオフ配送、共有Inboxの利用。

---

## 14. エラー

- C2S:
  4xx/5xxをHTTPで返す。JSON-LDのエラーボディは実装任意（`type: Problem`等）。
- S2S: 署名不備・認可不備は401/403、バリデーション不備は400。

---

## 15. 参考シーケンス（概要）

```
参加: user -> Follow -> group
承認: group -> Accept(Follow) -> user
投稿: user -> Create(Note, to: group, proof付き) -> group
配布: group -> Announce(object: embedded Note, bto: [members]) -> 各メンバー（btoは配送前に剥がす）
検証: 受信側 -> HTTP署名(=group) + Object作者署名(=attributedTo) の双方を検証
```

---

## 16. 実装チェックリスト（更新）

- [ ] Group ActorのGETで`icon`/`image`が返る
- [ ] /mediaアップロードが動作しURLを返す
- [ ] Update(Group.icon)を配送し他実装で反映される
- [ ] Follow/Acceptでfollowersが更新される
- [ ] Create→Announceの配送が届く（公開/非公開）
- [ ] **Announce(bto)の宛先が配送前に剥がされる**
- [ ] **Announce.objectが埋め込みで配布される**
- [ ] **Noteに作者署名が含まれ、受信側で検証される**
- [ ] **audience=group.idが署名対象に含まれている**
- [ ] 認証付きフェッチが有効（必要時のみ許可）
- [ ] followers IRIを実メンバー列へ展開してfan-outできる
- [ ] 署名検証失敗時の拒否ポリシーがある
- [ ] レート制限/バックオフ
- [ ] DM: 単一宛先・Public禁止の検証に通る（違反は400）
- [ ] DM: 返信時に受信者集合（単一）が自動継承される
- [ ] DM: 可能な限り**個別inbox**へ配送（共有Inboxのみの場合は許容）
- [ ] **Inviteは誰でも送れるが加入はFollow/Acceptでのみ成立**

---

## 17. 互換性メモ

- 一部実装はグループ参加に`Join/Leave`を用いるが、APの相互運用の観点では**Follow/Accept**のサポートを必須とする。
- メディアアップロードはAPの範囲外のため、RESTでの拡張を用意する。
- `bto`/`bcc`の取り扱いは実装差があるため、**自サーバでfan-out＋剥離**する方が確実。

---

## 18. DM（単一宛先Object）仕様

**目的**: `to` に**一人だけ**（＝単一のActor
IRI）を入れたObject/Activityを、相互運用可能な\*\*DM（ダイレクトメッセージ）\*\*として扱う最小仕様を定義する。

### 18.1 定義と要件

- **DMの判定条件**（両方満たす）

  1. `to`/`cc`/`bto`/`bcc`/`audience`
     に現れる**固有受信者の総集合**（Activity＋内包Objectの両方を合算）が**ちょうど1つのActor**であること（送信者自身は除外）。
  2. `as:Public`（`https://www.w3.org/ns/activitystreams#Public`）を**含めない**こと。
- **推奨**:
  受信者は**Activity側とObject側の双方**に記載して整合させる（実装間での互換性向上）。
- **`bto`/`bcc`使用時**:
  サーバは配送前にこれらを**除去**し、受信者への配送のみを行う（表示でも非表示）。

### 18.2 C2S（クライアント→サーバ）

- クライアントは自分の`outbox`に `Create{Note}` をPOSTする。
- サーバはDM要件（単一受信者・Public禁止）を検証し、違反時は **400 Bad Request**
  を返す。
- サーバは内部的に可視性フラグ（例:
  `visibility: "direct"`）を保持してもよい（規格外メタ、配送には影響しない）。

### 18.3 S2S（サーバ↔サーバ配送）

- 送信サーバは**相手Actorの個別 `inbox`
  へ配送**することを**推奨**（共有Inboxしかない場合は共有Inboxでも可）。
- HTTP署名などの検証は通常のAP配送と同様。

### 18.4 返信・スレッド

- 受信者は `Create{Note, inReplyTo: <元Note.id>}`
  を送り、\*\*宛先は相手（元の送信者）\*\*のActorのみとする。
- **オーディエンス継承**:
  実装は返信時に前メッセージの受信者集合（単一）を**自動継承**することを推奨。
- `context` を用いて会話スレッドを同一に保つ。

### 18.5 UI/挙動（非規範）

- DMビューでは相手の `name` / `icon`
  を用いてヘッダを表示（`icon`がなければプレースホルダ）。
- 既読機能は規格外。本仕様では定義しない（実装依存の拡張イベントで対応可）。

### 18.6 モデレーション/拒否

- 受信側はDMの拒否・ブロックを行える。ブロック時は配送を拒否（403）または受領後に破棄（実装依存）。
- レート制限・スパム検出はセクション12に準ずる。

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

- DMでも**E2E暗号化ではない**点は変わらない（サーバ管理者には可視）。
- `to`
  にグループActorを1つだけ入れた場合は\*\*"対グループの私信"\*\*であり、厳密には1:1ではない（本仕様のDMとは区別される）。

---

## 付録A: 追加例（非公開グループ配送・参照式）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Announce",
  "actor": "https://groups.example/@cats",
  "object": "https://user.example/notes/xyz",
  "bto": ["https://bob.example/@bob"],
  "_note": "参照式。可能な限り埋め込みを推奨。参照式の場合はidを非推測化し、認証付きフェッチを要求すること。"
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
2. 返信: Bob→Alice で `inReplyTo` 設定＆ `to=[alice]` 継承 →
   両者のスレッドに連続表示
3. `bto=[bob]` で送信 → 受信側に届くが配送ペイロードからは除去
4. `to=[bob, carol]` にするとDM要件違反 → 400
5. `to=[bob]` かつ `Public` を含める → 400
6. ブロック時: 403または破棄（実装依存）

## 付録D: 作者署名付きNoteの最小構造（例）

```json
{
  "type": "Note",
  "id": "urn:uuid:0226f4c9-6c3e-48c5-9e6c-8d9e9e7b8c1a",
  "attributedTo": "https://user.example/@alice",
  "audience": "https://groups.example/@cats",
  "content": "署名検証テスト",
  "published": "2025-08-24T10:00:00Z",
  "proof": {
    "type": "DataIntegrityProof",
    "created": "2025-08-24T10:00:01Z",
    "verificationMethod": "https://user.example/@alice#keys/ed25519-1",
    "jws": "eyJ..."
  }
}
```

> 受信側は、`verificationMethod`の鍵解決→署名検証→`audience`が自グループであることの確認、の順で処理する。
