## 0. 目次

1. 目的と適用範囲
2. 用語・記号
3. 名前空間とコンテキスト
4. オブジェクト／アクター定義
5. コレクション定義
6. アクティビティ定義
7. アクセス制御モデル
8. エンドポイント要件
9. セキュリティ & モデレーション指針
10. 実装ガイドライン
11. JSON-LD 具体例
12. 付録 A: `https://schema.example/ns/community` コンテキスト

---

## 1. 目的と適用範囲

- **目的**: ActivityPub 2.0
  を拡張し、「複数ユーザーが参加・脱退できる話題単位の集合体（コミュニティ）」の作成／投稿／モデレーションを相互運用できるようにする。
- **適用範囲**:

  - **公開**・**承認制**・**非公開** の 3 モードをサポート。
  - 標準添付 (`Note`, `Image`, `Video`, `Poll` 等) の投稿とリアクション。
  - ユーザー／コミュニティを跨いだフォロー、ハッシュタグ検索。
- **非目標**: E2EE、リアルタイム音声／映像などは本仕様外。

---

## 2. 用語・記号

| 用語                             | 意味                                                                              |
| -------------------------------- | --------------------------------------------------------------------------------- |
| **Community Actor**              | 本仕様で新設するアクター型。「グループ」「サークル」等の概念。                    |
| **Manager**                      | Community の運営権限を持つ `Person`。最終的な決裁者 (**Owner**) を 1 人以上含む。 |
| **Member**                       | 参加承認済みユーザー。Member でなければ書き込みできないコミュニティがある。       |
| **Public / Protected / Private** | 参加・閲覧ポリシーの 3 区分。後述 §7 参照。                                       |

---

## 3. 名前空間とコンテキスト

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    {
      "community": "https://schema.example/ns/community#",
      "Community": "community:Community",
      "mode": "community:mode",
      "members": "community:members",
      "managers": "community:managers",
      "banned": "community:banned",
      "featured": "community:featured"
    }
  ]
}
```

> **実装要件**
>
> - 各サーバーは **MUST** ホスト独自の `https://schema.example/ns/community`
>   をキャッシュ可能な JSON-LD として公開。

---

## 4. オブジェクト／アクター定義

### 4.1 `Community` アクター

| プロパティ          | 型                                     | 必須 | 説明                                        |
| ------------------- | -------------------------------------- | ---- | ------------------------------------------- |
| `type`              | `"Community"`                          | ✓    | 固定値                                      |
| `id`                | IRI                                    | ✓    | 永続的識別子                                |
| `preferredUsername` | xsd\:string                            | ✓    | 文字数 ≤ 64、グローバル一意である必要はない |
| `summary`           | xsd\:string                            | ―    | Markdown 可                                 |
| `icon` / `image`    | `Image`                                | ―    | 512 × 512 以下推奨                          |
| `published`         | xsd\:dateTime                          | ✓    | RFC 3339                                    |
| `publicKey`         | `PublicKey`                            | ―    | HTTP Signatures 用                          |
| `mode`              | `"public" \| "protected" \| "private"` | ✓    | §7 参照                                     |
| `members`           | `Collection`                           | ✓    | 出力専用。Join/Leave で更新                 |
| `managers`          | `Collection`                           | ✓    | 少なくとも 1 人                             |
| `banned`            | `Collection`                           | ―    | オプション                                  |
| `featured`          | `Collection`                           | ―    | ピン留め投稿など                            |

> **デフォルト ActivityPub エンドポイント** (`inbox`, `outbox`, `followers`,
> `following`) は Person と同様に **MUST** 実装。

### 4.2 `Person` 拡張

- `communities`: `Collection` of Community IDs に Join
  済みコミュニティ一覧を追加 (**SHOULD** 実装)。

---

## 5. コレクション定義

| Collection   | 説明                | 読み取り             | 書き込み     |
| ------------ | ------------------- | -------------------- | ------------ |
| **members**  | Join 済みアカウント | Public (mode に準拠) | サーバー内部 |
| **managers** | Owner/Moderator     | Public               | Owner のみ   |
| **banned**   | 追放済みアカウント  | 非公開               | Manager      |
| **featured** | 目立たせたい投稿    | Public               | Manager      |

- 各 Collection は **OrderedCollectionPage** でページング対応必須。
- 書き込みは Activity 経由で実施し、直接 JSON PATCH 等で改変してはならない。

---

## 6. アクティビティ定義

| Activity                | actor                   | object                | target      | コメント                                   |
| ----------------------- | ----------------------- | --------------------- | ----------- | ------------------------------------------ |
| **Join**                | `Person`                | `Community`           | ―           | 参加申請                                   |
| **Accept** / **Reject** | `Manager`               | `Join`                | `Community` | 承認 / 却下通知                            |
| **Leave**               | `Person`                | `Community`           | ―           | 自発的脱退                                 |
| **Invite**              | `Manager`               | `Person`              | `Community` | 招待状。対象は `Accept` or `Reject` で応答 |
| **Add**                 | `Manager`               | `Person`              | `members`   | 強制追加 (例: 管理者が BOT を登録)         |
| **Remove**              | `Manager`               | `Person`              | `members`   | 追放                                       |
| **Create**              | `Person` \| `Community` | `Note` 等             | `Community` | 投稿                                       |
| **Delete**              | `Manager`               | `Tombstone` (Note ID) | `Community` | 削除                                       |
| **Flag**                | `Person`                | `Object`              | `Community` | 通報                                       |
| **Block**               | `Community`             | `Person \| Community` | ―           | 連合単位で拒否                             |

> **連合互換性**
>
> - 未対応実装に対しては `Community` を `Group`
>   としてダウングレードできるよう設計。
> - `Object` が `Group` の場合でも `Join`/`Leave` は動作する（既存互換）。

---

## 7. アクセス制御モデル

| モード        | TL 閲覧     | 投稿        | Join 方法                     |
| ------------- | ----------- | ----------- | ----------------------------- |
| **public**    | 誰でも      | Member のみ | 任意に `Join` ⇒ 自動 `Accept` |
| **protected** | 誰でも      | Member のみ | `Join` ⇒ Manager が `Accept`  |
| **private**   | Member のみ | Member のみ | `Invite` or Owner が `Add`    |

- サーバーはモードに応じて **MUST** HTTP 401/403 を返すか、`Reject`
  アクティビティで拒否を示す。

---

## 8. エンドポイント要件

| HTTP  | Path (例)                          | 要件                                                                                                                                    |
| ----- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| GET   | `/communities/{id}`                | `Community` オブジェクトを返す。 `Accept` ヘッダ `application/ld+json; profile="https://www.w3.org/ns/activitystreams"` に対応 **MUST** |
| POST  | `/communities/{id}/inbox`          | HTTP Signatures + Digest ヘッダ **MUST**。429/400/401/403/410 を実装                                                                    |
| GET   | `/communities/{id}/outbox`         | ActivityPub コレクションページ                                                                                                          |
| GET   | `/communities/{id}/members?page=N` | 認可後にページング出力                                                                                                                  |
| PATCH | `/communities/{id}/settings`       | 管理 API (任意)。標準化対象外だが JSON Merge Patch を推奨                                                                               |

> **Pagination**: `?page=true` / `prev` / `next` リンクは ActivityPub §5.5
> 準拠。 **Performance**: 1 HTTP 要求あたり 10 MB または 500 Item
> のいずれか小さい方を上限とすることを **推奨**。

---

## 9. セキュリティ & モデレーション指針

1. **署名検証**: すべての Inbox POST は HTTP Signatures を **MUST** 検証。
2. **重複排除**: `id` と `digest` の組をキーにリプレイ攻撃を検出。
3. **Rate-Limit**: origin+actor ごとにスライディングウィンドウで制限を
   **SHOULD**。
4. **Flag 対応**: 24 h 以内に管理者へ通知し、`Delete` or `Remove` を検討。
5. **Banned**: `banned` に入った actor の投稿は `Reject` または `Block`
   を自動返信。
6. **CSRF**: HTML フォーム投稿を行う UI は CSRF トークン必須。
7. **Federation Deny List**: サーバー単位のブロックは `Block`
   を推奨フォーマットで配布。

---

## 10. 実装ガイドライン

| レイヤ       | 推奨技術／注意点                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| _DB_         | members/managers は RDB の m\:n テーブルで正規化。`mode` インデックス必須。                                   |
| _キャッシュ_ | 公開 TL は HTTP 304 と E-Tag。Private はキャッシュ禁止。                                                      |
| _UI_         | - Community TL／Home TL／Global の 3 本をタブ分割<br> - Join ボタンはモードごとに表記「参加」「申請」等を切替 |
| _検索_       | 投稿全文・タグに加え `preferredUsername` をトークナイズ。                                                     |
| _通知_       | Join/Invite/Flag/Manager 追加/削除は ActivityPub `Create{Notification}` で Person Inbox へ。                  |
| _互換性_     | Mastodon 4.3 以前との連携テストでは `Community ➜ Group` ダウングレードを使用。                                |

---

## 11. JSON-LD 具体例

### 11.1 Community 作成

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://schema.example/ns/community"
  ],
  "type": "Create",
  "actor": "https://social.example/users/alice",
  "object": {
    "type": "Community",
    "id": "https://social.example/communities/photoclub",
    "preferredUsername": "photoclub",
    "summary": "写真好きがゆるく集まる場所📷",
    "published": "2025-05-04T12:00:00+09:00",
    "mode": "protected",
    "managers": {
      "type": "Collection",
      "items": ["https://social.example/users/alice"]
    },
    "members": { "type": "Collection", "totalItems": 0 }
  }
}
```

### 11.2 Join & Accept

```jsonc
// Bob → Community inbox
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Join",
  "actor": "https://remote.example/users/bob",
  "object": "https://social.example/communities/photoclub",
  "id": "https://remote.example/activity/1234",
  "published": "2025-05-04T12:30:00Z"
}

// Manager Alice → Bob inbox
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Accept",
  "actor": "https://social.example/users/alice",
  "object": {
    "type": "Join",
    "id": "https://remote.example/activity/1234"
  },
  "target": "https://social.example/communities/photoclub"
}
```

### 11.3 投稿

```jsonc
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "actor": "https://social.example/users/bob",
  "to": ["https://social.example/communities/photoclub"],
  "object": {
    "type": "Note",
    "id": "https://social.example/notes/9876",
    "attributedTo": "https://social.example/users/bob",
    "content": "初投稿です！愛機は X-T5 📸",
    "tag": [
      { "type": "Hashtag", "name": "#自己紹介" },
      { "type": "Hashtag", "name": "#写真" }
    ],
    "published": "2025-05-04T13:00:00Z"
  }
}
```

### 11.4 通報 & 削除

```jsonc
// Flag
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Flag",
  "actor": "https://remote.example/users/charlie",
  "object": "https://social.example/notes/9876",
  "target": "https://social.example/communities/photoclub",
  "content": "スパムです"
}

// Delete (Manager)
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Delete",
  "actor": "https://social.example/users/alice",
  "object": {
    "type": "Tombstone",
    "id": "https://social.example/notes/9876",
    "formerType": "Note",
    "deleted": "2025-05-04T13:10:00Z"
  },
  "target": "https://social.example/communities/photoclub"
}
```

---

## 12. 付録 A: community コンテキスト最小例

```json
{
  "@context": {
    "community": "https://schema.example/ns/community#",
    "Community": "community:Community",
    "mode": {
      "@id": "community:mode",
      "@type": "@vocab"
    },
    "members": { "@id": "community:members", "@type": "@id" },
    "managers": { "@id": "community:managers", "@type": "@id" },
    "banned": { "@id": "community:banned", "@type": "@id" },
    "featured": { "@id": "community:featured", "@type": "@id" }
  }
}
```
