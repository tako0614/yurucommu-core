# メディア・ストレージ API

画像・動画のアップロードとストレージ管理に関する API です。

## メディアアップロード

### POST /media/upload

投稿用のメディアファイルをアップロードします。

**認証**: 不要（パブリックアップロード）

**リクエスト**:
- Content-Type: `multipart/form-data`
- フィールド: `file`

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "url": "https://example.com/media/abc123.jpg",
    "key": "abc123.jpg",
    "size": 102400,
    "content_type": "image/jpeg"
  }
}
```

---

### GET /media/*

アップロードされたメディアファイルを取得します。

**認証**: 不要（パブリックアクセス）

**URL 例**:
```
GET /media/abc123.jpg
```

**レスポンス**:
- 画像・動画ファイルのバイナリデータ
- `Cache-Control: public, max-age=31536000, immutable`

---

## ユーザーストレージ

### GET /storage

ユーザーのストレージ情報を取得します（フォルダ・ファイル一覧）。

**認証**: 必須

**クエリパラメータ**:
- `path`: フォルダパス（オプション、デフォルト: `/`）

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "path": "/",
    "files": [
      {
        "key": "photos/image1.jpg",
        "size": 204800,
        "uploaded": "2024-01-01T00:00:00.000Z"
      }
    ],
    "total_size": 204800,
    "total_files": 1
  }
}
```

---

### POST /storage/upload

ユーザーストレージにファイルをアップロードします。

**認証**: 必須

**リクエスト**:
- Content-Type: `multipart/form-data`
- フィールド: `file`, `path` (オプション)

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "key": "user-id/photos/image1.jpg",
    "url": "https://example.com/media/user-id/photos/image1.jpg",
    "size": 204800
  }
}
```

---

### DELETE /storage

ストレージ内のファイルまたはフォルダを削除します。

**認証**: 必須

**クエリパラメータ**:
- `key`: 削除するファイル/フォルダのキー

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "deleted": 5,
    "keys": [
      "user-id/photos/image1.jpg",
      "user-id/photos/image2.jpg"
    ]
  }
}
```

---

## ストレージ制限

- **最大ファイルサイズ**: Cloudflare Workers の制限に準拠（通常 100MB）
- **保存期間**: 無制限（手動削除まで保持）
- **ストレージ容量**: R2 バケットの容量に依存

---

## 使用例

### メディアアップロードと投稿

```javascript
// 1. メディアファイルをアップロード
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const uploadResponse = await fetch('https://example.com/media/upload', {
  method: 'POST',
  body: formData
});
const { data } = await uploadResponse.json();
const mediaUrl = data.url;

// 2. アップロードしたメディアで投稿作成
const postResponse = await fetch('https://example.com/posts', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    text: 'Check this out!',
    media: [mediaUrl]
  })
});
```

### ストレージ管理

```javascript
// 1. ストレージ一覧取得
const storageResponse = await fetch('https://example.com/storage?path=/photos', {
  headers: { 'Authorization': 'Bearer token' }
});

// 2. ファイルアップロード
const formData = new FormData();
formData.append('file', file);
formData.append('path', '/photos');

const uploadResponse = await fetch('https://example.com/storage/upload', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer token' },
  body: formData
});

// 3. ファイル削除
const deleteResponse = await fetch('https://example.com/storage?key=user-id/photos/old.jpg', {
  method: 'DELETE',
  headers: { 'Authorization': 'Bearer token' }
});
```

---

## 技術詳細

- **ストレージバックエンド**: Cloudflare R2
- **キャッシュ**: CDN 経由で配信（1年間キャッシュ）
- **アクセス制御**: メディアはパブリック、ストレージは認証必須
