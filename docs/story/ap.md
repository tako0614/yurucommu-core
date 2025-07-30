## 1. 目的と範囲

* 24 時間の可視期間を持つ、縦向きの画像または動画からなる「ストーリー」を連合可能にする。
* 既存クライアント/サーバが未対応でも**通常の Image/Video 投稿として破綻なく表示**されること。
* 画面上の**質問箱/メンション/位置情報/スタンプ等のオーバーレイ**を、非対応実装でも意味が落ちない形で表現する。

---

## 2. 互換性方針

* **ベースタイプは AS2 の `Image` / `Video` を用いる。**
  区別は副タイプ（拡張語彙）と期限プロパティで行う。
* すべての拡張プロパティは名前空間 `https://example.com/ns#`（接頭辞 `x:`）を用いる。
  例：`"@context": [{"x": "https://example.com/ns#"}]`

---

## 3. データモデル（オブジェクト）

### 3.1 ストーリー識別

* **MUST**: `object.type` は配列で、`"Image"` または `"Video"` に **`"x:Story"` を併記**する。
  例：`"type": ["Image", "x:Story"]`
* **SHOULD**: 互換のためブール補助 `x:story: true` を付けてもよい。

### 3.2 可視期間（エフェメラル）

* **MUST**: 可視期限を `endTime` で示す（ISO 8601）。推奨は `published + 24h`。
* **MUST**: 期限到来時、発行者は `Delete` を配送し、受信側は `Tombstone` へ置換/非表示。
* **MUST**: 受信側はローカル時刻で `now >= endTime` のオブジェクトを UI から除外する。

### 3.3 メディアと縦向き要件

* **SHOULD**: `url`（`Link`）に `width`/`height` を付与。縦向きは `height >= width` を推奨。
* **MAY**: 動画は `duration`（ISO 8601 期間）を付与。音声有りは `mediaType` で示す。

### 3.4 意味要素（セマンティクス）

* メンション → `tag` に `{"type":"Mention","href":<Actor>,"name":"@username"}`
* ハッシュタグ → `{"type":"Hashtag","name":"#tag"}`
* 位置情報 → `location` に `Place {name, latitude, longitude}`
* 質問/投票 → `attachment` に `Question`（自由回答は inReplyTo で回答）

### 3.5 オーバーレイ（見た目/配置）

* **MAY**: `x:overlays` に UI 配置情報（正規化座標）を配列で付与。
* **MUST**: オーバーレイは**意味要素の参照**を含み、未対応実装は無視してもセマンティクスが残ること。

**`x:overlays` 要素（共通フィールド）**

| フィールド       | 型          | 必須     | 説明                                                                      |
| ----------- | ---------- | ------ | ----------------------------------------------------------------------- |
| `id`        | string     | MUST   | オーバーレイ ID                                                               |
| `kind`      | string     | MUST   | `"mention"`, `"place"`, `"question"`, `"sticker"`, `"link"`, `"text"` 等 |
| `ref`       | IRI        | SHOULD | 対応する `tag` / `attachment` / `Place` / `Link` の `id`                     |
| `bbox`      | number\[4] | MUST   | `[x,y,w,h]`（0–1 正規化）                                                    |
| `rotation`  | number     | MAY    | 角度（度）                                                                   |
| `z`         | integer    | MAY    | 描画順                                                                     |
| `opacity`   | number     | MAY    | 0–1                                                                     |
| `style`     | object     | MAY    | テーマ/枠/角丸など                                                              |
| `tapAction` | string     | MAY    | `"open-profile"`, `"open-map"`, `"reply"`, `"open-url"` など              |

---

## 4. アクティビティ（ライフサイクル）

### 4.1 Create

* **MUST**: ストーリーは `Create` で配送。`object` は 3 章の仕様に従う。
* **SHOULD**: `to`/`cc` でオーディエンス（Public/Followers 等）を明示。

### 4.2 Update（任意）

* **MAY**: 期限内のオーバーレイ修正やキャプション追記を `Update` で行う。
* **SHOULD**: 衝突回避のため `x:rev`（単調増加の整数）を付与し、受信側は **last-write-wins**。

### 4.3 Delete / Tombstone

* **MUST**: `endTime` 到来時点で `Delete` を送る。
* **MUST**: 受信側は `Tombstone { formerType, deleted }` で置換し、UI から除外。
* **SHOULD**: メディア実体のガベージコレクションを行う（法令/ポリシーに従う）。

### 4.4 View（閲覧通知、任意）

* **MAY**: 閲覧を `View` アクティビティ（`actor`: ビューア、`object`: ストーリー）として **投稿者のみに**配送。
* **SHOULD**: 既定は送信しない。プライバシー設定 `x:sendViewEvents: true` の明示がある場合のみ。

---

## 5. 質問箱/投票

### 5.1 自由回答（推奨）

* **投稿側**: `attachment` に `{"type":"Question","name":"…","anyOf":[],"closed":<endTime>}` を付与。
* **回答側**: `Create` + `Note` を、`inReplyTo: "<story-id>#question"` とし、`to` は**投稿者のみ**を既定とする。
* **SHOULD**: 回答にも `endTime` を設定して同期的に消えるようにする。

### 5.2 選択式投票

* **MAY**: `Question.oneOf/anyOf` に選択肢（`{name: "A"}` 等）を配列で提示。
* **MAY**: 投票の表現は実装依存（例：`Create` of `Note` with choice）だが、集計結果は `Question` の `replies` / `x:metrics` に反映して返す。

---

## 6. ディスカバリ（任意）

* **MAY**: Actor に `"x:stories": "<IRI>"` を追加し、\*\*現在有効（`endTime > now`）\*\*のストーリーのみを返す `OrderedCollection` を提供。
* **MAY**: 既読管理用に `"x:storiesSeen": "<IRI>"` を示し、`View` を受けて 既読リング UI を実装。

---

## 7. クライアント表示要件

* **SHOULD**: 9:16 付近の表示領域を前提に、`x:overlays.bbox` を正規化座標で解釈。
* **SHOULD**: 動画はタップで一時停止、既定表示時間は静止画 5 秒（`x:defaultFrameDuration` で上書き可）。
* **MUST**: `alt` / `summary` / `transcript`（動画）等のアクセシビリティ情報があれば表示。
* **SHOULD**: センシティブ（`sensitive: true` or `contentWarning`）の場合はぼかし/タップで解錠。

---

## 8. セキュリティ/プライバシー

* **MUST**: 外部 `url` は署名検証/メディアプロキシ等の安全策を適用。EXIF の位置情報は既定で除去。
* **MUST**: 位置情報 `Place` はユーザーの明示操作でのみ付与。
* **SHOULD**: 不正メンション（スパム）対策にレート制御/ミュート/ブロックを適用。
* **MAY**: `x:silent: true` でメンション通知抑止の送信者ヒントを提供（尊重は受信側任意）。

---

## 9. 互換性とフォールバック

* **MUST**: 未対応実装が `x:*` を無視しても、`Image/Video` として内容が読めること。
* **SHOULD**: オーバーレイで埋め込んだリンク/場所/メンションは、`tag` / `attachment` / `location` にも重複保持して意味を担保。

---

## 10. 例

### 10.1 Create（画像ストーリー + メンション/位置/質問箱/スタンプ）

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    { "x": "https://example.com/ns#" }
  ],
  "type": "Create",
  "actor": "https://example.com/users/alice",
  "to": ["https://example.com/users/alice/followers"],
  "object": {
    "id": "https://example.com/stories/123",
    "type": ["Image", "x:Story"],
    "x:story": true,
    "mediaType": "image/jpeg",
    "url": {
      "type": "Link",
      "href": "https://example.com/media/123.jpg",
      "width": 1080,
      "height": 1920
    },
    "published": "2025-07-30T01:05:00Z",
    "endTime": "2025-07-31T01:05:00Z",

    "tag": [
      {
        "type": "Mention",
        "id": "https://example.com/stories/123#mention-bob",
        "href": "https://remote.social/users/bob",
        "name": "@bob"
      },
      { "type": "Hashtag", "name": "#coffeetime" }
    ],

    "location": {
      "type": "Place",
      "id": "https://example.com/places/blue-bottle-aoyama",
      "name": "Blue Bottle Aoyama",
      "latitude": 35.6656,
      "longitude": 139.7121
    },

    "attachment": [
      {
        "id": "https://example.com/stories/123#question",
        "type": "Question",
        "name": "おすすめの豆は？",
        "anyOf": [],
        "closed": "2025-07-31T01:05:00Z"
      }
    ],

    "x:overlays": [
      {
        "id": "ov1",
        "kind": "mention",
        "ref": "https://example.com/stories/123#mention-bob",
        "bbox": [0.08, 0.12, 0.40, 0.10],
        "rotation": 0,
        "z": 10,
        "style": { "theme": "light", "rounded": true },
        "tapAction": "open-profile"
      },
      {
        "id": "ov2",
        "kind": "place",
        "ref": "https://example.com/places/blue-bottle-aoyama",
        "bbox": [0.55, 0.78, 0.40, 0.10],
        "z": 9,
        "tapAction": "open-map"
      },
      {
        "id": "ov3",
        "kind": "question",
        "ref": "https://example.com/stories/123#question",
        "bbox": [0.10, 0.65, 0.80, 0.18],
        "z": 20,
        "style": { "theme": "light", "border": true },
        "tapAction": "reply"
      },
      {
        "id": "ov4",
        "kind": "sticker",
        "ref": "https://example.com/stickers/coffee-cup.png",
        "mediaType": "image/png",
        "bbox": [0.70, 0.05, 0.22, 0.22],
        "rotation": -12,
        "z": 5
      }
    ]
  }
}
```

### 10.2 Delete（期限到来）

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Delete",
  "actor": "https://example.com/users/alice",
  "to": ["https://example.com/users/alice/followers"],
  "object": {
    "type": "Tombstone",
    "id": "https://example.com/stories/123",
    "formerType": "Image",
    "deleted": "2025-07-31T01:05:01Z"
  }
}
```

### 10.3 動画ストーリー（簡易）

```json
{
  "@context": ["https://www.w3.org/ns/activitystreams", {"x":"https://example.com/ns#"}],
  "type": "Create",
  "actor": "https://example.com/users/alice",
  "object": {
    "id": "https://example.com/stories/456",
    "type": ["Video", "x:Story"],
    "mediaType": "video/mp4",
    "url": {"type":"Link","href":"https://example.com/media/456.mp4","width":1080,"height":1920},
    "duration": "PT12S",
    "published": "2025-07-30T01:10:00Z",
    "endTime": "2025-07-31T01:10:00Z"
  }
}
```

---

## 11. JSON Schema（抜粋）

### 11.1 `x:overlays` 要素

```json
{
  "$id": "https://example.com/ns#/overlay",
  "type": "object",
  "required": ["id", "kind", "bbox"],
  "properties": {
    "id": { "type": "string" },
    "kind": { "type": "string", "enum": ["mention","place","question","sticker","link","text"] },
    "ref": { "type": "string", "format": "uri" },
    "bbox": {
      "type": "array",
      "items": { "type": "number", "minimum": 0, "maximum": 1 },
      "minItems": 4, "maxItems": 4
    },
    "rotation": { "type": "number" },
    "z": { "type": "integer" },
    "opacity": { "type": "number", "minimum": 0, "maximum": 1 },
    "style": { "type": "object", "additionalProperties": true },
    "tapAction": { "type": "string" },
    "mediaType": { "type": "string" }  // sticker等で利用
  },
  "additionalProperties": false
}
```

### 11.2 ストーリー拡張（オブジェクト）

```json
{
  "$id": "https://example.com/ns#/story-object",
  "type": "object",
  "properties": {
    "type": { "type": ["string","array"] },
    "x:story": { "type": "boolean" },
    "endTime": { "type": "string", "format": "date-time" },
    "x:overlays": {
      "type": "array",
      "items": { "$ref": "https://example.com/ns#/overlay" }
    },
    "x:rev": { "type": "integer", "minimum": 0 }
  }
}
```

---

## 12. 準拠テスト（チェックリスト）

**送信側（サーバ/クライアント）**

* [ ] `type: ["Image"|"Video","x:Story"]` を付与する
* [ ] `endTime`（= `published + 24h` 目安）を設定する
* [ ] 期限到来で `Delete` を配送する
* [ ] メンション/位置/リンクは `tag` / `location` / `attachment` にも保持
* [ ] オーバーレイは正規化 `bbox` で付与（意味要素を `ref` で参照）

**受信側（サーバ/クライアント）**

* [ ] `now >= endTime` は UI 非表示
* [ ] `Delete` 受領で `Tombstone` 置換
* [ ] 未知の `x:*` は無視しつつ、`Image/Video` として表示
* [ ] アクセシビリティ情報（`alt`/`transcript`）があれば提示

---

## 13. バージョニング

* 本仕様は `x:specVersion: "1.0"` を `object` に付けてもよい（将来互換のため）。
* 後方互換のない変更がある場合は名前空間を `…/ns/v2#` に更新する。