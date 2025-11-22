# ストーリー API

座標配置型ビジュアルコンテンツ（Story）に関する API です。

## エンドポイント

### POST /stories

グローバルストーリーを作成します。

**認証**: 必須

**リクエスト**:
```json
{
  "items": [
    {
      "type": "image",
      "url": "https://example.com/media/photo.jpg",
      "x": 0,
      "y": 0,
      "width": 1080,
      "height": 1920,
      "duration_ms": 5000
    },
    {
      "type": "text",
      "content": "Hello!",
      "x": 100,
      "y": 100,
      "fontSize": 32,
      "color": "#FFFFFF"
    }
  ],
  "audience": "all",
  "visible_to_friends": true
}
```

**レスポンス** (201) - 詳細は省略

### POST /communities/:id/stories

コミュニティストーリーを作成します（コミュニティメンバーのみ）。

### GET /stories

グローバルストーリー一覧（24時間以内のもの）を取得します。

### GET /communities/:id/stories

コミュニティストーリー一覧を取得します。

### GET /stories/:id

特定のストーリーを取得します。

### PATCH /stories/:id

ストーリーを編集します（アイテム変更、有効期限延長）。

### DELETE /stories/:id

ストーリーを削除します。

詳細は実装コード（[backend/src/routes/stories.ts](../../backend/src/routes/stories.ts)）を参照してください。
