## 1) 位置づけ（vocabulary 拡張）

* ベース: ActivityStreams 2.0（`as:`）
* 拡張語彙（例）: `story:` = `https://example.org/ns/story#`
  ※ 固定ではなく、実装側でホスト可能。
* 新規タイプ:

  * `story:Story` … エフェメラル or 常設のストーリー全体（＝シーケンス / ページ束）
  * `story:Page` … 1 つの表示ページ（タップで次へ等）
  * `story:Item` … ページ内に自由配置される要素の基底クラス

    * `story:ImageItem`
    * `story:VideoItem`
    * `story:TextItem`
    * （任意: `story:StickerItem`, `story:ShapeItem`, `story:AudioItem` など）

---

## 2) レンダリングモデル（自由配置）

**座標系**はビューポートに対する **正規化値**（0.0–1.0）を基本とし、UI 差異に強い相互運用を確保。

共通プロパティ（`story:Item`）:

* `bbox`: `{ "x": 0–1, "y": 0–1, "w": 0–1, "h": 0–1, "units": "fraction" }`
* `rotation`: 度数（時計回り）
* `zIndex`: レイヤ順（整数）
* `opacity`: 0–1
* `transform`: 省略可。必要なら CSS 互換の 2D/3D 行列文字列
* `anchor`: `"center"|"topLeft"|...`（配置基準点）
* `visibleFrom` / `visibleUntil`: ページ内での相対表示時間（秒）
* `tapAction`: `{ "type": "link|reply|none", "href": "...", "target": "_blank|_self" }`
* `contentWarning`: 文字列（CW がある場合はタップで展開）
* `accessibilityLabel`: 代替説明（スクリーンリーダ用）

ページ（`story:Page`）:

* `duration`: 推奨 5–10s（実装は任意）
* `background`: `{ "type": "color|gradient|image|video", ... }`
* `safeArea`: `{ "top":0–1, "bottom":0–1, "left":0–1, "right":0–1 }`（UI で隠れやすい領域）
* `items`: `story:Item[]`

ストーリー本体（`story:Story`）:

* `aspectRatio`: 例 `"9:16"`（任意）
* `pages`: `story:Page[]`
* `expiresAt`: ISO8601（エフェメラル期限。省略可）
* `poster`: プレビュー用静止画
* `audioTrack`: （任意）BGM。`{ "href": "...", "start": 秒, "gain": -60〜+6 }`

---

## 3) 要素タイプ詳細

### ImageItem

* `type`: `"story:ImageItem"`
* `media`: ActivityStreams の `url` / `href`（コンテンツの URL / MediaType）
* `crop`: `{ "shape":"rect|circle|rounded", "radius":0–1, "focusX":0–1, "focusY":0–1 }`
* `filters`: `[{ "name":"brightness|contrast|saturate|blur|hueRotate", "value": number }]`
* `alt`: 代替テキスト（`accessibilityLabel` とどちらか必須推奨）

### VideoItem

* `type`: `"story:VideoItem"`
* `media`: （同上）
* `autoplay`: `true`（既定）
* `loop`: `true|false`
* `muted`: 既定 `true`
* `trim`: `{ "start": 秒, "end": 秒 }`
* `poster`: サムネイル

### TextItem

* `type`: `"story:TextItem"`
* `text`: プレーンテキスト or `content`（AS 準拠）
* `style`: `{ "fontFamily": string, "fontWeight": 100–900, "fontSize": em/px 相当の相対値, "lineHeight": number, "align":"left|center|right", "color": "#RRGGBBAA", "stroke": {"color":"#RRGGBB","width":number}, "shadow": {...}, "background": {...}, "padding": number }`
* `rtl`: `true|false`（双方向テキスト対応）
* `mentions`: `as:Tag[]`（`type:"Mention"` を推奨）

（任意）StickerItem/ShapeItem などは `media` or `shape` と簡易アニメーション（`keyframes`）を許容。

---

## 4) ActivityPub での配信

* 作成: `as:Create{ object: story:Story }`
* 更新: `as:Update{ object: story:Story }`（軽微編集）
* 削除: `as:Delete{ object: story:Story }`
  ※ `expiresAt` 到来時、送信サーバは `Delete` の送出が望ましい（受信側も期限越えは非表示）。
* 受信互換: `to`/`cc`/`audience` で公開範囲。`as:Reply` による返信、`EmojiReaction` 拡張でリアクションを表現可。
* メディア配送: `media` は通常の添付（`as:attachment` / `url`）か、署名付き一時 URL。HTTP Signatures/LD-Signatures は既存運用に準拠。

---

## 5) 後方互換（フォールバック）

* `story:Story` は **必ず** フォールバックを持つこと:

  * `as:Note` か `as:Video`/`as:Image` を **併記**（`summary` と `poster` を付与）。
  * 未対応サーバはそれをタイムライン表示できる。対応サーバは `story:` 語彙を解釈しリッチ表示。
* プレビュー: `poster` と最初のページのサマリテキストを `summary` に複製。

---

## 6) プライバシー / 安全

* `expiresAt` 満了時は UI 非表示、検索非対象推奨。
  （法的・運用上、完全消去は保証しないことを `sensitive`/`contentWarning` と合わせて明示可能）
* `sensitive: true` と `contentWarning` による閲覧前ガード。
* アクセシビリティ: `alt` / `accessibilityLabel` は必須推奨。自動字幕（VideoItem）用に `captions`（WebVTT）を許容。

---

## 7) 例（JSON‑LD）

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    { "story": "https://example.org/ns/story#" }
  ],
  "id": "https://alice.example/stories/abc123",
  "type": "story:Story",
  "attributedTo": "https://alice.example/users/alice",
  "published": "2025-07-30T03:12:00Z",
  "expiresAt": "2025-07-31T03:12:00Z",
  "to": ["https://www.w3.org/ns/activitystreams#Public"],
  "aspectRatio": "9:16",
  "poster": {
    "type": "Image",
    "url": "https://cdn.example/abc123/poster.jpg",
    "mediaType": "image/jpeg"
  },
  "pages": [{
    "type": "story:Page",
    "duration": 6.5,
    "background": { "type": "color", "value": "#101018" },
    "safeArea": { "top": 0.08, "bottom": 0.08, "left": 0.04, "right": 0.04 },
    "items": [
      {
        "type": "story:ImageItem",
        "media": { "type": "Link", "href": "https://cdn.example/abc123/photo1.jpg", "mediaType": "image/jpeg" },
        "bbox": { "x": 0.05, "y": 0.10, "w": 0.6, "h": 0.45, "units": "fraction" },
        "rotation": -2.5,
        "zIndex": 1,
        "alt": "朝焼けの街並み"
      },
      {
        "type": "story:TextItem",
        "text": "おはよう！",
        "style": {
          "fontFamily": "Inter",
          "fontWeight": 700,
          "fontSize": 0.06,
          "align": "left",
          "color": "#FFFFFF",
          "stroke": { "color": "#000000", "width": 0.004 }
        },
        "bbox": { "x": 0.07, "y": 0.58, "w": 0.5, "h": 0.12, "units": "fraction" },
        "zIndex": 2,
        "accessibilityLabel": "おはようという挨拶のテキスト"
      },
      {
        "type": "story:VideoItem",
        "media": { "type": "Link", "href": "https://cdn.example/abc123/clip.mp4", "mediaType": "video/mp4" },
        "bbox": { "x": 0.62, "y": 0.15, "w": 0.30, "h": 0.30, "units": "fraction" },
        "poster": { "type": "Link", "href": "https://cdn.example/abc123/clip.jpg", "mediaType": "image/jpeg" },
        "autoplay": true, "loop": true, "muted": true,
        "visibleFrom": 1.0, "visibleUntil": 6.5,
        "zIndex": 3
      },
      {
        "type": "story:TextItem",
        "text": "#sunrise @bob",
        "mentions": [
          { "type": "Hashtag", "name": "sunrise" },
          { "type": "Mention", "href": "https://social.example/users/bob" }
        ],
        "bbox": { "x": 0.05, "y": 0.92, "w": 0.9, "h": 0.05, "units": "fraction" },
        "style": { "fontSize": 0.035, "align": "left", "color": "#DDDDDD" },
        "tapAction": { "type": "link", "href": "https://alice.example/links/more" }
      }
    ]
  }],
  "attachment": [
    {
      "type": "Note",
      "summary": "ストーリーのプレビュー",
      "content": "おはよう！",
      "url": "https://alice.example/stories/abc123",
      "mediaType": "text/html"
    }
  ]
}
```

---

## 8) 相互運用のガイド

* **正規化座標**により、端末解像度差や UI オーバーレイに強い。エクスポート時に 9:16 以外でも同一表現を維持。
* **期限と削除**: `expiresAt` 経過 → 受信側は非表示。送信側は `as:Delete` を送ることが望ましい。
* **返信 / リアクション**: `as:Create{object:Note, inReplyTo: <story or page>}`、`EmojiReaction` 拡張など。
* **ハイライト**（常設）: `story:Highlight`（任意）を `Collection` として定義し、`story:Story` を収蔵。

---

## 9) 実装メモ（最小要件）

1. 受信時、`story:` 未対応でも `poster` と `attachment` を使ってタイムラインで静的プレビュー表示。
2. 対応クライアントは `pages[].items[]` を解釈し、タップでページ進行・リンク遷移。
3. 投稿 UI は `ImageItem / VideoItem / TextItem` の編集（bbox, rotation, zIndex）を提供。
4. サーバはメディアに `mediaType` と `Content-Length` を付け、範囲リクエスト対応推奨。