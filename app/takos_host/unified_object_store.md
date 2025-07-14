# takos host ― 統合オブジェクトストア方式（MongoDB 版）

*Draft v0.3  2025‑07‑14*

---

## 1 目的

* **10^5 以上のテナント**が同居しても、ストレージ効率・取得レイテンシを両立させる。
* ActivityPub オブジェクトを **1 つのコレクション**に集約し、内部配送をゼロホップ化。
* **`public / followers / local / direct`**\*\* といった独自可視性フラグを排除\*\*し、*素の ActivityPub* と **フォロー／リレーのグラフ**だけでアクセスを判別する。

## 2 スコープ

* **クラスタ内データ構造**（コレクション／インデックス／シャーディング）
* **フェデレーション境界**（外部→内部、内部→外部）
* **Audience 解決ロジック**（`to` / `cc` とフォロー／リレー）

## 3 用語

| 用語     | 説明                                     |
| ------ | -------------------------------------- |
| テナント   | ユーザがレンタルした仮想サーバー単位                     |
| アクター   | `Person` / `Group` の URI; ローカル or リモート |
| リレー    | バルクでオブジェクトを受け入れる外部ドメイン                 |
| オブジェクト | URI で一意な ActivityPub Object            |

## 4 高レベル構成図

```
┌───────── Fediverse ─────────┐
│  HTTP (署名付き JSON)        │
└────────────────────────────┘
          ▲     ▲
          │pull │push
┌──────────┴─────┴─────┐
│ 配送オーケストレータ │  (stateless ワーカー)
└──────▲────────▲──────┘
       │write    │fan‑out(optional)
┌──────┴────────┴──────────────┐
│        object_store           │  (共通・シャード可)
└──────▲────────▲──────────────┘
       │$lookup        │read‑only
┌──────┴──────┐  ┌─────┴─────┐
│ tenant A TL │  │ tenant B TL │
└─────────────┘  └────────────┘
```

## 5 データモデル（MongoDB コレクション）

### 5.1 `object_store`

```jsonc
{
  _id: "https://example.org/objects/abc", // PK
  raw: { … },                              // 受信したままの JSON(LD)
  type: "Note",                           // インデックス高速化用
  actor_id: "https://…/actors/alice",     // 投稿者 URI
  created_at: ISODate(),
  updated_at: ISODate(),
  deleted_at: Optional<ISODate>,
  // Audience (正規化)
  aud: {
    to:  ["https://…/actors/bob", "…#Public"],
    cc:  ["https://…/actors/charlie" ]
  }
}
```

* **Shard Key**: `{ _id: "hashed" }` または `{ actor_id: "hashed" }`
* `raw` は不変。削除時は `deleted_at` を立てて `raw` を空にできる。

### 5.2 `tenant`

```
{ _id: UUID, domain: "takos123.jp", … }
```

### 5.3 `follow_edge`

```
{ tenant_id: UUID, actor_id: string, since: ISODate(), relay: string|null }
// _id に (tenant_id, actor_id) を結合した文字列を使うと重複防止が簡単
// Index: { actor_id: 1, tenant_id: 1 }
```

### 5.4 `relay_edge`

```
{ tenant_id: UUID, relay: "some.relay", mode: "pull"|"push", since: ISODate() }
// Index: { relay: 1, tenant_id: 1 }
```

### 5.5 `timeline_event` (インクリメンタル材質化を採用する場合)

```
{ tenant_id: UUID, object_id: string, inserted_at: ISODate() }
// Index: { tenant_id: 1, inserted_at: -1 }
```

## 6 タイムライン取得ロジック

### 6.1 オンザフライ `$lookup` 例

```js
// ❶ フォロー中アクターを起点に検索
db.follow_edge.aggregate([
  { $match: { tenant_id: myTenant } },
  { $lookup: {
      from: "object_store",
      localField: "actor_id",
      foreignField: "actor_id",
      as: "objs"
  }},
  { $unwind: "$objs" },
  // ❷ Audience フィルタ to/cc
  { $match: { $or: [
      { "objs.aud.to": myActorUri },
      { "objs.aud.cc": myActorUri },
      { "objs.aud.to": "https://www.w3.org/ns/activitystreams#Public" }
  ]}},
  { $sort: { "objs.created_at": -1 } },
  { $limit: 40 }
])
```

### 6.2 リレー参加を含める

* `relay_edge` を `$lookup` で join し、**リレー許可ドメインのアクター**もマッチさせる。
* or materialize パスでは **follow\_edge + relay\_edge 無い** TL 対象は事前展開しない。

## 7 Audience 判定ルール

| 条件                                    | TL へ載せるか | 備考         |
| ------------------------------------- | -------- | ---------- |
| 投稿の `aud.to / cc` に *自アクター* が含まれる     | ○        | メンション / DM |
| `aud.to` に `#Public` が含まれる            | ○        | 公開投稿       |
| 投稿者を `follow_edge` に持つ                | ○        | フォロー TL    |
| 投稿者ドメインが `relay_edge` に登録され *pull* 設定 | ○        | リレー TL     |
| 上記いずれも満たさない                           | ×        | 取得対象外      |

> **ポイント**: `public / followers / local / direct` 列を持たず、純粋に *フォロー/リレー/オーディエンス配列* だけで判断。

## 8 アクセス制御

* すべての DB クエリに **tenant\_id** を含め、**RLS** (アプリ層) を徹底。
* MongoDB 7 の `$tenant` 機能を使うと自動フィルタ可。
* 添付ファイルは署名付き一時 URL。DM など秘匿投稿は payload レベルで **E2EE**。

## 9 スケール & シャーディング

| コレクション          | シャードキー                                   | ポイント                      |
| --------------- | ---------------------------------------- | ------------------------- |
| object\_store   | `_id: "hashed"` または `actor_id: "hashed"` | 均等分散。                     |
| follow\_edge    | `{ actor_id: 1 }`                        | `$lookup` が同シャード内で完結しやすい。 |
| timeline\_event | `{ tenant_id: 1, inserted_at: -1 }`      | テナント単位でホットスポット回避。         |

## 10 削除 & GDPR

* `deleted_at` フラグで論理削除。TTL index で T 日後に物理パージ。

## 11 セキュリティ

* `$jsonSchema` で ActivityPub Vocabulary に準拠した JSON を強制。
* 機密コンテンツは外部 Object Storage + E2EE。

## 12 移行手順

1. 現行 per‑tenant コレクションを `object_store` へバックフィル。
2. 新 TL クエリ (フォロー / リレー / Audience) に切替。
3. legacy 可視性列がある場合は drop。

## 13 今後の検討項目

* **Relay edge** に *tag-based* サブスコープを追加（例: 動画のみ転送）。
* 高速化のため `actor_id` → shard map キャッシュを導入。
* takos自体のタイムラインをリレーサーバーとして公開

---

*インライン可視性フラグを廃止し、フォロー / リレー / Audience のみで判別する構成へ更新しました。レビューのうえ追加フィードバックをお寄せください。*
