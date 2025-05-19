# ChatGroup Actor 仕様 **v 1.2**

## 0. 用語と前提

| 用語            | 意味                                                |
| --------------- | --------------------------------------------------- |
| **ChatMessage** | 別紙 mKEM+HPKE 暗号化仕様。                         |
| **ChatGroup**   | `type:["Group","ChatGroup"]` を持つグループ Actor。 |
| **MemberEntry** | 本仕様で定義するメンバー情報（署名付き）。          |
| **Role**        | `owner` › `mod` › `member` の階層。                 |

## 1. 目的

1. メンバー秘匿性を維持しつつ、`members`
   コレクションひとつで権限管理を完結させる。
2. 最小限のロールでグループ運用フローをカバー。
3. 署名・再鍵手順を定義し、改ざん検知と鍵更新を自動化。

## 2. データモデル

### 2.1 ChatGroup Actor

```jsonc
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://example.com/ns/chat#"
  ],
  "type": "ChatGroup",
  "id": "https://chat.example.com/groups/abc",
  "preferredUsername": "g.dev-team",
  "name": "開発チーム",
  "access": "request", // public | invite | request
  "members": "https://chat.example.com/groups/abc/members",
  "channels": "https://chat.example.com/groups/abc/channels",
  "inbox": "https://chat.example.com/groups/abc/inbox",
  "outbox": "https://chat.example.com/groups/abc/outbox",
  "published": "2025-05-12T02:00:00+09:00",
  "updated": "2025-05-12T04:10:00+09:00"
}
```

_`members` 以外の秘匿 IRI は存在しない。未認証 GET は
**404/410**（秘匿優先モード）または **403**（HTTP 準拠モード）を返す。_

### 2.2 MemberEntry

```jsonc
{
  "@context": "https://example.com/ns/chat#",
  "type": "MemberEntry",
  "id": "https://chat.example.com/groups/abc/members/alice",
  "actor": "https://social.example.net/users/alice",
  "role": "mod", // owner | mod | member
  "joined": "2025-05-12T02:05:30Z",
  "version": 3, // 整数インクリメント
  "signature": "<JWS compact-serialization>"
}
```

#### 署名仕様

| パラメータ       | 値                                                            |
| ---------------- | ------------------------------------------------------------- |
| **アルゴリズム** | `"alg":"EdDSA"` または `"RS256"`                              |
| **カノニカル化** | \[JCS (RFC 8785)] に準拠                                      |
| **署名対象**     | JCS 変換後の MemberEntry 全体（`signature` フィールドを除外） |
| **検証鍵**       | ChatGroup の `publicKey`（グループ鍵）                        |

取得側は **常に署名検証**。失敗時は 500 系エラーで処理中断。

## 3. ガバナンス規則

| ルール           | 詳細                                                                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Owner 最小数** | `owner` が 1 名未満になる `Remove/Update` は 409 で拒否。                                                          |
| **Owner 継承**   | 最後の `owner` が脱退要求→最古の `mod` を自動 `owner` に昇格（更新 Activity を即時発行）。`mod` 不在なら処理失敗。 |
| **Owner 上限**   | 10 名は **実装推奨値**。相互運用を阻害しない限り拡張可。                                                           |

## 4. API – メンバーコレクション

| HTTP       | エンドポイント      | 権限               | 備考                                                                       |
| ---------- | ------------------- | ------------------ | -------------------------------------------------------------------------- |
| **GET**    | `/members/{handle}` | Self / owner / mod | ETag 必須。未権限は 404/403。                                              |
| **POST**   | `/members`          | owner \| mod       | Body は _actor IRI のみ_ を受け取り、サーバが MemberEntry を生成。         |
| **PATCH**  | `/members/{handle}` | owner              | 変更可能フィールドは `role` のみ。`If-Match` または `If-None-Match` 必須。 |
| **DELETE** | `/members/{handle}` | owner \| mod       | `owner` を削除する場合は Owner 最小数ルールを適用。                        |

### 4.1 VERSION / ETag

- 更新ごとに `version` フィールドを +1。
- ETag は `"W/\"<version>\""` 形式。
- コンフリクト時は 409 + 最新バージョンを返す。

## 5. ActivityPub 通知

| 操作     | Activity (actor → object)               | 配信範囲                       |
| -------- | --------------------------------------- | ------------------------------ |
| 参加要求 | `Follow` (user → group)                 | group _inbox_                  |
| 承認     | `Accept` (Follow) + `Add` (MemberEntry) | 新メンバー / 既存メンバーのみ  |
| 招待     | `Invite` (group → user)                 | 対象ユーザ                     |
| 脱退     | `Undo` `Follow` + `Remove`              | 全メンバー                     |
| 追放     | `Remove`                                | 現メンバーのみ（追放対象除外） |
| 役割変更 | `Update` (MemberEntry)                  | 現メンバーのみ                 |

_Activity は「通知」に徹し、状態遷移の正は REST API が担う。_

## 6. 権限ロール表

| 操作                 | owner | mod | member |
| -------------------- | :---: | :-: | :----: |
| ChatMessage 送信     |   ✔   |  ✔  |   ✔    |
| 招待 / 承認 / 拒否   |   ✔   |  ✔  |   –    |
| 追放                 |   ✔   |  ✔  |   –    |
| 役割変更             |   ✔   |  –  |   –    |
| チャンネル作成       |   ✔   |  ✔  |   –    |
| Get 他人 MemberEntry |   ✔   |  ✔  |   –    |

## 7. 再鍵フロー（Re-Key）

1. **Create(ChatMessage)** → ChatGroup _inbox_。
2. 受信時に **members スナップショット** と最新 `version` を記録。
3. `Add`/`Remove`/`Update(role)` 完了時に **即時再鍵**。
4. _旧スナップショットに含まれないメンバーだけ_
   が復号できないことをもって、**前方秘匿**
   を保証。過去メッセージの後方秘匿は対象外。

## 8. セキュリティ

1. **平文禁止** — メッセージ本文・添付は常に ChatMessage 1.1 を介して暗号化。
2. **レート制限** — POST / PATCH / DELETE は **actor ごと 60 req/min 以下**
   を推奨。
3. **監査ログ** — 署名済 MemberEntry と Activity は永続保存。
4. **ランダム遅延** — 秘匿性を優先する実装は、権限失敗応答に 0–150 ms
   の揺らぎを入れる。

## 9. エラー応答ポリシー

| 状態             | 秘匿優先モード  | HTTP 準拠モード |
| ---------------- | --------------- | --------------- |
| 不在 / 権限不足  | 404 Not Found   | 403 Forbidden   |
| Owner 最小数違反 | 409 Conflict    | 同左            |
| ETag 不一致      | 409 Conflict    | 同左            |
| 署名検証失敗     | 502 Bad Gateway | 同左            |

## 付録 A — `members` コレクション例

```jsonc
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "OrderedCollection",
  "id": "https://chat.example.com/groups/abc/members",
  "totalItems": 3,
  "orderedItems": [
    "https://chat.example.com/groups/abc/members/alice",
    "https://chat.example.com/groups/abc/members/bob",
    "https://chat.example.com/groups/abc/members/carol"
  ]
}
```

## 付録 B — `channels` スケルトン

```jsonc
{
  "@context": "https://example.com/ns/chat#",
  "type": "ChannelCollection",
  "id": "https://chat.example.com/groups/abc/channels",
  "totalItems": 2,
  "orderedItems": [
    {
      "id": "https://chat.example.com/groups/abc/channels/general",
      "name": "general",
      "created": "2025-05-12T02:01:00Z"
    },
    {
      "id": "https://chat.example.com/groups/abc/channels/random",
      "name": "random",
      "created": "2025-05-12T02:02:00Z"
    }
  ]
}
```
